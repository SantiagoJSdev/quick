# Quick Market — Contexto del proyecto (backend)

Documento único para desarrollar y extender el backend. Índice general: [docs/README.md](./README.md).

---

## 1. Arquitectura

| Capa | Tecnología | Rol |
|------|------------|-----|
| Transaccional | **PostgreSQL** + Prisma | Fuente de verdad: catálogo, inventario, ventas, compras, devoluciones, sync |
| Lectura eventual | **MongoDB** (opcional) | `products_read`, `fx_rates_read` vía outbox |
| API | **NestJS** `/api/v1` | REST; casi todo exige `X-Store-Id` + `BusinessSettings` |
| Offline POS | `sync/push`, `sync/pull` | Ops idempotentes por `opId`; pull de catálogo vía `ServerChangeLog` |

**Excepciones sin `X-Store-Id`:** `GET /`, `GET /ops/metrics`, onboarding de tienda (si `STORE_ONBOARDING_ENABLED=1`), `GET /dashboard/device/:deviceId` (usa `X-Device-Token`).

---

## 2. Reglas transversales

- **Errores:** `{ statusCode, error, message[], requestId }`.
- **Montos:** strings decimales en JSON (no `number`).
- **Trazabilidad:** header opcional `X-Request-Id`.
- **Multi-moneda:** moneda funcional por tienda; documentos confirmados guardan snapshot FX (`fx*`, `totalDocument`, `totalFunctional`).
- **Sin efectos ocultos:** compra no cambia `Product.price`; tickets en espera (held) no crean venta ni movimientos.

### Semántica monetaria (importante para reportes)

| Campo | Significado |
|-------|-------------|
| `total` / `totalDocument` | Monto en moneda **documento** de la operación |
| `totalFunctional` | Monto en moneda **funcional** de la tienda (snapshot al confirmar) |
| Reportes dashboard | Usar `COALESCE(totalFunctional, total)`; KPIs en `currencyCode` funcional |

---

## 3. Módulos Nest y responsabilidad

| Módulo | Responsabilidad |
|--------|-----------------|
| `products` | CRUD catálogo, SKU, pricing M7, imágenes, `products-with-stock` |
| `inventory` | Stock por tienda, movimientos, ajustes idempotentes |
| `sales` | Ventas confirmadas, pagos mixtos, historial |
| `purchases` | Compras a proveedor, recepción stock |
| `sale-returns` | Devoluciones ligadas a venta original |
| `suppliers` | CRUD proveedores por tienda |
| `exchange-rates` | Tasas y snapshot FX por tienda |
| `business-settings` | Moneda funcional, margen default, onboarding tienda |
| `sync` | `push` / `pull` offline |
| `reports` | Dashboard operativo (summary, timeseries, payments, kiosk) |
| `pos-device` | Registro terminales + config dashboard |
| `ops` | Métricas reconciliación / sync / outbox |
| `outbox` | Worker eventos → Mongo read models |

---

## 4. Flujos funcionales (implementados)

### Catálogo
- CRUD productos; SKU autogenerado; `pricingMode`: `USE_STORE_DEFAULT` | `USE_PRODUCT_OVERRIDE` | `MANUAL_PRICE`.
- `POST /products-with-stock` + header **`Idempotency-Key`** (transacción producto + stock).
- Derivados en respuesta: `effectiveMarginPercent`, `suggestedPrice`, etc.
- Detalle M7 `applySuggestedListPrice`: ver [FRONTEND.md](./FRONTEND.md) §3.

### Inventario
- Consulta stock y kardex; `POST /inventory/adjustments` con `opId` (`IN_ADJUST` / `OUT_ADJUST`).
- Costo medio en funcional: `averageUnitCostFunctional`, `totalCostFunctional`.

### Ventas / devoluciones
- `POST /sales` → `status: CONFIRMED`; pagos opcionales `payments[]`.
- `POST /sale-returns`; solo sobre ventas confirmadas.
- Historial: `GET /sales` (rango calendario en `Store.timezone`, máx. 31 días).

### Compras
- `POST /purchases`, sync `PURCHASE_RECEIVE`; campo `supplierInvoiceReference`.
- Actualiza inventario/costo; **no** muta precio de lista automáticamente.
- Contrato: [api/PURCHASES.md](./api/PURCHASES.md).

### Proveedores
- CRUD por tienda; sync `SUPPLIER_*`. Contrato: [api/SYNC_PUSH_SUPPLIERS.md](./api/SYNC_PUSH_SUPPLIERS.md).

### Sync offline
- **Push:** `NOOP`, `SALE`, `SALE_RETURN`, `PURCHASE_RECEIVE`, `INVENTORY_ADJUST`, `SUPPLIER_*`.
- **Pull:** deltas catálogo/proveedor (`PRODUCT_*`, `SUPPLIER_*`) desde `ServerChangeLog`.
- Ventas sync: [api/SYNC_PUSH_SALE.md](./api/SYNC_PUSH_SALE.md).
- `GET /ops/metrics`: [api/OPS_METRICS.md](./api/OPS_METRICS.md).

### Dashboard operativo (v1)
- Reportes: `GET /reports/sales/summary|timeseries|payments|by-device`.
- Kiosk: `GET /dashboard/device/:deviceId` + `X-Device-Token`.
- Config dispositivo: `GET|PATCH /pos-devices/:deviceId/dashboard-config` (PATCH con `DASHBOARD_ADMIN_PIN`).
- Contrato Flutter: [FRONTEND.md](./FRONTEND.md) §10.

### Tickets en espera (held)
- Solo cliente (SQLite); no hay endpoint backend. Al cobrar → `POST /sales` o sync `SALE`.

---

## 5. Modelo de datos (PostgreSQL)

Fuente exacta: `prisma/schema.prisma`. Resumen por dominio:

### Organización y configuración
- **`Store`** — tienda/sucursal; `timezone` (IANA) para fechas de reportes/historial.
- **`BusinessSettings`** — 1:1 con Store; moneda funcional, moneda documento venta, `defaultMarginPercent`.
- **`Currency`**, **`ExchangeRate`** — catálogo monedas e historial FX.

### Catálogo
- **`Product`** — SKU, barcode, price/cost, `pricingMode`, `catalogStoreId`.
- **`Category`**, **`Tax`**, **`Supplier`** (por tienda), **`ProductSkuCounter`**.

### Inventario
- **`InventoryItem`** — stock por (`productId`, `storeId`); `quantity`, costos funcionales.
- **`StockMovement`** — kardex; tipos `IN_*` / `OUT_*`; `opId` opcional.

### Operaciones comerciales
- **`Sale`** + **`SaleLine`** + **`SalePayment`** — venta confirmada, líneas, cobro mixto.
- **`SaleReturn`** + **`SaleReturnLine`** — devolución; `originalSaleId`.
- **`Purchase`** + **`PurchaseLine`** — compras; snapshot FX.

### Dispositivos y sync
- **`POSDevice`** — `deviceId` (instalación), `storeId`, modo dashboard (`deviceMode`, `dashboardEnabled`, token hash).
- **`SyncOperation`**, **`StoreSyncState`**, **`ServerChangeLog`**, **`IdempotencyRecord`**, **`OutboxEvent`**.

### Relaciones clave

```
Store 1──1 BusinessSettings
Store 1──N Sale, Purchase, SaleReturn, InventoryItem, Supplier, POSDevice
Sale  1──N SaleLine, SalePayment
Sale  1──N SaleReturn (originalSaleId)
Product 1──N InventoryItem, SaleLine, StockMovement
```

### Consultas útiles (pgAdmin)

Ventas del día con devoluciones (reemplazar IDs):

```sql
SELECT s.id, s.total, s."totalFunctional", s."createdAt"
FROM "Sale" s
WHERE s."storeId" = '<store-uuid>' AND s.status = 'CONFIRMED'
ORDER BY s."createdAt" DESC LIMIT 20;

SELECT sr.id, sr."originalSaleId", sr.total, sr."createdAt"
FROM "SaleReturn" sr
WHERE sr."storeId" = '<store-uuid>' AND sr.status = 'CONFIRMED'
ORDER BY sr."createdAt" DESC LIMIT 20;
```

---

## 6. Endpoints clave (referencia rápida)

| Área | Endpoints |
|------|-----------|
| Settings | `GET/PATCH /stores/:id/business-settings` |
| FX | `GET /exchange-rates/latest`, `POST /exchange-rates` |
| Productos | `GET/POST/PATCH/DELETE /products`, `POST /products-with-stock` |
| Inventario | `GET /inventory`, `POST /inventory/adjustments` |
| Ventas | `POST/GET /sales`, `GET /sales/:id` |
| Compras | `POST/GET /purchases/:id` |
| Devoluciones | `POST/GET /sale-returns/:id` |
| Proveedores | CRUD `/suppliers` |
| Sync | `POST /sync/push`, `GET /sync/pull` |
| Dashboard | `/reports/sales/*`, `/dashboard/device/:id`, `/pos-devices/:id/dashboard-config` |
| Ops | `GET /ops/metrics` |

Detalle de payloads: [api/README.md](./api/README.md) y Swagger.

---

## 7. Entorno y bases de datos

- **PostgreSQL:** nombre en `DATABASE_URL` (`...:5432/<db>?schema=public`).
- **Mongo:** `MONGODB_URI`, `MONGODB_DATABASE_NAME` (default `quickmarket`).
- **Variables relevantes:** `DASHBOARD_ADMIN_PIN`, `OPS_API_KEY`, `STORE_ONBOARDING_ENABLED`, `IDEMPOTENCY_TTL_HOURS`.

Reset desarrollo:

```bash
npm run db:reset          # solo Postgres
npm run db:reset:dev      # Postgres + limpiar Mongo read models
npm run db:seed           # monedas, tienda demo, settings, tasas
```

---

## 8. Política post-compra

- Compra → inventario + costo medio funcional.
- No cambia `Product.price` / `Product.cost` automáticamente.
- Aplicar nuevo precio: `PATCH /products/:id` explícito.

---

## 9. Mantenimiento de documentación

Al cerrar una feature:

1. Actualizar **este archivo** (módulos, flujos, modelo si hay migración).
2. Si cambia contrato HTTP → `docs/api/<modulo>.md`.
3. Si impacta Flutter → [FRONTEND.md](./FRONTEND.md).
4. No crear documentos paralelos; usar [docs/README.md](./README.md).

---

## 10. Backlog conocido

- Tests integrales ampliados M7.
- Tickets en espera multi-dispositivo (backend opcional).
- Reservas inventario (`reserved`) y margen real en reportes.
- `SalePayment.amountFunctional` persistido (optimización dashboard).
