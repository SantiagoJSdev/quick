import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductsController } from './products.controller';
import { ProductsWithStockController } from './products-with-stock.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [InventoryModule],
  controllers: [ProductsController, ProductsWithStockController],
  providers: [ProductsService],
})
export class ProductsModule {}

