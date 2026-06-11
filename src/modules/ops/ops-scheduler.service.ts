import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { QueueMetricsService } from './queue-metrics.service';

@Injectable()
export class OpsSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpsSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly reconciliation: InventoryReconciliationService,
    private readonly queues: QueueMetricsService,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<string>('OPS_SCHEDULER_ENABLED', '1');
    if (enabled === '0' || enabled === 'false') {
      this.logger.log('OPS_SCHEDULER_DISABLED: periodic ops checks skipped');
      return;
    }

    const intervalMs = Number(
      this.config.get<string>('OPS_SCHEDULER_INTERVAL_MS', '120000'),
    );
    if (!Number.isFinite(intervalMs) || intervalMs < 10000) {
      this.logger.warn(
        'OPS_SCHEDULER_INTERVAL_MS invalid or <10s; using 120000',
      );
      this.timer = setInterval(() => void this.tick(), 120000);
      return;
    }

    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.logger.log(
      `Ops scheduler: inventory/sync checks every ${intervalMs}ms`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** WARN periódicos del job solo en desarrollo; prod consulta GET /ops/metrics bajo demanda. */
  private shouldEmitPeriodicWarnLogs(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  private async tick(): Promise<void> {
    try {
      const [inv, sync] = await Promise.all([
        this.reconciliation.runInventoryCheck(),
        this.queues.getSyncMetrics(),
      ]);

      if (!this.shouldEmitPeriodicWarnLogs()) {
        return;
      }

      if (inv.mismatchCount > 0) {
        this.logger.warn(
          `Inventory reconciliation: ${inv.mismatchCount} mismatch(es) — check GET /api/v1/ops/metrics`,
        );
      }

      if (sync.failedCount > 0) {
        const detail =
          sync.failedSamples.length > 0
            ? sync.failedSamples.map((s) => {
                const msg = s.failureDetails ?? s.failureReason;
                const truncated =
                  msg && msg.length > 400
                    ? `${msg.slice(0, 400)}…`
                    : msg;
                return {
                  opId: s.opId,
                  opType: s.opType,
                  deviceId: s.deviceId,
                  storeId: s.storeId,
                  code: s.failureReason,
                  message: truncated,
                  at: s.clientTimestamp,
                };
              })
            : [];
        this.logger.warn(
          `Sync operations failed (historical): ${sync.failedCount} — correlate pending POS ops by opId | ${JSON.stringify(detail)}`,
        );
      }

      if (sync.pendingCount > 0) {
        this.logger.warn(
          `Sync operations stuck pending: ${sync.pendingCount} (should be rare)`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Ops scheduler tick failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
