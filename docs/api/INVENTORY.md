# Inventario — ajustes (`POST /inventory/adjustments`)

Header obligatorio: `X-Store-Id`.

## Body

| Campo | Tipo | Notas |
|-------|------|--------|
| `productId` | UUID | |
| `type` | `IN_ADJUST` \| `OUT_ADJUST` | |
| `quantity` | string decimal | Magnitud positiva |
| `unitCostFunctional` | string decimal, opcional | Ver reglas IN_ADJUST abajo |
| `reason` | string, opcional | |
| `opId` | UUID, opcional | Idempotencia offline/sync |

## IN_ADJUST — resolución de costo unitario

Política costo v1: **solo catálogo** (`Product.cost`), sin promedio ponderado.

Orden cuando **no** se envía `unitCostFunctional` (o viene vacío):

1. **`Product.cost`** (moneda funcional) si **> 0**.
2. Stock previo ≤ 0 y catálogo = 0 → **400** `UNIT_COST_REQUIRED_FOR_ZERO_STOCK`.
3. Stock previo > 0 y catálogo = 0 → **400** `INVALID_UNIT_COST_FOR_IN_ADJUST` (actualizá catálogo o mandá costo).

Si el cliente envía `unitCostFunctional` explícito (> 0):

- Se usa ese valor en el movimiento.
- Se actualiza **`Product.cost`** en catálogo (sin recalcular precio de lista; eso solo en compras).
- Emite `PRODUCT_UPDATED` en change log.

## OUT_ADJUST

Salida a **`Product.cost`** actual; no requiere `unitCostFunctional`.

## Respuesta

- `{ "status": "applied", "movementId": "<uuid>" }`
- `{ "status": "skipped", "reason": "duplicate_op_id", "movementId": "<uuid>" }` si `opId` ya existía

## Ejemplo — reingreso con stock 0 (fallback catálogo)

Producto con `quantity = 0`, `Product.cost = "8.50"`:

```json
{
  "productId": "...",
  "type": "IN_ADJUST",
  "quantity": "4",
  "reason": "Reposición charcutería"
}
```

El movimiento queda con `unitCostFunctional = 8.50`. Totales de inventario = `quantity × Product.cost`.

Ver [COST_POLICY.md](../COST_POLICY.md).
