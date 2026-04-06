import { Prisma, ProductPricingMode } from '@prisma/client';
import { computeProductMarginDerivatives } from './product-margin-derivatives';

describe('computeProductMarginDerivatives', () => {
  it('USE_STORE_DEFAULT uses store default and suggests price from cost', () => {
    const d = computeProductMarginDerivatives(
      {
        pricingMode: ProductPricingMode.USE_STORE_DEFAULT,
        marginPercentOverride: null,
        price: '11',
        cost: '10',
      },
      { defaultMarginPercent: new Prisma.Decimal('10') },
    );
    expect(d.effectiveMarginPercent).toBe('10');
    expect(d.suggestedPrice).toBe('11');
    expect(d.marginComputedPercent).toBe('10');
  });

  it('USE_PRODUCT_OVERRIDE uses override', () => {
    const d = computeProductMarginDerivatives(
      {
        pricingMode: ProductPricingMode.USE_PRODUCT_OVERRIDE,
        marginPercentOverride: '25',
        price: '10',
        cost: '8',
      },
      { defaultMarginPercent: new Prisma.Decimal('15') },
    );
    expect(d.effectiveMarginPercent).toBe('25');
    expect(d.suggestedPrice).toBe('10');
  });

  it('MANUAL_PRICE has null effective and suggested but can compute margin from P/C', () => {
    const d = computeProductMarginDerivatives(
      {
        pricingMode: ProductPricingMode.MANUAL_PRICE,
        marginPercentOverride: null,
        price: '12',
        cost: '10',
      },
      { defaultMarginPercent: new Prisma.Decimal('15') },
    );
    expect(d.effectiveMarginPercent).toBeNull();
    expect(d.suggestedPrice).toBeNull();
    expect(d.marginComputedPercent).toBe('20');
  });

  it('no marginComputed when cost is zero', () => {
    const d = computeProductMarginDerivatives(
      {
        pricingMode: ProductPricingMode.USE_STORE_DEFAULT,
        price: '5',
        cost: '0',
      },
      { defaultMarginPercent: new Prisma.Decimal('10') },
    );
    expect(d.marginComputedPercent).toBeNull();
    expect(d.suggestedPrice).toBeNull();
  });
});
