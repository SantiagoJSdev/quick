# Contexto de integracion — Backend Quick Market (Mobile / POS / Front)

Documento vivo para alinear UI, app movil y asistentes de codigo con el backend.  
Incluye **§13–§14**: ejemplos **JSON por pantalla/flujo** y **tabla FX** (pares, snapshots, límites).  
Actualizado con **multi-moneda (Venezuela)** y el stack actual (Postgres, outbox, Mongo opcional, sync offline).

## 1) Stack y fuentes de verdad

| Capa | Rol |
|------|-----|
| **PostgreSQL** | Fuente maestra: productos, documentos, inventario, tasas, configuracion. |
| **MongoDB** (`products_read`) | Solo lectura rapida para catalogo; se alimenta por **outbox** (eventual). |
| **Sync offline** | `opId` idempotente; payload debe incluir datos de **FX** al confirmar ventas offline. |

## 2) API base

- Prefijo: `/api/v1`
- **Header obligatorio** en casi todos los endpoints: `X-Store-Id: <uuid>` de una tienda que exista y tenga **`BusinessSettings`**. No lo exigen: `GET /` (raiz) y **`GET /api/v1/ops/metrics`** (M5). Ese endpoint puede exigir **`X-Ops-Api-Key`** o **`Authorization: Bearer`** si el servidor tiene `OPS_API_KEY`; opcional allowlist por IP (`README`). **Onboarding POS** (crear tienda desde la app): con `STORE_ONBOARDING_ENABLED=1` en el servidor, `PUT /api/v1/stores/:storeId` y `PUT /api/v1/stores/:storeId/business-settings` **sí** exigen `X-Store-Id` igual al `:storeId` pero **no** exigen que la tienda ya tenga settings (detalle: `docs/BACKEND_STORE_ONBOARDING.md`).
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

- `GET /api/v1/sales` — historial de la tienda (cabecera `X-Store-Id`). Query opcional: `dateFrom`, `dateTo` (`YYYY-MM-DD` en **zona `Store.timezone`**, o UTC si la tienda no tiene timezone), `deviceId`, `limit` (default 50, max 200), `cursor` (siguiente página; opaco), `format`=`object`|`array`. Por defecto respuesta **`{ items, nextCursor, meta }`** con `meta.timezone`, fechas efectivas y texto de interpretación; con `format=array` solo el array (sin paginar por cursor). Máximo **31 días** calendario inclusive entre from/to (o defaults documentados). Orden: más reciente primero. Detalle líneas: `GET /sales/:id`. Contrato detallado: **`docs/BACKEND_SALES_HISTORY_API.md`**.
- `POST /api/v1/sales` — confirma venta: `lines[]` (`productId`, `quantity`, `price` string, opcional `discount`), opcional `id` (UUID cliente; si ya existe venta con ese id en la tienda, respuesta idempotente sin duplicar stock), `documentCurrencyCode`, `userId`, `deviceId`, opcional `appVersion`, `fxSnapshot` (`baseCurrencyCode`, `quoteCurrencyCode`, `rateQuotePerBase`, `effectiveDate` `YYYY-MM-DD`, opcional `fxSource` e.g. `POS_OFFLINE`). Si envías **`deviceId`**, el servidor **crea o actualiza** el registro `POSDevice` de esa tienda (`lastSeen`, `appVersion` si viene) y **enlaza la venta**; si ese `deviceId` ya está en **otra** tienda → **409 Conflict**. Sin `deviceId`, la venta se guarda igual pero sin terminal en cabecera. Descuenta stock (`OUT_SALE`) y guarda importes documento + funcional en cabecera y líneas.
- `GET /api/v1/sales/:id` — detalle con líneas (misma tienda que `X-Store-Id`).

**Compras / recepción (M5/M6 complemento):**

- `POST /api/v1/purchases` — recepción de mercancía: `supplierId` (UUID), `lines[]` (`productId`, `quantity`, `unitCost` en moneda documento), opcional `id` (idempotencia), `documentCurrencyCode`, `fxSnapshot` (misma forma que ventas). Crea `Purchase` estado `RECEIVED`, `dateReceived` = ahora, movimientos `IN_PURCHASE` y actualiza costo medio funcional del inventario.
- `GET /api/v1/purchases/:id` — detalle con líneas y proveedor.
- Proveedores: el seed crea un `Supplier` por defecto si la tabla está vacía; **no hay** `GET /suppliers` ni CRUD en API. Para `POST /purchases` hace falta un `supplierId` (UUID) obtenido de seed, Prisma Studio o admin. La app Flutter puede guardar proveedores **solo en local** hasta que exista endpoint.

**Devoluciones de venta (M6):**

- `POST /api/v1/sale-returns` — `originalSaleId`, `lines[]` con `saleLineId` (`SaleLine.id` de la venta original) y `quantity` (string); opcional `id` (idempotencia). Opcional `fxPolicy`: `INHERIT_ORIGINAL_SALE` (defecto) o `SPOT_ON_RETURN` (tasa del día en funcional comercial; opcional `fxSnapshot` como en ventas). Importes en documento proporcionales a la venta; inventario `IN_RETURN` siempre al COGS de los `OUT_SALE` de esa venta y producto.
- `GET /api/v1/sale-returns/:id`
- Contrato sync: `SALE_RETURN` y `payload.saleReturn` (opcional `fxPolicy`, `fxSnapshot` / `fx`). Detalle: `docs/api/RETURNS_POLICY.md`.

**Configuracion de tienda (moneda funcional, moneda documento por defecto):**

- `GET /api/v1/stores/:storeId/business-settings` — devuelve `functionalCurrency`, `defaultSaleDocCurrency`, datos de `store`.  
  - Si no existe fila `BusinessSettings` para esa tienda: `404` (ejecutar seed, usar onboarding PUT abajo, o admin).

**Onboarding desde el POS** (servidor con `STORE_ONBOARDING_ENABLED=1`; si no, **403**):

- `PUT /api/v1/stores/:storeId` — body `{ "name", "type": "main"|"branch" }`; `upsert` de `Store` con `id = :storeId` (UUID generado en el móvil). Cabecera `X-Store-Id` = `:storeId`.
- `PUT /api/v1/stores/:storeId/business-settings` — body `{ "functionalCurrencyCode", "defaultSaleDocCurrencyCode" }` (códigos existentes en `Currency`, ej. seed). Misma cabecera. Respuesta **mismo shape** que el `GET` de business-settings.

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
4. **Offline:** el cliente envía en el payload la misma tasa con la que cobró; el servidor valida coherencia (tolerancia ±0,5% respecto a la tasa servidor salvo `fxSource: POS_OFFLINE`).

### Convencion de tasa (para UI)

> **1 `fxBaseCurrency` = `fxRateQuotePerBase` unidades de `fxQuoteCurrency`**

Ejemplo: 1 USD = 36,50 VES → base `USD`, quote `VES`, rate `36.50`.

**Referencia en pantalla (total USD + total Bs):** el front puede usar `GET .../exchange-rates/latest` para mostrar Bs **antes de confirmar**. Al **confirmar** venta (`POST /sales` o `sync/push` `SALE`), enviar `fxSnapshot` para que el servidor persista par, tasa y fecha en el documento.

### Payload venta (REST y sync)

Además de líneas (`productId`, `quantity`, `price`, `discount` opcional), enviar:

- `documentCurrencyCode` opcional (default desde `BusinessSettings`)
- `deviceId` opcional (REST) / recomendado: al confirmar venta **online**, con `deviceId` el backend registra el POS igual que en sync (**no** hace falta “registrar dispositivo al abrir la app” solo para poder cobrar; sigue siendo válido mandar `appVersion` en el primer sync o venta).
- `appVersion` opcional (string corto, ej. `1.2.0`): se persiste en `POSDevice` cuando envías `deviceId`.
- `fxSnapshot`: `baseCurrencyCode`, `quoteCurrencyCode`, `rateQuotePerBase`, `effectiveDate` (`YYYY-MM-DD`), `fxSource` opcional (`POS_OFFLINE` usa la tasa del cliente; el par debe coincidir con una fila `ExchangeRate` de la tienda, ver `StoreFxSnapshotService`)

En **sync** `SALE`, si el payload no trae `sale.deviceId`, el servidor usa el `deviceId` del batch (mismo criterio que antes).

El backend resuelve moneda funcional desde `BusinessSettings` y completa totales e importes por línea en documento y funcional.

## 4) Mongo `products_read` (lectura catalogo)

- Coleccion: `products_read`
- Documento incluye snapshot de producto para listados; se actualiza por worker desde outbox.
- La API de listado/detalle de productos usa esta coleccion primero (modo `auto`); el front puede leer `X-Catalog-Source` para saber si la respuesta vino de Mongo o de Postgres.
- Para mobile: eventualmente exponer `listPrice`, moneda, y **no** usar tasa actual para interpretar ventas ya cerradas.

Especificacion: `docs/api/MONGO_PRODUCTS_READ.md`.

## 5) Sincronizacion offline

Contrato: `docs/api/SYNC_CONTRACTS.md`.

- `POST /api/v1/sync/push` — batch hasta 200 ops, `deviceId` (obligatorio), opcional `appVersion` (se guarda en `POSDevice` junto con `lastSeen` al inicio del push), `opId` UUID v4, `opType` `NOOP` | `SALE` | `SALE_RETURN` | `PURCHASE_RECEIVE` | `INVENTORY_ADJUST`. Respuesta: `acked` (con `serverVersion` **por tienda**, distinto del pull), `skipped`, `failed`. Requiere `X-Store-Id`. Ver `docs/api/SYNC_CONTRACTS.md`.
- `GET /api/v1/sync/pull?since=&limit=` — cambios del servidor desde el último `serverVersion` del **log global** (`ServerChangeLog`): `PRODUCT_CREATED` | `PRODUCT_UPDATED` | `PRODUCT_DEACTIVATED` con `payload: { productId, fields }`. `limit` default 500, max 500. Guardar `toVersion` como siguiente `since`. Solo entran productos **creados/actualizados tras desplegar este log** (histórico previo no se backfildea).
- Cada operacion lleva `opId` (UUID v4).
- **Ventas offline** deben incluir bloque **FX** igual que venta online confirmada.
- **Ejemplos JSON por pantalla + tabla FX:** ver **§13 y §14** al final de este documento.

## 6) Errores comunes a evitar en front

- Mezclar `number` JS para dinero; preferir **string decimal** en API o biblioteca decimal.
- Aplicar la tasa del servidor a un ticket ya generado offline con otra tasa (rompe auditoria).
- Asumir que el catalogo desde Mongo es **lectura eventual** respecto a Postgres; con `source=postgres` fuerzas consistencia fuerte a costa de latencia/carga en DB.

## 7) Checklist integracion por pantalla

- [x] Referencia JSON por flujo documentada (§13) y escenarios FX (§14).
- [ ] Selector moneda documento coherente con `BusinessSettings`.
- [ ] Pantalla tasa: mostrar fecha efectiva y fuente (BCV / manual).
- [ ] Ticket: totales en moneda documento; opcional linea “referencia funcional”.
- [ ] Offline: persistir FX en SQLite junto al ticket antes de sync.
- [x] Reintentos sync: mismo `opId` → `skipped`; misma `sale.id` ya persistida → sin duplicar movimientos de stock.
- [ ] **Sprint app — Config:** enlazar `storeId`, `GET business-settings`, `GET exchange-rates/latest`.
- [ ] **Sprint app — Inventario:** `GET inventory`, ajustes `POST inventory/adjustments`, CRUD productos según permisos.
- [ ] **Sprint app — POS:** carrito con precio documento + referencia VES/funcional, cantidad, `POST /sales` + `fxSnapshot` + `deviceId` estable.

## 8) Multi-dispositivo (varias instalaciones de la app)

- Varios teléfonos/tablets pueden operar la **misma tienda** usando el mismo `X-Store-Id`.
- Cada instalación debe generar y conservar un **`deviceId`** (UUID o string estable único por instalación); enviarlo en **`POST /api/v1/sales`** (recomendado) y en **`POST /api/v1/sync/push`** (obligatorio). Con cada venta o push, el servidor hace **upsert** de `POSDevice` para esa tienda: `lastSeen`, y **`appVersion`** si envías el campo (body de venta o cuerpo del push).
- Un mismo **`deviceId` no puede** estar registrado en dos tiendas distintas: segundo registro → **409 Conflict** (“registered to another store”).
- **¿Al abrir la app o al vender?** Con el cambio actual, **basta con enviar `deviceId` en la primera venta online** o en el **primer `sync/push`**; no es obligatorio un endpoint aparte de “hello device”. Opcionalmente podéis llamar a `sync/push` con un `NOOP` al arrancar para refrescar `lastSeen` sin documentos.
- La idempotencia de operaciones va por **`opId`** (sync) y por **`id`** de documento (venta/compra) cuando aplique; reintentos no duplican stock.

## 9) Seguridad resumida (cliente móvil)

| Tema | Detalle |
|------|---------|
| Cabeceras | `X-Store-Id` casi siempre; opcional `X-Request-Id` (UUID o string ≤128 chars). |
| Transporte | Producción: **HTTPS**; no exponer `storeId` en URLs públicas si se puede evitar (ya va en header). |
| Errores | JSON `{ statusCode, error, message[], requestId }`; log local del `requestId` para soporte. |
| Ops | `GET /api/v1/ops/metrics` no es para POS; puede exigir `OPS_API_KEY`. |
| Usuarios | **Sin** login JWT en API actual; la confianza es por red + `storeId` (y políticas futuras). |

## 10) App Flutter / Android Studio + Gemini

Guía paso a paso (proyecto nuevo, carpetas, sprints UI, paleta naranja de marca, pantallas, límites del backend):  
**`docs/flutter/IMPLEMENTACION_FLUTTER_ANDROID_GEMINI.md`**

Qué documentos del backend copiar al repo Flutter y dónde pegarlos:  
**`docs/flutter/DOCUMENTOS_A_COPIAR_AL_PROYECTO_FLUTTER.md`**

## 11) Roadmap sugerido (front)

| Sprint | Enfoque |
|--------|---------|
| **1** | Configuración tienda + tasas + inventario + productos (CRUD) + proveedores **solo UI local** + `deviceId` persistente. |
| **2** | POS: búsqueda, QR/cámara, líneas con doble moneda en UI, totales, `POST /sales` (+ sync `SALE` opcional offline). |
| **3+** | Compras, devoluciones, pull/push completo, mejoras proveedores cuando exista API. |

## 12) Referencias codigo / docs backend

| Tema | Ubicacion |
|------|-----------|
| Guía Flutter + Android + Gemini | `docs/flutter/IMPLEMENTACION_FLUTTER_ANDROID_GEMINI.md` |
| Índice docs a copiar al repo Flutter | `docs/flutter/DOCUMENTOS_A_COPIAR_AL_PROYECTO_FLUTTER.md` |
| Multi-moneda dominio | `docs/domain/MULTI_CURRENCY_ARCHITECTURE.md` |
| Outbox | `docs/api/OUTBOX_EVENTS.md` |
| Sync | `docs/api/SYNC_CONTRACTS.md` |
| Soft delete producto | `docs/api/PRODUCT_SOFT_DELETE_POLICY.md` |
| Idempotencia tests | `docs/qa/IDEMPOTENCY_OPID_TEST_CASES.md` |
| Tracker | `docs/IMPLEMENTATION_TRACKER.md` |
| Productos API | `src/modules/products/` |
| Inventario API | `src/modules/inventory/` |
| Ventas API | `src/modules/sales/` |
| Historial ventas (listado) | `docs/BACKEND_SALES_HISTORY_API.md`, `GET /api/v1/sales` |
| Registro POS (`POSDevice`) | `src/modules/pos-device/pos-device.service.ts` (ventas + sync) |
| Compras API | `src/modules/purchases/` |
| Devoluciones venta | `src/modules/sale-returns/` + `docs/api/RETURNS_POLICY.md` |
| FX snapshot tienda | `src/modules/exchange-rates/store-fx-snapshot.service.ts` |
| Observabilidad M5 | `src/modules/ops/` (`GET /ops/metrics`, `OpsAuthGuard`, scheduler) |
| Onboarding tienda desde POS | `docs/BACKEND_STORE_ONBOARDING.md`, `PUT /stores/:id`, `PUT /stores/:id/business-settings` |
| Errores + requestId M0 | `src/common/filters/api-exception.filter.ts`, `src/common/middleware/request-id.middleware.ts` |
| Worker Mongo | `src/outbox/outbox-mongo.worker.ts` |
| Ejemplos JSON por pantalla + FX ampliado | §**13** y §**14** (final de este archivo) |

## 13) Ejemplos JSON por pantalla / flujo (referencia front)

Los cuerpos siguen la API real; los UUID y números son **ilustrativos**. Cabeceras típicas: `X-Store-Id: <uuid-tienda>`, `Content-Type: application/json`, opcional `X-Request-Id`.

### 13.0 Onboarding — crear tienda y settings (PUT, flag servidor)

Solo con `STORE_ONBOARDING_ENABLED=1`. Cabecera: `X-Store-Id` = mismo UUID que `:storeId` en la URL.

**PUT** `/api/v1/stores/550e8400-e29b-41d4-a716-446655440099`

```json
{
  "name": "Mi sucursal",
  "type": "main"
}
```

**Respuesta 200** (objeto `Store`): incluye `id`, `name`, `type`, `createdAt`, `updatedAt`, etc.

**PUT** `/api/v1/stores/550e8400-e29b-41d4-a716-446655440099/business-settings`

```json
{
  "functionalCurrencyCode": "USD",
  "defaultSaleDocCurrencyCode": "VES"
}
```

**Respuesta 200:** igual que **§13.2** (`GET` business-settings). Después de esto, el resto de la API con `X-Store-Id` de esa tienda pasa el `StoreConfiguredGuard`.

### 13.1 Error HTTP (formato M0)

`POST` con validación fallida o recurso no encontrado:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["quantity must be a positive decimal"],
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### 13.2 Pantalla “Enlazar tienda” → validar `GET /stores/:storeId/business-settings`

Respuesta **200** (objeto Prisma serializado; `Decimal` suele ir como string en JSON):

```json
{
  "id": "bs-settings-uuid",
  "storeId": "550e8400-e29b-41d4-a716-446655440001",
  "functionalCurrencyId": "curr-usd-uuid",
  "defaultSaleDocCurrencyId": "curr-ves-uuid",
  "createdAt": "2026-04-01T12:00:00.000Z",
  "updatedAt": "2026-04-01T12:00:00.000Z",
  "functionalCurrency": {
    "id": "curr-usd-uuid",
    "code": "USD",
    "name": "Dólar estadounidense",
    "decimals": 2,
    "active": true,
    "createdAt": "2026-03-01T00:00:00.000Z",
    "updatedAt": "2026-03-01T00:00:00.000Z"
  },
  "defaultSaleDocCurrency": {
    "id": "curr-ves-uuid",
    "code": "VES",
    "name": "Bolívar soberano",
    "decimals": 2,
    "active": true,
    "createdAt": "2026-03-01T00:00:00.000Z",
    "updatedAt": "2026-03-01T00:00:00.000Z"
  },
  "store": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Tienda principal (seed)",
    "type": "main"
  }
}
```

### 13.3 Pantalla “Tasa del día” → `GET /exchange-rates/latest?baseCurrencyCode=USD&quoteCurrencyCode=VES`

**200:**

```json
{
  "id": "rate-uuid",
  "storeId": "550e8400-e29b-41d4-a716-446655440001",
  "baseCurrencyCode": "USD",
  "quoteCurrencyCode": "VES",
  "rateQuotePerBase": "36.5",
  "effectiveDate": "2026-04-04",
  "source": "SEED",
  "notes": "Ejemplo por tienda (sin tasa global)",
  "createdAt": "2026-04-04T08:00:00.000Z",
  "convention": "1 USD = rateQuotePerBase VES"
}
```

Misma ruta con **`baseCurrencyCode=EUR&quoteCurrencyCode=USD`** si existe fila en la tienda (ej. seed `SEED_EUR_USD`):

```json
{
  "baseCurrencyCode": "EUR",
  "quoteCurrencyCode": "USD",
  "rateQuotePerBase": "1.08",
  "effectiveDate": "2026-04-04",
  "convention": "1 EUR = rateQuotePerBase USD"
}
```

### 13.4 Pantalla “Registrar tasa” (admin) → `POST /exchange-rates`

**Request:**

```json
{
  "baseCurrencyCode": "USD",
  "quoteCurrencyCode": "VES",
  "rateQuotePerBase": "36.75",
  "effectiveDate": "2026-04-05",
  "source": "MANUAL",
  "notes": "Cierre BCV"
}
```

**Response:** objeto `ExchangeRate` creado (incl. `id`, `baseCurrency`, `quoteCurrency` anidados según include de Prisma en el servicio).

### 13.5 Lista catálogo → `GET /products?includeInactive=false&source=auto`

El controlador devuelve el array de productos (forma según `products.service`); ejemplo de **un elemento** típico:

```json
{
  "id": "prod-uuid-1",
  "sku": "SKU-001",
  "barcode": "7501234567890",
  "name": "Arroz 1kg",
  "description": null,
  "type": "GOODS",
  "price": "2.50",
  "cost": "1.80",
  "currency": "USD",
  "active": true,
  "unit": "unidad"
}
```

Cabecera respuesta: `X-Catalog-Source: mongo` o `postgres`.

### 13.6 Alta producto → `POST /products`

**Request (mínimo razonable):**

```json
{
  "sku": "SKU-NEW-01",
  "name": "Aceite 1L",
  "price": "4.99",
  "cost": "3.50",
  "currency": "USD"
}
```

**Response:** producto creado (incl. `id`, timestamps). Errores comunes: `sku` duplicado → 409/400 según implementación.

### 13.7 Ajuste inventario → `POST /inventory/adjustments`

**Request:**

```json
{
  "productId": "prod-uuid-1",
  "type": "IN_ADJUST",
  "quantity": "12",
  "reason": "Inventario físico",
  "unitCostFunctional": "1.85"
}
```

**Response:**

```json
{
  "status": "applied",
  "movementId": "mov-uuid"
}
```

Idempotencia con el mismo `opId` (opcional en body):

```json
{
  "productId": "prod-uuid-1",
  "type": "OUT_ADJUST",
  "quantity": "1",
  "opId": "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee"
}
```

Segunda vez: `{ "status": "skipped" }`.

### 13.8 Lista inventario → `GET /inventory`

Ejemplo de **una línea** (estructura según servicio; incluye producto embebido o join):

```json
{
  "id": "inv-line-uuid",
  "productId": "prod-uuid-1",
  "storeId": "550e8400-e29b-41d4-a716-446655440001",
  "quantity": "48",
  "reserved": "0",
  "averageUnitCostFunctional": "1.82",
  "totalCostFunctional": "87.36",
  "product": {
    "id": "prod-uuid-1",
    "sku": "SKU-001",
    "name": "Arroz 1kg"
  }
}
```

### 13.9 POS / Sprint 2 → `POST /sales`

**Request** (documento en VES, snapshot alineado a fila USD/VES de la tienda):

```json
{
  "documentCurrencyCode": "VES",
  "deviceId": "pos-device-uuid-estable-por-app",
  "appVersion": "1.2.0",
  "lines": [
    {
      "productId": "prod-uuid-1",
      "quantity": "2",
      "price": "91.25",
      "discount": "0"
    }
  ],
  "fxSnapshot": {
    "baseCurrencyCode": "USD",
    "quoteCurrencyCode": "VES",
    "rateQuotePerBase": "36.5",
    "effectiveDate": "2026-04-04",
    "fxSource": "POS_OFFLINE"
  }
}
```

Online sin offline: omitir `fxSource` o no usar `POS_OFFLINE`; el servidor contrasta la tasa (±0,5%).

`appVersion` es opcional; `deviceId` registra el terminal en esta tienda en la misma transacción que la venta.

**Response:** venta con `saleLines`, totales `totalDocument`, `totalFunctional`, campos `fx*` en cabecera (Decimal como string).

### 13.9b Historial ventas → `GET /sales?dateFrom=&dateTo=&deviceId=&limit=&cursor=`

`dateFrom` / `dateTo` = calendario en zona **`meta.timezone`** (tienda). Respuesta por defecto:

```json
{
  "items": [
    {
      "id": "sale-uuid",
      "createdAt": "2026-04-05T14:30:00.000Z",
      "documentCurrencyCode": "VES",
      "totalDocument": "182.50",
      "totalFunctional": "5.0",
      "deviceId": "pos-device-uuid",
      "status": "CONFIRMED"
    }
  ],
  "nextCursor": null,
  "meta": {
    "timezone": "America/Caracas",
    "dateFrom": "2026-04-01",
    "dateTo": "2026-04-07",
    "rangeInterpretation": "Calendar dates …",
    "limit": 50,
    "hasMore": false
  }
}
```

### 13.10 Compra / recepción → `POST /purchases`

```json
{
  "supplierId": "supplier-uuid-del-seed",
  "documentCurrencyCode": "VES",
  "lines": [
    {
      "productId": "prod-uuid-1",
      "quantity": "24",
      "unitCost": "85.00"
    }
  ],
  "fxSnapshot": {
    "baseCurrencyCode": "USD",
    "quoteCurrencyCode": "VES",
    "rateQuotePerBase": "36.5",
    "effectiveDate": "2026-04-04"
  }
}
```

### 13.11 Devolución → `POST /sale-returns`

**Heredar FX de la venta (defecto):**

```json
{
  "originalSaleId": "sale-uuid",
  "lines": [{ "saleLineId": "sale-line-uuid", "quantity": "1" }]
}
```

**Tasa del día en funcional comercial:**

```json
{
  "originalSaleId": "sale-uuid",
  "fxPolicy": "SPOT_ON_RETURN",
  "fxSnapshot": {
    "baseCurrencyCode": "USD",
    "quoteCurrencyCode": "VES",
    "rateQuotePerBase": "37.0",
    "effectiveDate": "2026-04-05"
  },
  "lines": [{ "saleLineId": "sale-line-uuid", "quantity": "1" }]
}
```

### 13.12 Sync → `POST /sync/push`

```json
{
  "deviceId": "pos-device-uuid-estable-por-app",
  "appVersion": "1.2.0",
  "ops": [
    {
      "opId": "11111111-2222-4333-8444-555555555555",
      "opType": "NOOP",
      "timestamp": "2026-04-04T15:00:00.000Z",
      "payload": { "ping": true }
    }
  ]
}
```

**Response:**

```json
{
  "serverTime": "2026-04-04T15:00:01.000Z",
  "acked": [{ "opId": "11111111-2222-4333-8444-555555555555", "serverVersion": 42 }],
  "skipped": [],
  "failed": []
}
```

`SALE` / `SALE_RETURN` / etc.: ver `docs/api/SYNC_CONTRACTS.md` (misma forma de `fxSnapshot` que REST donde aplique).

### 13.13 Sync → `GET /sync/pull?since=0&limit=50`

**200 (forma lógica):**

```json
{
  "serverTime": "2026-04-04T15:01:00.000Z",
  "fromVersion": 0,
  "toVersion": 3,
  "hasMore": false,
  "ops": [
    {
      "serverVersion": 1,
      "opType": "PRODUCT_UPDATED",
      "timestamp": "2026-04-04T10:00:00.000Z",
      "payload": {
        "productId": "prod-uuid-1",
        "fields": { "price": "2.60", "name": "Arroz 1kg" }
      }
    }
  ]
}
```

---

## 14) Más FX: pares, snapshots y límites

| Escenario | Qué hacer en el front |
|-----------|------------------------|
| **Solo USD/VES** | `GET .../latest?baseCurrencyCode=USD&quoteCurrencyCode=VES`; `fxSnapshot` con ese par al confirmar documentos. |
| **EUR/USD** (u otro par en BD) | Misma ruta cambiando query; el `fxSnapshot` debe usar **exactamente** `baseCurrencyCode` / `quoteCurrencyCode` de la fila `ExchangeRate` de la tienda (no invertir a mano si el servidor guardó otro orden). |
| **Documento = funcional** | No hace falta par cruzado; el servidor usa tasa identidad. El `fxSnapshot` en cliente puede omitirse o enviarse coherente con doc de dominio. |
| **Offline POS** | `fxSource: "POS_OFFLINE"` + tasa y fecha usadas en el ticket; par debe existir en tienda. |
| **Sin par directo** (ej. documento EUR, funcional VES, solo USD/VES y EUR/USD en BD) | No soportado: falta **fila** que una `documentCode` y `functionalCode` (ver `findLatestForDocumentFunctionalPair`). Mostrar error de negocio o cargar tasas antes de confirmar. |

**Conversión solo para UI (preview):** con convención `1 base = rate quote`, importe en documento `D` y funcional `F` según códigos; implementación de referencia en backend: `convertAmountDocumentToFunctional` (`src/common/fx/convert-amount.ts`).

---
