import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ProductImagesFeatureService } from '../features/product-images-feature.service';

@Injectable()
export class ProductImagesEnabledGuard implements CanActivate {
  constructor(private readonly feature: ProductImagesFeatureService) {}

  canActivate(_context: ExecutionContext): boolean {
    this.feature.assertEnabled();
    return true;
  }
}
