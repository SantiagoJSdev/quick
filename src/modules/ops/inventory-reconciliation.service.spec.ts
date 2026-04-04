import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryReconciliationService } from './inventory-reconciliation.service';

describe('InventoryReconciliationService', () => {
  it('flags quantity_mismatch when on-hand differs from movement sum', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { storeId: 's1', productId: 'p1', expected: '10' },
      ]),
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            storeId: 's1',
            productId: 'p1',
            quantity: new Prisma.Decimal('9'),
            product: { sku: 'SKU1' },
          },
        ]),
      },
      product: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const svc = new InventoryReconciliationService(prisma);
    const r = await svc.runInventoryCheck();

    expect(r.mismatchCount).toBe(1);
    expect(r.mismatches[0].kind).toBe('quantity_mismatch');
    expect(r.mismatches[0].delta).toBe('-1');
  });

  it('flags movements_without_line when sum non-zero but no InventoryItem', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { storeId: 's1', productId: 'p1', expected: '0' },
        { storeId: 's1', productId: 'p2', expected: '5' },
      ]),
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            storeId: 's1',
            productId: 'p1',
            quantity: new Prisma.Decimal(0),
            product: { sku: 'A' },
          },
        ]),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([{ id: 'p2', sku: 'ORPHAN' }]),
      },
    } as unknown as PrismaService;

    const svc = new InventoryReconciliationService(prisma);
    const r = await svc.runInventoryCheck();

    expect(r.mismatches.some((m) => m.kind === 'movements_without_line')).toBe(
      true,
    );
    const orphan = r.mismatches.find((m) => m.productId === 'p2');
    expect(orphan?.sku).toBe('ORPHAN');
  });
});
