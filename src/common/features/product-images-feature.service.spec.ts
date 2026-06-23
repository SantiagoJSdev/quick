import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { ProductImagesFeatureService } from './product-images-feature.service';

function svc(env: Record<string, string | undefined>): ProductImagesFeatureService {
  return new ProductImagesFeatureService(
    new ConfigService(env as Record<string, string>),
  );
}

describe('ProductImagesFeatureService', () => {
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
  });

  it('is disabled when FEATURE_PRODUCT_IMAGES=0', () => {
    process.env.NODE_ENV = 'development';
    expect(svc({ FEATURE_PRODUCT_IMAGES: '0' }).isEnabled()).toBe(false);
  });

  it('is enabled when FEATURE_PRODUCT_IMAGES=1', () => {
    process.env.NODE_ENV = 'production';
    expect(svc({ FEATURE_PRODUCT_IMAGES: '1' }).isEnabled()).toBe(true);
  });

  it('defaults to disabled in production when unset', () => {
    process.env.NODE_ENV = 'production';
    expect(svc({}).isEnabled()).toBe(false);
  });

  it('defaults to enabled in non-production when unset', () => {
    process.env.NODE_ENV = 'development';
    expect(svc({}).isEnabled()).toBe(true);
  });

  it('assertEnabled throws when disabled', () => {
    process.env.NODE_ENV = 'production';
    expect(() => svc({ FEATURE_PRODUCT_IMAGES: '0' }).assertEnabled()).toThrow(
      ServiceUnavailableException,
    );
  });
});
