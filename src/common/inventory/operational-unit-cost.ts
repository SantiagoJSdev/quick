import { Prisma } from '@prisma/client';

/**
 * Costo unitario operativo (Quick Market): `Product.cost` del catálogo — el que
 * el dueño mantiene al día cuando sube/baja el proveedor. El promedio de
 * inventario solo se usa si el catálogo está en 0 (producto sin costo cargado).
 */
export function operationalUnitCostFunctional(
  catalogCost: Prisma.Decimal | null | undefined,
  averageUnitCost: Prisma.Decimal | null | undefined,
): Prisma.Decimal {
  if (catalogCost != null && catalogCost.gt(0)) {
    return catalogCost;
  }
  if (averageUnitCost != null && averageUnitCost.gt(0)) {
    return averageUnitCost;
  }
  return new Prisma.Decimal(0);
}

/** Valor en stock = qty × costo operativo (catálogo primero). */
export function inventoryValuationFunctional(
  quantity: Prisma.Decimal,
  catalogCost: Prisma.Decimal | null | undefined,
  averageUnitCost: Prisma.Decimal | null | undefined,
): { unitCost: Prisma.Decimal; totalCost: Prisma.Decimal } {
  const unitCost = operationalUnitCostFunctional(catalogCost, averageUnitCost);
  return {
    unitCost,
    totalCost: quantity.mul(unitCost),
  };
}
