import { parseSalePayload } from './sale-sync-payload';

describe('parseSalePayload', () => {
  const minimalSale = {
    storeId: '10000000-0000-4000-8000-000000000001',
    lines: [
      {
        productId: '20000000-0000-4000-8000-000000000002',
        quantity: '1',
        price: '10.00',
      },
    ],
  };

  it('accepts minimal valid payload', () => {
    const r = parseSalePayload({ sale: minimalSale });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.storeId).toBe(minimalSale.storeId);
      expect(r.data.dto.lines).toHaveLength(1);
    }
  });

  it('rejects numeric quantity/price with explicit hint for Flutter', () => {
    const r = parseSalePayload({
      sale: {
        ...minimalSale,
        lines: [
          {
            productId: '20000000-0000-4000-8000-000000000002',
            quantity: 1,
            price: 10.0,
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.details).toContain('strings');
      expect(r.details).toContain('number');
    }
  });

  it('rejects missing sale wrapper', () => {
    const r = parseSalePayload({} as Record<string, unknown>);
    expect(r.ok).toBe(false);
  });
});
