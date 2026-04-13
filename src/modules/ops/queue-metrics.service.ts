import { Injectable } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type OutboxMetrics = {
  byStatus: Record<string, number>;
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  processedApprox: number;
  oldestPendingAvailableAt: string | null;
  pendingLagSeconds: number | null;
};

/** Filas fallidas recientes para correlacionar con el cliente (mismo `opId` que el POS reintenta). */
export type FailedSyncOperationSample = {
  opId: string;
  storeId: string;
  deviceId: string;
  opType: string;
  failureReason: string | null;
  /** Mismo texto que `failed[].details` en `POST /sync/push` (vacío en filas antiguas). */
  failureDetails: string | null;
  clientTimestamp: string;
};

export type SyncMetrics = {
  byStatus: Record<string, number>;
  pendingCount: number;
  failedCount: number;
  appliedCount: number;
  storeVersions: { storeId: string; serverVersion: number }[];
  /** Hasta 30 registros `status=failed` más recientes (por `clientTimestamp` desc). Vacío si no hay fallos. */
  failedSamples: FailedSyncOperationSample[];
};

@Injectable()
export class QueueMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOutboxMetrics(): Promise<OutboxMetrics> {
    const rows = await this.prisma.outboxEvent.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = r._count._all;
    }

    const pendingCount = byStatus[OutboxStatus.PENDING] ?? 0;
    const processingCount = byStatus[OutboxStatus.PROCESSING] ?? 0;
    const failedCount = byStatus[OutboxStatus.FAILED] ?? 0;
    const processedApprox = byStatus[OutboxStatus.PROCESSED] ?? 0;

    const oldest = await this.prisma.outboxEvent.findFirst({
      where: { status: OutboxStatus.PENDING },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    });

    const now = Date.now();
    const oldestPendingAvailableAt = oldest?.availableAt.toISOString() ?? null;
    const pendingLagSeconds =
      oldest != null
        ? Math.max(0, Math.floor((now - oldest.availableAt.getTime()) / 1000))
        : null;

    return {
      byStatus,
      pendingCount,
      processingCount,
      failedCount,
      processedApprox,
      oldestPendingAvailableAt,
      pendingLagSeconds,
    };
  }

  async getSyncMetrics(): Promise<SyncMetrics> {
    const rows = await this.prisma.syncOperation.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = r._count._all;
    }

    const pendingCount = byStatus['pending'] ?? 0;
    const failedCount = byStatus['failed'] ?? 0;
    const appliedCount = byStatus['applied'] ?? 0;

    const storeVersions = await this.prisma.storeSyncState.findMany({
      select: { storeId: true, serverVersion: true },
      orderBy: { storeId: 'asc' },
    });

    const failedSamples: FailedSyncOperationSample[] =
      failedCount > 0
        ? (
            await this.prisma.syncOperation.findMany({
              where: { status: 'failed' },
              orderBy: { clientTimestamp: 'desc' },
              take: 30,
              select: {
                opId: true,
                storeId: true,
                deviceId: true,
                opType: true,
                failureReason: true,
                failureDetails: true,
                clientTimestamp: true,
              },
            })
          ).map((r) => ({
            opId: r.opId,
            storeId: r.storeId,
            deviceId: r.deviceId,
            opType: r.opType,
            failureReason: r.failureReason,
            failureDetails: r.failureDetails,
            clientTimestamp: r.clientTimestamp.toISOString(),
          }))
        : [];

    return {
      byStatus,
      pendingCount,
      failedCount,
      appliedCount,
      storeVersions,
      failedSamples,
    };
  }
}
