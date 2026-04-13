# Compras — REST y sync offline

Todas las rutas bajo **`/api/v1/purchases`** exigen header **`X-Store-Id: <uuid de tienda>`** con `Store` + `BusinessSettings` configurados.

## `POST /api/v1/purchases`

Registra una compra recibida, actualiza inventario y movimientos en transacción.

### Body (JSON)

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `supplierId` | UUID string | Sí | Proveedor de la tienda (activo). |
| `lines` | array | Sí | 1–100 líneas. |
| `lines[].productId` | UUID string | Sí | |
| `lines[].quantity` | string numérica | Sí | Ej. `"10"` |
| `lines[].unitCost` | string numérica | Sí | Costo unitario en moneda del documento. |
| `documentCurrencyCode` | string | No | Ej. `VES`. Si se omite, usa reglas de `BusinessSettings`. |
| **`supplierInvoiceReference`** | string | No | Factura, guía u otra referencia del proveedor. **Máximo 120 caracteres.** |
| `id` | UUID string | No | Id de compra fijado por el cliente (idempotencia / offline). Si ya existe en la tienda, se devuelve la misma compra. |
| `opId` | UUID string | No | Uso típico en sync: enlaza movimientos de stock. |
| `fxSnapshot` | objeto | No | Snapshot FX (misma forma que en otras operaciones multi-moneda). |

**Validación:** el servidor usa lista blanca (`forbidNonWhitelisted`). Cualquier propiedad no listada provoca **400**. En particular, **`reference` no es un nombre válido en este body**; usar solo **`supplierInvoiceReference`**.

### Ejemplo

```json
{
  "supplierId": "11111111-1111-4111-8111-111111111111",
  "documentCurrencyCode": "VES",
  "supplierInvoiceReference": "FAC-2026-0042",
  "lines": [
    {
      "productId": "22222222-2222-4222-8222-222222222222",
      "quantity": "10",
      "unitCost": "5.00"
    }
  ]
}
```

## `GET /api/v1/purchases/:id`

Devuelve la compra con líneas y proveedor. Incluye **`supplierInvoiceReference`** (`string` o `null`) si existe en base.

---

## `POST /api/v1/sync/push` — `opType: PURCHASE_RECEIVE`

Misma lógica de negocio que `POST /purchases`, dentro del batch de sync. Requiere `payload.purchase`:

| Campo | Obligatorio | Notas |
|-------|-------------|--------|
| `storeId` | Sí | Debe coincidir con `X-Store-Id`. |
| `supplierId` | Sí | |
| `lines` | Sí | Misma forma que REST (`productId`, `quantity`, `unitCost` como strings). |
| `documentCurrencyCode` | No | |
| **`supplierInvoiceReference`** | No | Preferido. |
| **`reference`** | No | **Solo en sync:** alias de `supplierInvoiceReference`. Si vienen ambos, gana **`supplierInvoiceReference`**. |
| `id` | No | UUID de compra en el cliente. |
| `fxSnapshot` | No | |
| `fx` | No | Alias de `fxSnapshot`. |

El **`opId`** del objeto `ops[]` se fusiona en la creación para `StockMovement` (no hace falta repetirlo dentro de `purchase`).

Ver ejemplos en **`postman/QuickMarket_API.postman_collection.json`** (request `PURCHASE_RECEIVE`).
