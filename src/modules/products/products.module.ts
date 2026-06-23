import { Module } from '@nestjs/common';
import { ProductImagesFeatureService } from '../../common/features/product-images-feature.service';
import { ProductImagesEnabledGuard } from '../../common/guards/product-images-enabled.guard';
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
  providers: [
    ProductsService,
    ProductImagesFeatureService,
    ProductImagesEnabledGuard,
  ],
})
export class ProductsModule {}

