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
import { PrismaService } from '../../prisma/prisma.service';
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
        await this.touchPosDevice(tx, storeId, dto.deviceId);
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

  private async touchPosDevice(
    tx: Prisma.TransactionClient,
    storeId: string,
    deviceId: string,
  ) {
    const dev = await tx.pOSDevice.findUnique({ where: { deviceId } });
    if (dev) {
      if (dev.storeId !== storeId) {
        throw new ConflictException(
          'This device is registered to another store',
        );
      }
      await tx.pOSDevice.update({
        where: { deviceId },
        data: { lastSeen: new Date() },
      });
      return;
    }
    await tx.pOSDevice.create({
      data: { deviceId, storeId },
    });
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
      const reason = 'not_implemented';
      const details =
        'Sale application from sync is not implemented yet (M4).';

      await tx.syncOperation.create({
        data: {
          opId: op.opId,
          storeId,
          deviceId,
          opType: op.opType,
          payload: op.payload as Prisma.InputJsonValue,
          clientTimestamp: clientTs,
          status: 'failed',
          failureReason: reason,
        },
      });

      buckets.failed.push({ opId: op.opId, reason, details });
      this.logger.debug(`sync/push: SALE ${op.opId} -> failed (${reason})`);
      return;
    }

    buckets.failed.push({
      opId: op.opId,
      reason: 'unknown_op_type',
      details: op.opType,
    });
  }
}
