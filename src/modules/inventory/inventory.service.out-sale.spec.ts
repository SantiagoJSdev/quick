import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryService } from './inventory.service';

describe('InventoryService.applyOutSaleLineTx', () => {
  const storeId = '10000000-0000-4000-8000-000000000001';
  const productId = '20000000-0000-4000-8000-000000000002';
  const saleId = '30000000-0000-4000-8000-000000000003';

  function makeTx(opts: {
    quantity: string;
    allowNegative: boolean;
    blockSaleWithoutStock?: boolean;
  }) {
    const item = {
      id: 'inv-1',
      productId,
      storeId,
      quantity: new Prisma.Decimal(opts.quantity),
      reserved: new Prisma.Decimal(0),
      averageUnitCostFunctional: new Prisma.Decimal('5'),
      totalCostFunctional: new Prisma.Decimal(opts.quantity).mul(5),
    };

    const tx = {
      stockMovement: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'mov-1' }),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: productId,
          blockSaleWithoutStock: opts.blockSaleWithoutStock ?? false,
        }),
      },
      businessSettings: {
        findUnique: jest.fn().mockResolvedValue({
          allowNegativeStockAtPos: opts.allowNegative,
          blockRestrictedProductsWithoutStock: true,
          warnOnNegativeStock: true,
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

  it('allows negative stock when store policy permits', async () => {
    const { tx, item } = makeTx({ quantity: '0', allowNegative: true });
    const result = await service.applyOutSaleLineTx(tx as never, {
      storeId,
      productId,
      quantity: new Prisma.Decimal('1'),
      saleId,
    });

    expect(result.stockConflict).toBe(true);
    expect(result.quantityAfter).toBe('-1');
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: new Prisma.Decimal('-1'),
        }),
      }),
    );
    expect(item.quantity.toString()).toBe('0');
  });

  it('rejects when policy is strict', async () => {
    const { tx } = makeTx({ quantity: '0', allowNegative: false });
    await expect(
      service.applyOutSaleLineTx(tx as never, {
        storeId,
        productId,
        quantity: new Prisma.Decimal('1'),
        saleId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects restricted product without stock even if store allows negative', async () => {
    const { tx } = makeTx({
      quantity: '0',
      allowNegative: true,
      blockSaleWithoutStock: true,
    });
    await expect(
      service.applyOutSaleLineTx(tx as never, {
        storeId,
        productId,
        quantity: new Prisma.Decimal('1'),
        saleId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
