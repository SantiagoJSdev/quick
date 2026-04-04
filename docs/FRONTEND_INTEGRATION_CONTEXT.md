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
- Validacion: DTOs con `class-validator`; cuerpos JSON.
- Productos hoy:
  - `POST /api/v1/products` — crear (genera `OutboxEvent` `PRODUCT_CREATED`).
  - `GET /api/v1/products` — lista; query `includeInactive=true|false`
  - `GET /api/v1/products/:id`
  - `PATCH /api/v1/products/:id` — actualiza (`PRODUCT_UPDATED`).
  - `DELETE /api/v1/products/:id` — soft delete (`PRODUCT_DEACTIVATED`).

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
- Para mobile: eventualmente exponer `listPrice`, moneda, y **no** usar tasa actual para interpretar ventas ya cerradas.

Especificacion: `docs/api/MONGO_PRODUCTS_READ.md`.

## 5) Sincronizacion offline

Contrato: `docs/api/SYNC_CONTRACTS.md`.

- `POST /api/v1/sync/push` / `GET /api/v1/sync/pull` (implementacion pendiente en parte).
- Cada operacion lleva `opId` (UUID v4).
- **Ventas offline** deben incluir bloque **FX** igual que venta online confirmada.

## 6) Errores comunes a evitar en front

- Mezclar `number` JS para dinero; preferir **string decimal** en API o biblioteca decimal.
- Aplicar la tasa del servidor a un ticket ya generado offline con otra tasa (rompe auditoria).
- Asumir que `GET /products` desde Mongo es contablemente exacto al segundo (es lectura eventual).

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
