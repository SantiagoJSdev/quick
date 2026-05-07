import type { InventoryService } from '../inventory/inventory.service';
import type { PurchasesService } from '../purchases/purchases.service';
import type { SaleReturnsService } from '../sale-returns/sale-returns.service';
import type { SalesService } from '../sales/sales.service';
import type { StoreFxSnapshotService } from '../exchange-rates/store-fx-snapshot.service';
import type { PosDeviceService } from '../pos-device/pos-device.service';
import type { SuppliersService } from '../suppliers/suppliers.service';
import { SyncService } from './sync.service';

const STORE_ID = '10000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '20000000-0000-4000-8000-000000000002';

function buildServiceWithPrisma(
  prisma: import('../../prisma/prisma.service').PrismaService,
) {
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

  const posDevice = {
    touchOrRegister: jest.fn(),
  } as unknown as PosDeviceService;

  const suppliers = {
    createSupplierTx: jest.fn(),
    updateSupplierTx: jest.fn(),
    softDeleteSupplierTx: jest.fn(),
  } as unknown as SuppliersService;

  return {
    service: new SyncService(
      prisma,
      inventory,
      sales,
      purchases,
      saleReturns,
      storeFx,
      posDevice,
      suppliers,
    ),
    inventory,
    sales,
    purchases,
    saleReturns,
    storeFx,
    suppliers,
  };
}

describe('SyncService', () => {
  it('returns empty buckets when ops is empty without opening a transaction', async () => {
    const prisma = {
      $transaction: jest.fn(),
    } as unknown as import('../../prisma/prisma.service').PrismaService;

    const { service } = buildServiceWithPrisma(prisma);
    const result = await service.push(
      { deviceId: 'device-x', ops: [] },
      '00000000-0000-4000-8000-000000000001',
    );

    expect(result.acked).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('push() with mocked $transaction', () => {
    function baseTx() {
      let serverVersion = 9;
      return {
        pOSDevice: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
        },
        storeSyncState: {
          upsert: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockImplementation(() => {
            serverVersion += 1;
            return Promise.resolve({ serverVersion });
          }),
        },
        syncOperation: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      };
    }

    it('NOOP: acks one op and increments serverVersion', async () => {
      const tx = baseTx();
      const prisma = {
        $transaction: jest.fn((fn: (t: unknown) => Promise<void>) => fn(tx)),
      } as unknown as import('../../prisma/prisma.service').PrismaService;

      const { service } = buildServiceWithPrisma(prisma);
      const opId = '30000000-0000-4000-8000-000000000003';
      const result = await service.push(
        {
          deviceId: 'device-sync-test',
          ops: [
            {
              opId,
              opType: 'NOOP',
              timestamp: '2026-04-04T12:00:00.000Z',
              payload: {},
            },
          ],
        },
        STORE_ID,
      );

      expect(result.acked).toEqual([{ opId, serverVersion: 10 }]);
      expect(result.failed).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(tx.syncOperation.create).toHaveBeenCalled();
    });

    it('INVENTORY_ADJUST applied: calls inventory and acks', async () => {
      const tx = baseTx();
      const prisma = {
        $transaction: jest.fn((fn: (t: unknown) => Promise<void>) => fn(tx)),
      } as unknown as import('../../prisma/prisma.service').PrismaService;

      const { service, inventory } = buildServiceWithPrisma(prisma);
      (inventory.applyAdjustTx as jest.Mock).mockResolvedValue({
        status: 'applied',
        movementId: 'mov-1',
      });

      const opId = '40000000-0000-4000-8000-000000000004';
      const result = await service.push(
        {
          deviceId: 'device-inv',
          ops: [
            {
              opId,
              opType: 'INVENTORY_ADJUST',
              timestamp: '2026-04-04T12:00:00.000Z',
              payload: {
                inventoryAdjust: {
                  productId: PRODUCT_ID,
                  type: 'IN_ADJUST',
                  quantity: '1',
                  unitCostFunctional: '2.00',
                },
              },
            },
          ],
        },
        STORE_ID,
      );

      expect(inventory.applyAdjustTx).toHaveBeenCalledWith(
        tx,
        STORE_ID,
        expect.objectContaining({
          opId,
          productId: PRODUCT_ID,
          type: 'IN_ADJUST',
          quantity: '1',
        }),
      );
      expect(result.acked).toEqual([{ opId, serverVersion: 10 }]);
      expect(result.failed).toEqual([]);
    });

    it('unknown opType: records failed without throwing', async () => {
      const tx = baseTx();
      const prisma = {
        $transaction: jest.fn((fn: (t: unknown) => Promise<void>) => fn(tx)),
      } as unknown as import('../../prisma/prisma.service').PrismaService;

      const { service } = buildServiceWithPrisma(prisma);
      const opId = '50000000-0000-4000-8000-000000000005';
      const result = await service.push(
        {
          deviceId: 'device-unk',
          ops: [
            {
              opId,
              opType: 'UNKNOWN_OP' as 'NOOP',
              timestamp: '2026-04-04T12:00:00.000Z',
              payload: {},
            },
          ],
        },
        STORE_ID,
      );

      expect(result.acked).toEqual([]);
      expect(result.failed).toEqual([
        { opId, reason: 'unknown_op_type', details: 'UNKNOWN_OP' },
      ]);
    });
  });
});
