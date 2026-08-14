# Compras — REST y sync offline

Todas las rutas bajo **`/api/v1/purchases`** exigen header **`X-Store-Id: <uuid de tienda>`** con `Store` + `BusinessSettings` configurados.

## Modelo de pago / deuda

Cada compra tiene:

| Campo | Valores | Significado |
|-------|---------|-------------|
| `paymentStatus` | `PAID` \| `CREDIT` \| `PARTIAL` | Contado / crédito / con abonos |
| `amountPaidFunctional` | decimal string | Ya abonado (moneda funcional) |
| `amountDueFunctional` | decimal string | Saldo pendiente |
| `dueDate` | `YYYY-MM-DD` \| null | Vencimiento (crédito) |
| `paidAt` | ISO datetime \| null | Cuándo quedó PAID |

Abonos en tabla `PurchasePayment` (`POST /purchases/:id/payments`).

**Anulación (v1):** `POST /purchases/:id/void-preview` + `POST /purchases/:id/void`. Soft void (`status=VOID`); no hard-delete. Stock reversible con `OUT_PURCHASE_VOID`; abonos con `reversedAt` (R1). Ver § Anulación abajo.

**Default al crear:** si no envías `paymentStatus` → **`PAID`** (compatibilidad con clientes viejos). El front nuevo debe enviar `CREDIT` o `PAID` explícitamente.

Compras históricas migradas se marcaron `PAID` (sin inventar deuda).

---

## `POST /api/v1/purchases`

Registra una compra recibida, actualiza inventario y movimientos en transacción. Opcionalmente deja deuda abierta.

### Body (JSON)

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `supplierId` | UUID string | Sí | Proveedor de la tienda (activo). |
| `lines` | array | Sí | 1–100 líneas. |
| `lines[].productId` | UUID string | Sí | |
| `lines[].quantity` | string numérica | Sí | Ej. `"10"` |
| `lines[].unitCost` | string numérica | Sí | Costo unitario en moneda del documento. |
| `documentCurrencyCode` | string | No | Ej. `VES`. |
| **`supplierInvoiceReference`** | string | No | Factura/guía. Máx. 120 caracteres. |
| **`paymentStatus`** | string | No | `PAID` (default) \| `CREDIT` \| `PARTIAL`. |
| **`initialAmountPaidFunctional`** | string | No | Solo con `PARTIAL`: abono inicial en funcional. |
| **`dueDate`** | string | No | `YYYY-MM-DD` vencimiento si crédito. |
| `id` | UUID string | No | Idempotencia / offline. |
| `opId` | UUID string | No | Sync: enlaza movimientos (+ abono inicial si aplica). |
| `fxSnapshot` | objeto | No | Snapshot FX. |

**Validación:** lista blanca (`forbidNonWhitelisted`). Usar **`supplierInvoiceReference`**, no `reference` en REST.

### Ejemplo — crédito

```json
{
  "supplierId": "11111111-1111-4111-8111-111111111111",
  "documentCurrencyCode": "VES",
  "supplierInvoiceReference": "FAC-2026-0042",
  "paymentStatus": "CREDIT",
  "dueDate": "2026-08-20",
  "lines": [
    {
      "productId": "22222222-2222-4222-8222-222222222222",
      "quantity": "10",
      "unitCost": "5.00"
    }
  ]
}
```

### Ejemplo — contado (pagada)

```json
{
  "supplierId": "11111111-1111-4111-8111-111111111111",
  "paymentStatus": "PAID",
  "supplierInvoiceReference": "FAC-0043",
  "lines": [
    { "productId": "22222222-2222-4222-8222-222222222222", "quantity": "2", "unitCost": "3.50" }
  ]
}
```

---

## `GET /api/v1/purchases`

Lista compras de la tienda. **Por defecto excluye `status=VOID`**.

Query:

| Param | Descripción |
|-------|-------------|
| `supplierId` | Filtrar por proveedor |
| `paymentStatus` | `PAID` \| `CREDIT` \| `PARTIAL` \| **`OPEN`** (CREDIT+PARTIAL con saldo > 0; solo `RECEIVED`) |
| `status` | `RECEIVED` \| `VOID` |
| `includeVoided` | `true` → incluye anuladas (si no pasas `status`) |
| `limit` | 1–100 (default 50) |

Respuesta: `{ items, meta: { limit, count } }`.

---

## `GET /api/v1/purchases/payables`

Deuda abierta agrupada por proveedor (**solo `status=RECEIVED`**).

```json
{
  "totalDueFunctional": "350.00",
  "items": [
    {
      "supplierId": "...",
      "supplierName": "Rongra",
      "active": true,
      "openInvoices": 3,
      "amountDueFunctional": "200.00",
      "amountPaidFunctional": "50.00",
      "totalFunctional": "250.00"
    }
  ]
}
```

---

## `GET /api/v1/purchases/:id`

Compra con líneas, proveedor y **payments** (incluye anuladas).

---

## `POST /api/v1/purchases/:id/payments`

Registra un abono. Reduce `amountDueFunctional`; si llega a 0 → `paymentStatus = PAID`.  
**Bloqueado** si `status=VOID`.

### Body

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| `amountFunctional` | Sí | string > 0, ≤ saldo |
| `method` | No | default `CASH` |
| `note` | No | |
| `opId` | No | Idempotencia |
| `paidAt` | No | ISO datetime |

---

## Anulación — `POST /api/v1/purchases/:id/void-preview`

Evalúa sin mutar. Body vacío `{}`.

| Campo | Significado |
|-------|-------------|
| `canVoid` | `false` si ya `VOID` (`blockers: ["ALREADY_VOID"]`) |
| `voidMode` | `FULL_STOCK` \| `PARTIAL_STOCK` \| `FINANCIAL_ONLY` |
| `lines[]` | `quantityPurchased`, `quantityReversible`, `quantitySkipped`, `skipReason`, `stockOnHand` |
| `payments.willReversePayments` | Abonos activos → `reversedAt` (R1) |
| `debt.amountDueFunctionalAfter` | `"0"` al confirmar |
| `warnings` | Textos para UI / PIN |

Heurística: `quantityReversible = min(qty_línea, max(0, quantity - reserved))`.

---

## Anulación — `POST /api/v1/purchases/:id/void`

### Body

| Campo | Obligatorio | Descripción |
|-------|-------------|-------------|
| `opId` | Sí | UUID idempotencia (`Purchase.voidOpId`) |
| `reason` | Sí | 1–240 chars |
| `confirmPartialStock` | Condicional | **`true` obligatorio** si preview tiene `quantitySkipped > 0` |

Efectos: `OUT_PURCHASE_VOID` por línea reversible; `status=VOID`; deuda 0; abonos con `reversedAt`; no reescribe ventas/COGS. Respuesta incluye `voidResult`. Mismo `opId` → no duplica.

**v1 online-only** (sin sync `PURCHASE_VOID`). PIN = front.

---

## `POST /api/v1/sync/push` — `opType: PURCHASE_RECEIVE`

Misma lógica que `POST /purchases`. En `payload.purchase` se aceptan además:

- `paymentStatus`, `initialAmountPaidFunctional`, `dueDate`
- `reference` como alias de `supplierInvoiceReference` (solo sync)

Ver Postman `PURCHASE_RECEIVE`.

---

## SQL útil — deuda

```sql
SELECT
  s.name AS proveedor,
  SUM(pu."amountDueFunctional") AS deuda
FROM "Purchase" pu
JOIN "Supplier" s ON s.id = pu."supplierId"
WHERE pu."storeId" = '0b54c944-28ba-4542-991a-4840c4801906'
  AND pu."status" = 'RECEIVED'
  AND pu."paymentStatus" IN ('CREDIT', 'PARTIAL')
  AND pu."amountDueFunctional" > 0
GROUP BY s.name
ORDER BY deuda DESC;
```
