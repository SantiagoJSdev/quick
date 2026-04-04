import type { InventoryService } from '../inventory/inventory.service';
import type { PurchasesService } from '../purchases/purchases.service';
import type { SaleReturnsService } from '../sale-returns/sale-returns.service';
import type { SalesService } from '../sales/sales.service';
import type { StoreFxSnapshotService } from '../exchange-rates/store-fx-snapshot.service';
import { SyncService } from './sync.service';

describe('SyncService', () => {
  it('returns empty buckets when ops is empty without opening a transaction', async () => {
    const prisma = {
      $transaction: jest.fn(),
    } as unknown as import('../../prisma/prisma.service').PrismaService;

    const inventory = {
      applyAdjustTx: jest.fn(),
    } as unknown as InventoryService;

    const sales = {
      createSaleTx: jest.fn(),
    } as unknown as SalesService;

    const purchases = {
      createPurchaseTx: jest.fn(),
    } as unknown as PurchasesService;

    const saleReturns = {
      createSaleReturnTx: jest.fn(),
    } as unknown as SaleReturnsService;

    const storeFx = {
      resolveFxSnapshot: jest.fn(),
    } as unknown as StoreFxSnapshotService;

    const service = new SyncService(
      prisma,
      inventory,
      sales,
      purchases,
      saleReturns,
      storeFx,
    );
    const result = await service.push(
      { deviceId: 'device-x', ops: [] },
      '00000000-0000-4000-8000-000000000001',
    );

    expect(result.acked).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
