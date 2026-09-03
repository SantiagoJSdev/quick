import { Prisma } from '@prisma/client';
import { inventoryValuationFunctional } from './operational-unit-cost';

/** Totales de ítem de inventario espejando `Product.cost` (sin promedio ponderado). */
export function inventoryItemTotalsFromCatalog(
  quantity: Prisma.Decimal,
  catalogCost: Prisma.Decimal | null | undefined,
): { unitCost: Prisma.Decimal; totalCost: Prisma.Decimal } {
  return inventoryValuationFunctional(quantity, catalogCost, null);
}
