import { randomUUID } from 'crypto';
import {
  parseSupplierCreatePayload,
  parseSupplierDeactivatePayload,
  parseSupplierUpdatePayload,
} from './supplier-sync-payload';

describe('supplier-sync-payload', () => {
  const clientId = randomUUID();

  it('parseSupplierCreatePayload accepts minimal supplier + clientSupplierId', () => {
    const r = parseSupplierCreatePayload({
      supplier: { clientSupplierId: clientId, name: '  Acme  ' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.clientSupplierId).toBe(clientId);
      expect(r.dto.name).toBe('Acme');
    }
  });

  it('parseSupplierCreatePayload rejects missing clientSupplierId', () => {
    const r = parseSupplierCreatePayload({
      supplier: { name: 'X' },
    });
    expect(r.ok).toBe(false);
  });

  it('parseSupplierUpdatePayload requires a patch field', () => {
    const r = parseSupplierUpdatePayload({
      supplier: { supplierId: clientId },
    });
    expect(r.ok).toBe(false);
  });

  it('parseSupplierUpdatePayload accepts active flag', () => {
    const r = parseSupplierUpdatePayload({
      supplier: { supplierId: clientId, active: true },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dto.active).toBe(true);
    }
  });

  it('parseSupplierDeactivatePayload', () => {
    const r = parseSupplierDeactivatePayload({
      supplier: { supplierId: clientId },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.supplierId).toBe(clientId);
    }
  });
});
