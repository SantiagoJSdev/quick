import { Module } from '@nestjs/common';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PosDeviceModule } from '../pos-device/pos-device.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { SaleReturnsModule } from '../sale-returns/sale-returns.module';
import { SalesModule } from '../sales/sales.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [
    InventoryModule,
    ExchangeRatesModule,
    PosDeviceModule,
    SalesModule,
    PurchasesModule,
    SaleReturnsModule,
    SuppliersModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
