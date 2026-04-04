import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SkipStoreConfigured } from '../../common/metadata';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { QueueMetricsService } from './queue-metrics.service';

@ApiTags('ops')
@Controller('ops')
@SkipStoreConfigured()
export class OpsController {
  constructor(
    private readonly reconciliation: InventoryReconciliationService,
    private readonly queues: QueueMetricsService,
  ) {}

  @Get('metrics')
  @ApiOperation({
    summary:
      'Métricas operativas: reconciliación inventario, outbox, sync (sin X-Store-Id)',
  })
  @ApiQuery({
    name: 'storeId',
    required: false,
    description: 'Filtra reconciliación de inventario a una tienda (UUID)',
  })
  async metrics(@Query('storeId') storeId?: string) {
    const trimmed = storeId?.trim();
    const [inventory, outbox, sync] = await Promise.all([
      this.reconciliation.runInventoryCheck(trimmed || undefined),
      this.queues.getOutboxMetrics(),
      this.queues.getSyncMetrics(),
    ]);

    return {
      serverTime: new Date().toISOString(),
      inventoryReconciliation: inventory,
      outbox: outbox,
      sync: sync,
    };
  }
}
