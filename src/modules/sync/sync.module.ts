import { Module } from '@nestjs/common';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SaleReturnsModule } from '../sale-returns/sale-returns.module';
import { SalesModule } from '../sales/sales.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [
    InventoryModule,
    ExchangeRatesModule,
    SalesModule,
    PurchasesModule,
    SaleReturnsModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
