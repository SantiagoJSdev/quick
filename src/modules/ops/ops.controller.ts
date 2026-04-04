import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SkipStoreConfigured } from '../../common/metadata';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { OpsAuthGuard } from './ops-auth.guard';
import { QueueMetricsService } from './queue-metrics.service';

@ApiTags('ops')
@Controller('ops')
@SkipStoreConfigured()
@UseGuards(OpsAuthGuard)
@ApiSecurity('X-Ops-Api-Key')
@ApiSecurity('ops-bearer')
export class OpsController {
  constructor(
    private readonly reconciliation: InventoryReconciliationService,
    private readonly queues: QueueMetricsService,
  ) {}

  @Get('metrics')
  @ApiOperation({
    summary:
      'Métricas operativas: reconciliación inventario, outbox, sync (sin X-Store-Id). Si `OPS_API_KEY` está definido, enviar `X-Ops-Api-Key` o `Authorization: Bearer`. Opcional: `OPS_IP_ALLOWLIST`.',
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
