import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryService } from './inventory.service';

describe('InventoryService.applyAdjustTx IN_ADJUST', () => {
  const storeId = '10000000-0000-4000-8000-000000000001';
  const productId = '20000000-0000-4000-8000-000000000002';

  function makeTx(opts: {
    quantity: string;
    averageUnitCost?: string;
    productCost?: string;
    unitCostFunctional?: string;
  }) {
    const item = {
      id: 'inv-1',
      productId,
      storeId,
      quantity: new Prisma.Decimal(opts.quantity),
      reserved: new Prisma.Decimal(0),
      minStock: new Prisma.Decimal(0),
      averageUnitCostFunctional: new Prisma.Decimal(
        opts.averageUnitCost ?? '0',
      ),
      totalCostFunctional: new Prisma.Decimal(0),
    };

    const tx = {
      stockMovement: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'mov-in-1' }),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: productId,
          cost: new Prisma.Decimal(opts.productCost ?? '0'),
        }),
      },
      inventoryItem: {
        findUnique: jest.fn().mockResolvedValue(item),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    return { tx, item };
  }

  const service = new InventoryService({} as never);

  it('uses Product.cost when stock is 0 and unitCostFunctional is omitted', async () => {
    const { tx } = makeTx({ quantity: '0', productCost: '12.50' });

    const result = await service.applyAdjustTx(tx as never, storeId, {
      productId,
      type: 'IN_ADJUST',
      quantity: '4',
    });

    expect(result).toEqual({ status: 'applied', movementId: 'mov-in-1' });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitCostFunctional: new Prisma.Decimal('12.50'),
          totalCostFunctional: new Prisma.Decimal('50'),
        }),
      }),
    );
  });

  it('uses average cost when stock > 0 and unitCostFunctional is omitted', async () => {
    const { tx } = makeTx({
      quantity: '10',
      averageUnitCost: '3',
      productCost: '99',
    });

    await service.applyAdjustTx(tx as never, storeId, {
      productId,
      type: 'IN_ADJUST',
      quantity: '2',
    });

    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitCostFunctional: new Prisma.Decimal('3'),
        }),
      }),
    );
  });

  it('throws UNIT_COST_REQUIRED_FOR_ZERO_STOCK when stock is 0 and catalog cost is 0', async () => {
    const { tx } = makeTx({ quantity: '0', productCost: '0' });

    await expect(
      service.applyAdjustTx(tx as never, storeId, {
        productId,
        type: 'IN_ADJUST',
        quantity: '4',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'UNIT_COST_REQUIRED_FOR_ZERO_STOCK',
        message: 'Indicá costo unitario al reingresar stock con cantidad 0.',
      },
    });
  });

  it('uses explicit unitCostFunctional over Product.cost', async () => {
    const { tx } = makeTx({ quantity: '0', productCost: '12.50' });

    await service.applyAdjustTx(tx as never, storeId, {
      productId,
      type: 'IN_ADJUST',
      quantity: '1',
      unitCostFunctional: '7.25',
    });

    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          unitCostFunctional: new Prisma.Decimal('7.25'),
        }),
      }),
    );
  });

  it('rejects invalid explicit unit cost', async () => {
    const { tx } = makeTx({ quantity: '5', averageUnitCost: '2' });

    await expect(
      service.applyAdjustTx(tx as never, storeId, {
        productId,
        type: 'IN_ADJUST',
        quantity: '1',
        unitCostFunctional: '0',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
