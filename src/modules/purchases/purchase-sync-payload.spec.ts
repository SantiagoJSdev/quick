import { parsePurchasePayload } from './purchase-sync-payload';

describe('parsePurchasePayload', () => {
  const baseLines = [
    {
      productId: '11111111-1111-4111-8111-111111111111',
      quantity: '1',
      unitCost: '2.00',
    },
  ];

  it('parses supplierInvoiceReference', () => {
    const r = parsePurchasePayload({
      purchase: {
        storeId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        supplierId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        lines: baseLines,
        supplierInvoiceReference: '  FAC-99 ',
      },
    });
    expect(r).not.toBeNull();
    expect(r!.dto.supplierInvoiceReference).toBe('FAC-99');
  });

  it('accepts reference as alias for sync', () => {
    const r = parsePurchasePayload({
      purchase: {
        storeId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        supplierId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        lines: baseLines,
        reference: 'GUIA-1',
      },
    });
    expect(r).not.toBeNull();
    expect(r!.dto.supplierInvoiceReference).toBe('GUIA-1');
  });

  it('prefers supplierInvoiceReference over reference', () => {
    const r = parsePurchasePayload({
      purchase: {
        storeId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        supplierId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        lines: baseLines,
        supplierInvoiceReference: 'A',
        reference: 'B',
      },
    });
    expect(r!.dto.supplierInvoiceReference).toBe('A');
  });

  it('truncates long reference', () => {
    const long = 'x'.repeat(200);
    const r = parsePurchasePayload({
      purchase: {
        storeId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        supplierId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        lines: baseLines,
        reference: long,
      },
    });
    expect(r!.dto.supplierInvoiceReference).toHaveLength(120);
  });
});
