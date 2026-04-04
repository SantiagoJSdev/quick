# Contexto de integracion — Backend Quick Market (Mobile / POS / Front)

Documento vivo para alinear UI, app movil y asistentes de codigo con el backend.  
Actualizado con **multi-moneda (Venezuela)** y el stack actual (Postgres, outbox, Mongo opcional, sync offline).

## 1) Stack y fuentes de verdad

| Capa | Rol |
|------|-----|
| **PostgreSQL** | Fuente maestra: productos, documentos, inventario, tasas, configuracion. |
| **MongoDB** (`products_read`) | Solo lectura rapida para catalogo; se alimenta por **outbox** (eventual). |
| **Sync offline** | `opId` idempotente; payload debe incluir datos de **FX** al confirmar ventas offline. |

## 2) API base

- Prefijo: `/api/v1`
- **Header obligatorio** en casi todos los endpoints: `X-Store-Id: <uuid>` de una tienda que exista y tenga **`BusinessSettings`**. No lo exigen: `GET /` (raiz) y **`GET /api/v1/ops/metrics`** (métricas operativas / M5).
- **Trazabilidad (M0):** opcional `X-Request-Id`; si no se envía, el servidor genera uno. Siempre se devuelve en cabecera. Errores HTTP: JSON `{ statusCode, error, message[], requestId }`.
- Para `GET /api/v1/stores/:storeId/business-settings`, `X-Store-Id` debe ser **igual** a `:storeId`.
- Validacion: DTOs con `class-validator`; cuerpos JSON.
- Productos hoy:
  - `POST /api/v1/products` — crear (genera `OutboxEvent` `PRODUCT_CREATED`).
  - `GET /api/v1/products` — lista; `includeInactive=true|false`; lectura **Mongo** `products_read` por defecto con **fallback Postgres** (query `source=auto|mongo|postgres`, default `auto`). Respuesta incluye cabecera `X-Catalog-Source: mongo|postgres`.
  - `GET /api/v1/products/:id` — mismo criterio de origen; en `auto`, si no hay doc en Mongo se intenta Postgres (retraso del worker).
  - `PATCH /api/v1/products/:id` — actualiza (`PRODUCT_UPDATED`).
  - `DELETE /api/v1/products/:id` — soft delete (`PRODUCT_DEACTIVATED`).

**Inventario por tienda (M2):**

- `GET /api/v1/inventory` — líneas `InventoryItem` de la tienda del header + datos básicos del `product`.
- `GET /api/v1/inventory/:productId` — una línea; `404` si aún no existe (se crea al primer ajuste).
- `GET /api/v1/inventory/movements?productId=&limit=` — últimos `StockMovement` (default 100, max 500).
- `POST /api/v1/inventory/adjustments` — cuerpo: `productId`, `type` `IN_ADJUST`|`OUT_ADJUST`, `quantity` (string > 0), opcional `reason`, `unitCostFunctional` (entrada; si falta usa costo medio actual o `Product.cost`), `opId` (idempotencia). Respuesta `{ status: applied|skipped, movementId? }`.

**Ventas (M4):**

- `POST /api/v1/sales` — confirma venta: `lines[]` (`productId`, `quantity`, `price` string, opcional `discount`), opcional `id` (UUID cliente; si ya existe venta con ese id en la tienda, respuesta idempotente sin duplicar stock), `documentCurrencyCode`, `userId`, `deviceId`, `fxSnapshot` (`baseCurrencyCode`, `quoteCurrencyCode`, `rateQuotePerBase`, `effectiveDate` `YYYY-MM-DD`, opcional `fxSource` e.g. `POS_OFFLINE`). Descuenta stock (`OUT_SALE`) y guarda importes documento + funcional en cabecera y líneas.
- `GET /api/v1/sales/:id` — detalle con líneas (misma tienda que `X-Store-Id`).

**Compras / recepción (M5/M6 complemento):**

- `POST /api/v1/purchases` — recepción de mercancía: `supplierId` (UUID), `lines[]` (`productId`, `quantity`, `unitCost` en moneda documento), opcional `id` (idempotencia), `documentCurrencyCode`, `fxSnapshot` (misma forma que ventas). Crea `Purchase` estado `RECEIVED`, `dateReceived` = ahora, movimientos `IN_PURCHASE` y actualiza costo medio funcional del inventario.
- `GET /api/v1/purchases/:id` — detalle con líneas y proveedor.
- Proveedores: el seed crea un `Supplier` por defecto si la tabla está vacía; no hay CRUD de proveedores en API aún (usar seed / admin / Prisma).

**Devoluciones de venta (M6):**

- `POST /api/v1/sale-returns` — `originalSaleId`, `lines[]` con `saleLineId` (`SaleLine.id` de la venta original) y `quantity` (string); opcional `id` (idempotencia). La FX de cabecera se **hereda** de la venta original (`fxPolicy` `INHERIT_ORIGINAL_SALE`). Importes de línea proporcionales a la venta; inventario con `IN_RETURN` al COGS de los `OUT_SALE` de esa venta y producto.
- `GET /api/v1/sale-returns/:id`
- Contrato sync: `SALE_RETURN` y `payload.saleReturn` (sin snapshot FX). Detalle: `docs/api/RETURNS_POLICY.md`.

**Configuracion de tienda (moneda funcional, moneda documento por defecto):**

- `GET /api/v1/stores/:storeId/business-settings` — devuelve `functionalCurrency`, `defaultSaleDocCurrency`, datos de `store`.  
  - Si no existe fila `BusinessSettings` para esa tienda: `404` (ejecutar seed o crear settings en admin).

**Tasa de referencia para UI (preview en Bs / USD):**

- `GET /api/v1/exchange-rates/latest?baseCurrencyCode=USD&quoteCurrencyCode=VES` + header `X-Store-Id`.  
  - Query opcional: `effectiveOn` (ISO date) — ultima tasa con `effectiveDate <= effectiveOn` (por defecto hoy UTC).  
  - Solo tasas **de esa tienda** (no hay fallback global en API).  
  - Respuesta incluye `rateQuotePerBase` como string y `convention` legible.

**Alta manual de tasa (Postman / admin, append-only):**

- `POST /api/v1/exchange-rates` + header `X-Store-Id` (la tasa se asocia a esa tienda). Body JSON:
  - `baseCurrencyCode`, `quoteCurrencyCode`, `rateQuotePerBase` (string), `effectiveDate` (ISO)
  - opcional: `source`, `notes`
- **PostgreSQL** + **outbox**; el worker proyecta a Mongo coleccion **`fx_rates_read`** (ver `docs/api/FX_RATES_READ.md`). Offline: ademas puede cachear `GET .../latest` en SQLite local.

**Semantica de producto (multi-moneda):**

- `price` + `currency`: precio de lista / venta sugerido en esa moneda.
- `cost`: tratar como **costo medio unitario en moneda funcional** (ver doc de dominio). Hasta que el front envie siempre funcional, coordinar con backend en validaciones.

## 3) Multi-moneda — lo que el front debe asumir

Diseno completo: **`docs/domain/MULTI_CURRENCY_ARCHITECTURE.md`**.

Resumen obligatorio para POS / mobile:

1. Cada **sucursal** tiene **moneda funcional** (ej. USD) en `BusinessSettings` (backend).
2. Venta/compra puede ir en **moneda documento** (USD o VES).
3. Al **confirmar** un documento (online u offline sincronizado):
   - se guarda **tasa usada** (`exchangeRateDate` + par `fxBase` / `fxQuote` + `fxRateQuotePerBase`);
   - cada linea lleva importes en **documento** y **funcional**;
   - **no** se recalcula historico cuando cambia la tasa del dia.
4. **Offline:** el cliente envia en el payload la misma tasa con la que cobro; el servidor valida coherencia (politica de tolerancia por definir en servicio).

### Convencion de tasa (para UI)

> **1 `fxBaseCurrency` = `fxRateQuotePerBase` unidades de `fxQuoteCurrency`**

Ejemplo: 1 USD = 36,50 VES → base `USD`, quote `VES`, rate `36.50`.

**Referencia en pantalla (total USD + total Bs):** el front puede usar `GET .../exchange-rates/latest` para mostrar Bs **antes de confirmar**. Al **confirmar** venta (`POST /sales` o `sync/push` `SALE`), enviar `fxSnapshot` para que el servidor persista par, tasa y fecha en el documento.

### Payload venta (REST y sync)

Además de líneas (`productId`, `quantity`, `price`, `discount` opcional), enviar:

- `documentCurrencyCode` opcional (default desde `BusinessSettings`)
- `fxSnapshot`: `baseCurrencyCode`, `quoteCurrencyCode`, `rateQuotePerBase`, `effectiveDate` (`YYYY-MM-DD`), `fxSource` opcional (`POS_OFFLINE` usa la tasa del cliente en MVP USD/VES)

El backend resuelve moneda funcional desde `BusinessSettings` y completa totales e importes por línea en documento y funcional.

## 4) Mongo `products_read` (lectura catalogo)

- Coleccion: `products_read`
- Documento incluye snapshot de producto para listados; se actualiza por worker desde outbox.
- La API de listado/detalle de productos usa esta coleccion primero (modo `auto`); el front puede leer `X-Catalog-Source` para saber si la respuesta vino de Mongo o de Postgres.
- Para mobile: eventualmente exponer `listPrice`, moneda, y **no** usar tasa actual para interpretar ventas ya cerradas.

Especificacion: `docs/api/MONGO_PRODUCTS_READ.md`.

## 5) Sincronizacion offline

Contrato: `docs/api/SYNC_CONTRACTS.md`.

- `POST /api/v1/sync/push` — batch hasta 200 ops, `deviceId`, `opId` UUID v4, `opType` `NOOP` | `SALE` | `SALE_RETURN` | `PURCHASE_RECEIVE` | `INVENTORY_ADJUST`. Respuesta: `acked` (con `serverVersion` **por tienda**, distinto del pull), `skipped`, `failed`. Requiere `X-Store-Id`. Ver `docs/api/SYNC_CONTRACTS.md`.
- `GET /api/v1/sync/pull?since=&limit=` — cambios del servidor desde el último `serverVersion` del **log global** (`ServerChangeLog`): `PRODUCT_CREATED` | `PRODUCT_UPDATED` | `PRODUCT_DEACTIVATED` con `payload: { productId, fields }`. `limit` default 500, max 500. Guardar `toVersion` como siguiente `since`. Solo entran productos **creados/actualizados tras desplegar este log** (histórico previo no se backfildea).
- Cada operacion lleva `opId` (UUID v4).
- **Ventas offline** deben incluir bloque **FX** igual que venta online confirmada.

## 6) Errores comunes a evitar en front

- Mezclar `number` JS para dinero; preferir **string decimal** en API o biblioteca decimal.
- Aplicar la tasa del servidor a un ticket ya generado offline con otra tasa (rompe auditoria).
- Asumir que el catalogo desde Mongo es **lectura eventual** respecto a Postgres; con `source=postgres` fuerzas consistencia fuerte a costa de latencia/carga en DB.

## 7) Checklist integracion por pantalla

- [ ] Selector moneda documento coherente con `BusinessSettings`.
- [ ] Pantalla tasa: mostrar fecha efectiva y fuente (BCV / manual).
- [ ] Ticket: totales en moneda documento; opcional linea “referencia funcional”.
- [ ] Offline: persistir FX en SQLite junto al ticket antes de sync.
- [x] Reintentos sync: mismo `opId` → `skipped`; misma `sale.id` ya persistida → sin duplicar movimientos de stock.

## 8) Referencias codigo / docs backend

| Tema | Ubicacion |
|------|-----------|
| Multi-moneda dominio | `docs/domain/MULTI_CURRENCY_ARCHITECTURE.md` |
| Outbox | `docs/api/OUTBOX_EVENTS.md` |
| Sync | `docs/api/SYNC_CONTRACTS.md` |
| Soft delete producto | `docs/api/PRODUCT_SOFT_DELETE_POLICY.md` |
| Idempotencia tests | `docs/qa/IDEMPOTENCY_OPID_TEST_CASES.md` |
| Tracker | `docs/IMPLEMENTATION_TRACKER.md` |
| Productos API | `src/modules/products/` |
| Inventario API | `src/modules/inventory/` |
| Ventas API | `src/modules/sales/` |
| Compras API | `src/modules/purchases/` |
| Devoluciones venta | `src/modules/sale-returns/` + `docs/api/RETURNS_POLICY.md` |
| FX snapshot tienda | `src/modules/exchange-rates/store-fx-snapshot.service.ts` |
| Observabilidad M5 | `src/modules/ops/` (`GET /ops/metrics`, scheduler) |
| Errores + requestId M0 | `src/common/filters/api-exception.filter.ts`, `src/common/middleware/request-id.middleware.ts` |
| Worker Mongo | `src/outbox/outbox-mongo.worker.ts` |
