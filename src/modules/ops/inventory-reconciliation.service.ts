import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type InventoryMismatch = {
  storeId: string;
  productId: string;
  sku?: string;
  kind: 'quantity_mismatch' | 'movements_without_line';
  quantityOnHand: string;
  quantityFromMovements: string;
  delta: string;
};

const QTY_EPS = new Prisma.Decimal('0.0001');

function qtyDiffers(a: Prisma.Decimal, b: Prisma.Decimal): boolean {
  return a.minus(b).abs().gt(QTY_EPS);
}

@Injectable()
export class InventoryReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compara `InventoryItem.quantity` con la suma algebraica de `StockMovement`
   * (IN_* suma, OUT_* resta). Opcionalmente filtra por tienda.
   */
  async runInventoryCheck(storeId?: string): Promise<{
    checkedAt: string;
    mismatchCount: number;
    mismatches: InventoryMismatch[];
  }> {
    type SumRow = { storeId: string; productId: string; expected: string };
    let fromMovements: SumRow[];
    if (storeId) {
      fromMovements = await this.prisma.$queryRaw<SumRow[]>`
        SELECT "storeId", "productId",
          COALESCE(SUM(
            CASE
              WHEN type::text LIKE 'IN_%' THEN quantity::numeric
              ELSE (-quantity::numeric)
            END
          ), 0)::text AS expected
        FROM "StockMovement"
        WHERE "storeId" = ${storeId}::uuid
        GROUP BY "storeId", "productId"
      `;
    } else {
      fromMovements = await this.prisma.$queryRaw<SumRow[]>`
        SELECT "storeId", "productId",
          COALESCE(SUM(
            CASE
              WHEN type::text LIKE 'IN_%' THEN quantity::numeric
              ELSE (-quantity::numeric)
            END
          ), 0)::text AS expected
        FROM "StockMovement"
        GROUP BY "storeId", "productId"
      `;
    }

    const expectedMap = new Map<string, Prisma.Decimal>();
    for (const row of fromMovements) {
      const key = `${row.storeId}:${row.productId}`;
      expectedMap.set(key, new Prisma.Decimal(row.expected));
    }

    const items = await this.prisma.inventoryItem.findMany({
      where: storeId ? { storeId } : undefined,
      select: {
        storeId: true,
        productId: true,
        quantity: true,
        product: { select: { sku: true } },
      },
    });

    const mismatches: InventoryMismatch[] = [];
    const seenKeys = new Set<string>();

    for (const item of items) {
      const key = `${item.storeId}:${item.productId}`;
      seenKeys.add(key);
      const expected = expectedMap.get(key) ?? new Prisma.Decimal(0);
      const onHand = item.quantity;
      if (qtyDiffers(onHand, expected)) {
        mismatches.push({
          storeId: item.storeId,
          productId: item.productId,
          sku: item.product.sku,
          kind: 'quantity_mismatch',
          quantityOnHand: onHand.toString(),
          quantityFromMovements: expected.toString(),
          delta: onHand.minus(expected).toString(),
        });
      }
    }

    for (const [key, expected] of expectedMap) {
      if (seenKeys.has(key)) {
        continue;
      }
      if (expected.abs().lte(QTY_EPS)) {
        continue;
      }
      const [sid, pid] = key.split(':');
      mismatches.push({
        storeId: sid,
        productId: pid,
        kind: 'movements_without_line',
        quantityOnHand: '0',
        quantityFromMovements: expected.toString(),
        delta: expected.neg().toString(),
      });
    }

    const productIds = mismatches
      .filter((m) => !m.sku)
      .map((m) => m.productId);
    if (productIds.length > 0) {
      const products = await this.prisma.product.findMany({
        where: { id: { in: [...new Set(productIds)] } },
        select: { id: true, sku: true },
      });
      const skuById = new Map(products.map((p) => [p.id, p.sku]));
      for (const m of mismatches) {
        if (!m.sku) {
          m.sku = skuById.get(m.productId);
        }
      }
    }

    return {
      checkedAt: new Date().toISOString(),
      mismatchCount: mismatches.length,
      mismatches,
    };
  }
}
