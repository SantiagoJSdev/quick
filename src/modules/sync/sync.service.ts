import {
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { SyncPushDto, SyncPushOpDto } from './dto/sync-push.dto';
import { stableJsonStringify } from './stable-json';

export type SyncPushResult = {
  serverTime: string;
  acked: { opId: string; serverVersion: number }[];
  skipped: { opId: string; reason: string }[];
  failed: { opId: string; reason: string; details?: string }[];
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    if (op.opType === 'SALE' || op.opType === 'INVENTORY_ADJUST') {
      const reason = 'not_implemented';
      const details =
        op.opType === 'SALE'
          ? 'Sale application from sync is not implemented yet (M4).'
          : 'Inventory adjust from sync is not implemented yet (M2).';

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
      this.logger.debug(`sync/push: ${op.opType} ${op.opId} -> failed (${reason})`);
      return;
    }

    buckets.failed.push({
      opId: op.opId,
      reason: 'unknown_op_type',
      details: op.opType,
    });
  }
}
