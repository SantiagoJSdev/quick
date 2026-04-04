import { ProductType } from '@prisma/client';
import { buildProductOutboxPayload } from './product-outbox.payload';
import type { ProductForOutbox } from './product-outbox.payload';

describe('buildProductOutboxPayload', () => {
  it('includes stable fields expected by OutboxMongoWorker', () => {
    const product = {
      id: 'p1',
      sku: 'SKU1',
      barcode: null,
      name: 'N',
      description: null,
      image: null,
      type: ProductType.GOODS,
      unit: 'unidad',
      currency: 'VES',
      price: { toString: () => '10.00' },
      cost: { toString: () => '5.00' },
      active: true,
      updatedAt: new Date('2026-04-04T00:00:00.000Z'),
      category: { id: 'c1', name: 'Cat' },
      tax: { id: 't1', name: 'IVA', rate: { toString: () => '0.16' } },
      supplier: { id: 's1', name: 'Sup' },
    } as unknown as ProductForOutbox;

    const payload = buildProductOutboxPayload(product) as {
      product: { id: string; price: string; category: { id: string; name: string } };
    };
    expect(payload.product.id).toBe('p1');
    expect(payload.product.price).toBe('10.00');
    expect(payload.product.category).toEqual({ id: 'c1', name: 'Cat' });
  });
});
