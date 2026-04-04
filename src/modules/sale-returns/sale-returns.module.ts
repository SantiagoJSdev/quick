import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SaleReturnsController } from './sale-returns.controller';
import { SaleReturnsService } from './sale-returns.service';

@Module({
  imports: [InventoryModule],
  controllers: [SaleReturnsController],
  providers: [SaleReturnsService],
  exports: [SaleReturnsService],
})
export class SaleReturnsModule {}
