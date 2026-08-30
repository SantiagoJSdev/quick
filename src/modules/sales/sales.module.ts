import { Module } from '@nestjs/common';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentMethodsModule } from '../payment-methods/payment-methods.module';
import { PosDeviceModule } from '../pos-device/pos-device.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [
    ExchangeRatesModule,
    InventoryModule,
    PosDeviceModule,
    PaymentMethodsModule,
  ],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
