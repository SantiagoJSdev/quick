import { Module } from '@nestjs/common';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { QueueMetricsService } from './queue-metrics.service';
import { OpsController } from './ops.controller';
import { OpsSchedulerService } from './ops-scheduler.service';

@Module({
  controllers: [OpsController],
  providers: [
    InventoryReconciliationService,
    QueueMetricsService,
    OpsSchedulerService,
  ],
})
export class OpsModule {}
