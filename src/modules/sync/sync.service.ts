import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseInventoryAdjustPayload } from '../inventory/inventory-sync-payload';
import { InventoryService } from '../inventory/inventory.service';
import { parsePurchasePayload } from '../purchases/purchase-sync-payload';
import { PurchasesService } from '../purchases/purchases.service';
import { parseSaleReturnPayload } from '../sale-returns/sale-return-sync-payload';
import { SaleReturnsService } from '../sale-returns/sale-returns.service';
import { parseSalePayload } from '../sales/sale-sync-payload';
import { SalesService } from '../sales/sales.service';
import type { ResolvedFxSnapshot } from '../exchange-rates/store-fx-snapshot.service';
import { StoreFxSnapshotService } from '../exchange-rates/store-fx-snapshot.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PosDeviceService } from '../pos-device/pos-device.service';
import type { SyncPushDto, SyncPushOpDto } from './dto/sync-push.dto';
import { stableJsonStringify } from './stable-json';

export type SyncPushResult = {
  serverTime: string;
  acked: { opId: string; serverVersion: number }[];
  skipped: { opId: string; reason: string }[];
  failed: { opId: string; reason: string; details?: string }[];
};

export type SyncPullResult = {
  serverTime: string;
  fromVersion: number;
  toVersion: number;
  ops: {
    serverVersion: number;
    opType: string;
    timestamp: string;
    payload: Record<string, unknown>;
  }[];
  hasMore: boolean;
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly sales: SalesService,
    private readonly purchases: PurchasesService,
    private readonly saleReturns: SaleReturnsService,
    private readonly storeFx: StoreFxSnapshotService,
    private readonly posDevice: PosDeviceService,
  ) {}

  /**
   * Server-originated ops for POS (catalog). `serverVersion` is from `ServerChangeLog` (global),
   * not the same counter as `acked[].serverVersion` from `/sync/push` (per-store `StoreSyncState`).
   */
  async pull(
    storeId: string,
    since: number,
    limit = 500,
  ): Promise<SyncPullResult> {
    const take = Math.min(500, Math.max(1, limit));
    const rows = await this.prisma.serverChangeLog.findMany({
      where: {
        serverVersion: { gt: since },
        OR: [{ storeScopeId: null }, { storeScopeId: storeId }],
      },
      orderBy: { serverVersion: 'asc' },
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const ops = page.map((r) => ({
      serverVersion: r.serverVersion,
      opType: r.opType,
      timestamp: r.createdAt.toISOString(),
      payload: r.payload as Record<string, unknown>,
    }));

    const toVersion =
      page.length > 0 ? page[page.length - 1].serverVersion : since;

    return {
      serverTime: new Date().toISOString(),
      fromVersion: since,
      toVersion,
      ops,
      hasMore,
    };
  }

  async push(dto: SyncPushDto, storeId: string): Promise<SyncPushResult> {
    const serverTime = new Date().toISOString();
    const empty: SyncPushResult = {
      serverTime,
      acked: [],
      skipped: [],
      failed: [],
    };

    if (!dto.ops.length) {
      return empty;
    }

    const acked: SyncPushResult['acked'] = [];
    const skipped: SyncPushResult['skipped'] = [];
    const failed: SyncPushResult['failed'] = [];

    await this.prisma.$transaction(
      async (tx) => {
        await this.posDevice.touchOrRegister(tx, storeId, dto.deviceId, {
          appVersion: dto.appVersion,
        });
        await tx.storeSyncState.upsert({
          where: { storeId },
          create: { storeId, serverVersion: 0 },
          update: {},
        });

        for (const op of dto.ops) {
          await this.processOneOp(tx, storeId, dto.deviceId, op, {
            acked,
            skipped,
            failed,
          });
        }
      },
      {
        maxWait: 5000,
        timeout: 30000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return { serverTime: new Date().toISOString(), acked, skipped, failed };
  }

  private async processOneOp(
    tx: Prisma.TransactionClient,
    storeId: string,
    deviceId: string,
    op: SyncPushOpDto,
    buckets: {
      acked: SyncPushResult['acked'];
      skipped: SyncPushResult['skipped'];
      failed: SyncPushResult['failed'];
    },
  ) {
    const existing = await tx.syncOperation.findUnique({
      where: { opId: op.opId },
    });

    if (existing) {
      if (existing.storeId !== storeId) {
        throw new ConflictException(
          `opId ${op.opId} is already used in another store`,
        );
      }

      const samePayload =
        stableJsonStringify(existing.payload) ===
        stableJsonStringify(op.payload);

      if (!samePayload) {
        buckets.failed.push({
          opId: op.opId,
          reason: 'payload_mismatch',
          details:
            'Same opId was already recorded with a different payload (possible conflict or replay attack).',
        });
        return;
      }

      if (existing.status === 'applied') {
        buckets.skipped.push({
          opId: op.opId,
          reason: 'already_applied',
        });
        return;
      }

      if (existing.status === 'failed') {
        buckets.failed.push({
          opId: op.opId,
          reason: existing.failureReason ?? 'failed',
          details: 'Operation was previously rejected; fix payload or use a new opId.',
        });
        return;
      }

      buckets.failed.push({
        opId: op.opId,
        reason: 'pending_or_stuck',
        details:
          'Operation exists in pending state; contact support if this persists.',
      });
      return;
    }

    const clientTs = new Date(op.timestamp);

    if (op.opType === 'NOOP') {
      const { serverVersion } = await tx.storeSyncState.update({
        where: { storeId },
        data: { serverVersion: { increment: 1 } },
        select: { serverVersion: true },
      });

      await tx.syncOperation.create({
        data: {
          opId: op.opId,
          storeId,
          deviceId,
          opType: op.opType,
          payload: op.payload as Prisma.InputJsonValue,
          clientTimestamp: clientTs,
          status: 'applied',
          serverVersion,
          serverAppliedAt: new Date(),
        },
      });

      buckets.acked.push({ opId: op.opId, serverVersion });
      return;
    }

    if (op.opType === 'INVENTORY_ADJUST') {
      const parsed = parseInventoryAdjustPayload(
        op.payload as Record<string, unknown>,
      );
      if (!parsed) {
        await tx.syncOperation.create({
          data: {
            opId: op.opId,
            storeId,
            deviceId,
            opType: op.opType,
            payload: op.payload as Prisma.InputJsonValue,
            clientTimestamp: clientTs,
            status: 'failed',
            failureReason: 'validation_error',
          },
        });
        buckets.failed.push({
          opId: op.opId,
          reason: 'validation_error',
          details:
            'Invalid inventory payload: use { inventoryAdjust: { productId, type: IN_ADJUST|OUT_ADJUST, quantity (string) } }',
        });
        return;
      }

      let invResult: Awaited<
        ReturnType<InventoryService['applyAdjustTx']>
      >;
      try {
        invResult = await this.inventory.applyAdjustTx(tx, storeId, {
          ...parsed,
          opId: op.opId,
        });
      } catch (err) {
        if (
          err instanceof BadRequestException ||
          err instanceof NotFoundException
        ) {
          await tx.syncOperation.create({
            data: {
              opId: op.opId,
              storeId,
              deviceId,
              opType: op.opType,
              payload: op.payload as Prisma.InputJsonValue,
              clientTimestamp: clientTs,
              status: 'failed',
              failureReason: 'validation_error',
            },
          });
          buckets.failed.push({
            opId: op.opId,
            reason: 'validation_error',
            details: err.message,
          });
          return;
        }
        throw err;
      }

      if (invResult.status === 'skipped') {
        buckets.skipped.push({
          opId: op.opId,
          reason: 'already_applied',
        });
        return;
      }

      const { serverVersion } = await tx.storeSyncState.update({
        where: { storeId },
        data: { serverVersion: { increment: 1 } },
        select: { serverVersion: true },
      });

      await tx.syncOperation.create({
        data: {
          opId: op.opId,
          storeId,
          deviceId,
          opType: op.opType,
          payload: op.payload as Prisma.InputJsonValue,
          clientTimestamp: clientTs,
          status: 'applied',
          serverVersion,
          serverAppliedAt: new Date(),
        },
      });

      buckets.acked.push({ opId: op.opId, serverVersion });
      return;
    }

    if (op.opType === 'SALE') {
      const remote = parseSalePayload(op.payload as Record<string, unknown>);
      if (!remote) {
        await tx.syncOperation.create({
          data: {
            opId: op.opId,
            storeId,
            deviceId,
            opType: op.opType,
            payload: op.payload as Prisma.InputJsonValue,
            clientTimestamp: clientTs,
            status: 'failed',
            failureReason: 'validation_error',
          },
        });
        buckets.failed.push({
          opId: op.opId,
          reason: 'validation_error',
          details:
            'Invalid sale payload: need sale.storeId, sale.lines[].productId, quantity, price (strings)',
        });
        return;
      }

      if (remote.storeId !== storeId) {
        await tx.syncOperation.create({
          data: {
            opId: op.opId,
            storeId,
            deviceId,
            opType: op.opType,
            payload: op.payload as Prisma.InputJsonValue,
            clientTimestamp: clientTs,
            status: 'failed',
            failureReason: 'validation_error',
          },
        });
        buckets.failed.push({
          opId: op.opId,
          reason: 'validation_error',
          details: 'sale.storeId must match X-Store-Id',
        });
        return;
      }

      const settings = await this.prisma.businessSettings.findUnique({
        where: { storeId },
        include: {
          functionalCurrency: true,
          defaultSaleDocCurrency: true,
        },
      });
      if (!settings) {
        throw new NotFoundException('Business settings not found');
      }
      const funcCode = settings.functionalCurrency.code.toUpperCase();
      const docCode = (
        remote.dto.documentCurrencyCode ??
        settings.defaultSaleDocCurrency?.code ??
        funcCode
      ).toUpperCase();

      let fx: ResolvedFxSnapshot;
      try {
        fx = await this.storeFx.resolveFxSnapshot(
          storeId,
          docCode,
          funcCode,
          remote.dto.fxSnapshot,
        );
      } catch (err) {
        if (
          err instanceof BadRequestException ||
          err instanceof NotFoundException
        ) {
          await tx.syncOperation.create({
            data: {
              opId: op.opId,
              storeId,
              deviceId,
              opType: op.opType,
              payload: op.payload as Prisma.InputJsonValue,
              clientTimestamp: clientTs,
              status: 'failed',
              failureReason: 'validation_error',
            },
          });
          buckets.failed.push({
            opId: op.opId,
            reason: 'validation_error',
            details: err.message,
          });
          return;
        }
        throw err;
      }

      const saleDto = {
        ...remote.dto,
        opId: op.opId,
        deviceId: remote.dto.deviceId ?? deviceId,
      };

      try {
        await this.sales.createSaleTx(tx, storeId, saleDto, fx);
      } catch (err) {
        if (
          err instanceof BadRequestException ||
          err instanceof NotFoundException ||
          err instanceof ConflictException
        ) {
          await tx.syncOperation.create({
            data: {
              opId: op.opId,
              storeId,
              deviceId,
              opType: op.opType,
              payload: op.payload as Prisma.InputJsonValue,
              clientTimestamp: clientTs,
              status: 'failed',
              failureReason: 'validation_error',
            },
          });
          buckets.failed.push({
            opId: op.opId,
            reason: 'validation_error',
            details: err.message,
          });
          return;
        }
        throw err;
      }

      const { serverVersion } = await tx.storeSyncState.update({
        where: { storeId },
        data: { serverVersion: { increment: 1 } },
        select: { serverVersion: true },
      });

      await tx.syncOperation.create({
        data: {
          opId: op.opId,
          storeId,
          deviceId,
          opType: op.opType,
          payload: op.payload as Prisma.InputJsonValue,
          clientTimestamp: clientTs,
          status: 'applied',
          serverVersion,
          serverAppliedAt: new Date(),
        },
      });

      buckets.acked.push({ opId: op.opId, serverVersion });
      this.logger.debug(`sync/push: SALE ${op.opId} -> acked`);
      return;
    }

    if (op.opType === 'PURCHASE_RECEIVE') {
      const remote = parsePurchasePayload(
        op.payload as Record<string, unknown>,
      );
      if (!remote) {
        await tx.syncOperation.create({
          data: {
            opId: op.opId,
            storeId,
            deviceId,
            opType: op.opType,
            payload: op.payload as Prisma.InputJsonValue,
            clientTimestamp: clientTs,
            status: 'failed',
            failureReason: 'validation_error',
          },
        });
        buckets.failed.push({
          opId: op.opId,
          reason: 'validation_error',
          details:
            'Invalid purchase payload: need purchase.storeId, purchase.supplierId, purchase.lines[].productId, quantity, unitCost (strings)',
        });
        return;
      }

      if (remote.storeId !== storeId) {
        await tx.syncOperation.create({
          data: {
            opId: op.opId,
            storeId,
            deviceId,
            opType: op.opType,
            payload: op.payload as Prisma.InputJsonValue,
            clientTimestamp: clientTs,
            status: 'failed',
            failureReason: 'validation_error',
          },
        });
        buckets.failed.push({
          opId: op.opId,
          reason: 'validation_error',
          details: 'purchase.storeId must match X-Store-Id',
        });
        return;
      }

      const settings = await this.prisma.businessSettings.findUnique({
        where: { storeId },
        include: {
          functionalCurrency: true,
          defaultSaleDocCurrency: true,
        },
      });
      if (!settings) {
        throw new NotFoundException('Business settings not found');
      }
      const funcCode = settings.functionalCurrency.code.toUpperCase();
      const docCode = (
        remote.dto.documentCurrencyCode ??
        settings.defaultSaleDocCurrency?.code ??
        funcCode
      ).toUpperCase();

      let fx: ResolvedFxSnapshot;
      try {
        fx = await this.storeFx.resolveFxSnapshot(
          storeId,
          docCode,
          funcCode,
          remote.dto.fxSnapshot,
        );
      } catch (err) {
        if (
          err instanceof BadRequestException ||
          err instanceof NotFoundException
        ) {
          await tx.syncOperation.create({
            data: {
              opId: op.opId,
              storeId,
              deviceId,
              opType: op.opType,
              payload: op.payload as Prisma.InputJsonValue,
              clientTimestamp: clientTs,
              status: 'failed',
              failureReason: 'validation_error',
            },
          });
          buckets.failed.push({
            opId: op.opId,
            reason: 'validation_error',
            details: err.message,
          });
          return;
        }
        throw err;
      }

      const purchaseDto = {
        ...remote.dto,
        opId: op.opId,
      };

      try {
        await this.purchases.createPurchaseTx(tx, storeId, purchaseDto, fx);
      } catch (err) {
        if (
          err instanceof BadRequestException ||
          err instanceof NotFoundException
        ) {
          await tx.syncOperation.create({
            data: {
              opId: op.opId,
              storeId,
              deviceId,
              opType: op.opType,
              payload: op.payload as Prisma.InputJsonValue,
              clientTimestamp: clientTs,
              status: 'failed',
              failureReason: 'validation_error',
            },
          });
          buckets.failed.push({
            opId: op.opId,
            reason: 'validation_error',
            details: err.message,
          });
          return;
        }
        throw err;
      }

      const { serverVersion } = await tx.storeSyncState.update({
        where: { storeId },
        data: { serverVersion: { increment: 1 } },
        select: { serverVersion: true },
      });

      await tx.syncOperation.create({
        data: {
          opId: op.opId,
          storeId,
          deviceId,
          opType: op.opType,
          payload: op.payload as Prisma.InputJsonValue,
          clientTimestamp: clientTs,
          status: 'applied',
          serverVersion,
          serverAppliedAt: new Date(),
        },
      });

      buckets.acked.push({ opId: op.opId, serverVersion });
      this.logger.debug(`sync/push: PURCHASE_RECEIVE ${op.opId} -> acked`);
      return;
    }

    if (op.opType === 'SALE_RETURN') {
      const remote = parseSaleReturnPayload(
        op.payload as Record<string, unknown>,
      );
      if (!remote) {
        await tx.syncOperation.create({
          data: {
            opId: op.opId,
            storeId,
            deviceId,
            opType: op.opType,
            payload: op.payload as Prisma.InputJsonValue,
            clientTimestamp: clientTs,
            status: 'failed',
            failureReason: 'validation_error',
          },
        });
        buckets.failed.push({
          opId: op.opId,
          reason: 'validation_error',
          details:
            'Invalid saleReturn payload: need saleReturn.storeId, originalSaleId, lines[].saleLineId, quantity (strings)',
        });
        return;
      }

      if (remote.storeId !== storeId) {
        await tx.syncOperation.create({
          data: {
            opId: op.opId,
            storeId,
            deviceId,
            opType: op.opType,
            payload: op.payload as Prisma.InputJsonValue,
            clientTimestamp: clientTs,
            status: 'failed',
            failureReason: 'validation_error',
          },
        });
        buckets.failed.push({
          opId: op.opId,
          reason: 'validation_error',
          details: 'saleReturn.storeId must match X-Store-Id',
        });
        return;
      }

      const returnDto = {
        ...remote.dto,
        opId: op.opId,
      };

      try {
        await this.saleReturns.createSaleReturnTx(tx, storeId, returnDto);
      } catch (err) {
        if (
          err instanceof BadRequestException ||
          err instanceof NotFoundException
        ) {
          await tx.syncOperation.create({
            data: {
              opId: op.opId,
              storeId,
              deviceId,
              opType: op.opType,
              payload: op.payload as Prisma.InputJsonValue,
              clientTimestamp: clientTs,
              status: 'failed',
              failureReason: 'validation_error',
            },
          });
          buckets.failed.push({
            opId: op.opId,
            reason: 'validation_error',
            details: err.message,
          });
          return;
        }
        throw err;
      }

      const { serverVersion } = await tx.storeSyncState.update({
        where: { storeId },
        data: { serverVersion: { increment: 1 } },
        select: { serverVersion: true },
      });

      await tx.syncOperation.create({
        data: {
          opId: op.opId,
          storeId,
          deviceId,
          opType: op.opType,
          payload: op.payload as Prisma.InputJsonValue,
          clientTimestamp: clientTs,
          status: 'applied',
          serverVersion,
          serverAppliedAt: new Date(),
        },
      });

      buckets.acked.push({ opId: op.opId, serverVersion });
      this.logger.debug(`sync/push: SALE_RETURN ${op.opId} -> acked`);
      return;
    }

    buckets.failed.push({
      opId: op.opId,
      reason: 'unknown_op_type',
      details: op.opType,
    });
  }
}
