import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DISABLED_MESSAGE =
  'Product images are not available (FEATURE_PRODUCT_IMAGES is disabled for Phase 1).';

@Injectable()
export class ProductImagesFeatureService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Enabled only when FEATURE_PRODUCT_IMAGES=1|true.
   * Unset defaults to enabled in non-production, disabled in production.
   */
  isEnabled(): boolean {
    const raw = this.config.get<string>('FEATURE_PRODUCT_IMAGES');
    if (raw !== undefined && raw !== '') {
      const v = raw.trim().toLowerCase();
      if (v === '1' || v === 'true' || v === 'yes') {
        return true;
      }
      if (v === '0' || v === 'false' || v === 'no') {
        return false;
      }
    }
    return process.env.NODE_ENV !== 'production';
  }

  assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(DISABLED_MESSAGE);
    }
  }
}
