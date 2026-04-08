import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductImagesController } from './product-images.controller';
import { ProductsController } from './products.controller';
import { ProductsWithStockController } from './products-with-stock.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [InventoryModule],
  controllers: [
    ProductsController,
    ProductsWithStockController,
    ProductImagesController,
  ],
  providers: [ProductsService],
})
export class ProductsModule {}

