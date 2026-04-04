import type { InventoryAdjustDto } from './dto/inventory-adjust.dto';

/** Interpreta `payload` de `sync/push` con `opType: INVENTORY_ADJUST`. */
export function parseInventoryAdjustPayload(
  payload: Record<string, unknown>,
): Omit<InventoryAdjustDto, 'opId'> | null {
  const raw = payload.inventoryAdjust ?? payload;
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.productId !== 'string' || typeof o.type !== 'string') {
    return null;
  }
  if (o.type !== 'IN_ADJUST' && o.type !== 'OUT_ADJUST') {
    return null;
  }
  if (typeof o.quantity !== 'string') {
    return null;
  }
  return {
    productId: o.productId,
    type: o.type,
    quantity: o.quantity,
    reason: typeof o.reason === 'string' ? o.reason : undefined,
    unitCostFunctional:
      typeof o.unitCostFunctional === 'string'
        ? o.unitCostFunctional
        : undefined,
  };
}
