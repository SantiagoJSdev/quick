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
- **Header obligatorio** en casi todos los endpoints: `X-Store-Id: <uuid>` de una tienda que exista y tenga **`BusinessSettings`**. La ruta `GET /` (raiz) no lo exige.
- Para `GET /api/v1/stores/:storeId/business-settings`, `X-Store-Id` debe ser **igual** a `:storeId`.
- Validacion: DTOs con `class-validator`; cuerpos JSON.
- Productos hoy:
  - `POST /api/v1/products` — crear (genera `OutboxEvent` `PRODUCT_CREATED`).
  - `GET /api/v1/products` — lista; `includeInactive=true|false`; lectura **Mongo** `products_read` por defecto con **fallback Postgres** (query `source=auto|mongo|postgres`, default `auto`). Respuesta incluye cabecera `X-Catalog-Source: mongo|postgres`.
  - `GET /api/v1/products/:id` — mismo criterio de origen; en `auto`, si no hay doc en Mongo se intenta Postgres (retraso del worker).
  - `PATCH /api/v1/products/:id` — actualiza (`PRODUCT_UPDATED`).
  - `DELETE /api/v1/products/:id` — soft delete (`PRODUCT_DEACTIVATED`).

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

**Referencia en pantalla (total USD + total Bs):** el front puede usar `GET .../exchange-rates/latest` para mostrar Bs **antes de confirmar**. Al **confirmar** venta, el snapshot debe persistirse en el documento (endpoint de ventas pendiente).

### DTO conceptual venta (cuando exista endpoint)

El front debe estar preparado para enviar (ademas de lineas):

- `documentCurrencyCode`, `functionalCurrencyCode`
- `fxBaseCurrencyCode`, `fxQuoteCurrencyCode`, `fxRateQuotePerBase` (string decimal)
- `exchangeRateDate` (fecha de la tasa usada)
- `fxSource` opcional (`POS_OFFLINE`, etc.)

Lineas: cantidad + precio unitario en **moneda documento**; el backend completa dimension funcional.

## 4) Mongo `products_read` (lectura catalogo)

- Coleccion: `products_read`
- Documento incluye snapshot de producto para listados; se actualiza por worker desde outbox.
- La API de listado/detalle de productos usa esta coleccion primero (modo `auto`); el front puede leer `X-Catalog-Source` para saber si la respuesta vino de Mongo o de Postgres.
- Para mobile: eventualmente exponer `listPrice`, moneda, y **no** usar tasa actual para interpretar ventas ya cerradas.

Especificacion: `docs/api/MONGO_PRODUCTS_READ.md`.

## 5) Sincronizacion offline

Contrato: `docs/api/SYNC_CONTRACTS.md`.

- `POST /api/v1/sync/push` — primer corte: batch hasta 200 ops, `deviceId`, `opId` UUID v4, `opType` `NOOP` | `SALE` | `INVENTORY_ADJUST`. Respuesta: `acked` (con `serverVersion`), `skipped` (`already_applied`), `failed` (`not_implemented` para venta/ajuste hasta M2/M4). Requiere `X-Store-Id`. Ver `docs/api/SYNC_CONTRACTS.md`.
- `GET /api/v1/sync/pull` — pendiente.
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
- [ ] Reintentos sync: mismo `opId`, no duplicar venta.

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
| Worker Mongo | `src/outbox/outbox-mongo.worker.ts` |
