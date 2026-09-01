import { Prisma } from '@prisma/client';
import { operationalUnitCostFunctional } from '../inventory/operational-unit-cost';

/** COGS unitario de línea de venta: payload offline o catálogo al cobrar. */
export function resolveSaleLineUnitCostFunctional(
  catalogCost: Prisma.Decimal,
  lineUnitCostFunctional?: string,
): Prisma.Decimal {
  if (lineUnitCostFunctional?.trim()) {
    const fromClient = new Prisma.Decimal(lineUnitCostFunctional);
    if (fromClient.isFinite() && fromClient.gt(0)) {
      return fromClient;
    }
  }
  return operationalUnitCostFunctional(catalogCost, null);
}

export function saleLineCogsFunctional(
  quantity: Prisma.Decimal,
  unitCostFunctional: Prisma.Decimal | null | undefined,
  fallbackCatalogCost: Prisma.Decimal,
): Prisma.Decimal {
  if (unitCostFunctional != null && unitCostFunctional.gt(0)) {
    return unitCostFunctional.mul(quantity);
  }
  return resolveSaleLineUnitCostFunctional(fallbackCatalogCost).mul(quantity);
}
