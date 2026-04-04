import { Module } from '@nestjs/common';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { OpsAuthGuard } from './ops-auth.guard';
import { QueueMetricsService } from './queue-metrics.service';
import { OpsController } from './ops.controller';
import { OpsSchedulerService } from './ops-scheduler.service';

@Module({
  controllers: [OpsController],
  providers: [
    InventoryReconciliationService,
    QueueMetricsService,
    OpsSchedulerService,
    OpsAuthGuard,
  ],
})
export class OpsModule {}
