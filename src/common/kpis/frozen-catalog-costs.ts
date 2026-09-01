import { Prisma } from '@prisma/client';

/** Línea de inventario congelada en `StoreCapitalSnapshot.inventorySkuCosts`. */
export type FrozenSkuCostLine = {
  productId: string;
  quantity: string;
  unitCostFunctional: string;
  totalCostFunctional: string;
  sku?: string;
  name?: string;
};

export type FrozenSkuCostsPayload = {
  lines: FrozenSkuCostLine[];
};

export function frozenSkuCostsPayload(
  lines: FrozenSkuCostLine[],
): FrozenSkuCostsPayload {
  return { lines };
}

/** Mapa productId → costo unitario funcional desde JSON de snapshot. */
export function frozenCostMapFromSnapshot(
  json: unknown,
): Map<string, Prisma.Decimal> {
  const map = new Map<string, Prisma.Decimal>();
  if (!json || typeof json !== 'object') {
    return map;
  }
  const lines = (json as FrozenSkuCostsPayload).lines;
  if (!Array.isArray(lines)) {
    return map;
  }
  for (const line of lines) {
    if (
      line &&
      typeof line.productId === 'string' &&
      typeof line.unitCostFunctional === 'string' &&
      line.unitCostFunctional.trim() !== ''
    ) {
      const unit = new Prisma.Decimal(line.unitCostFunctional);
      if (unit.isFinite() && unit.gte(0)) {
        map.set(line.productId, unit);
      }
    }
  }
  return map;
}

export function frozenUnitCostForProduct(
  frozenByProduct: Map<string, Prisma.Decimal> | undefined,
  productId: string,
  liveCatalogCost: Prisma.Decimal,
): Prisma.Decimal {
  const frozen = frozenByProduct?.get(productId);
  if (frozen != null && frozen.gt(0)) {
    return frozen;
  }
  return liveCatalogCost;
}
