# Quick Market Backend — Master Context

Este es el **documento único** de referencia para trabajar el backend + frontend POS.
Describe lo implementado, flujos reales, módulos, contratos mínimos y cómo extender sin romper.

## 1) Arquitectura actual (fuente de verdad)

- **PostgreSQL**: escritura maestra (productos, inventario, ventas, compras, devoluciones, settings, sync metadata).
- **MongoDB**: lectura eventual (`products_read`, `fx_rates_read`) via outbox.
- **Offline POS**: `sync/push` y `sync/pull` con `opId` idempotente para operaciones definitivas.
- **Scope por tienda**: casi toda la API exige `X-Store-Id` y tienda con `BusinessSettings`.

## 2) Reglas transversales

- **Errores**: `{ statusCode, error, message[], requestId }`.
- **Request tracing**: `X-Request-Id` opcional (si falta, backend genera).
- **Monetarios**: usar strings decimales en payloads/respuestas.
- **No side effects ocultos**:
  - compra no cambia `Product.price` automáticamente,
  - tickets en espera no crean venta ni movimientos.

## 3) Estado funcional implementado

### 3.1 Catálogo / productos

- CRUD `products`.
- SKU autogenerado si falta; barcode opcional único si informado.
- `pricingMode` por producto:
  - `USE_STORE_DEFAULT`
  - `USE_PRODUCT_OVERRIDE`
  - `MANUAL_PRICE`
- `marginPercentOverride` (0–999).
- Derivados en respuestas de producto:
  - `effectiveMarginPercent`
  - `marginComputedPercent`
  - `suggestedPrice`

### 3.2 Margen global por tienda

- `BusinessSettings.defaultMarginPercent` (0–999).
- `PATCH /stores/:storeId/business-settings` para actualizar.

### 3.3 Inventario

- `GET /inventory`
- `GET /inventory/:productId`
- `GET /inventory/movements`
- `POST /inventory/adjustments` (`IN_ADJUST` / `OUT_ADJUST`) con idempotencia por `opId`.
- Costeo en moneda funcional (`averageUnitCostFunctional`, `totalCostFunctional`).

### 3.4 Alta rápida producto + stock inicial

- `POST /products-with-stock` en una sola transacción:
  - crea producto (outbox + changelog),
  - aplica `IN_ADJUST`,
  - responde `{ product, inventory }`.
- **No duplicados** con `Idempotency-Key`:
  - misma key + mismo body => misma respuesta (sin segundo producto),
  - misma key + body distinto => `409`.

### 3.5 Ventas / compras / devoluciones

- `POST /sales` + historial (`GET /sales`, `GET /sales/:id`).
- `POST /sales` soporta `payments` opcional para cobro mixto (USD/VES u otros métodos).
- `GET /sales/:id` devuelve `payments` de la venta.
- `sync/push` `SALE` acepta `payload.sale.payments`.
- `POST /purchases`, `GET /purchases/:id`.
- `POST /sale-returns`, `GET /sale-returns/:id`.
- Multi-moneda con snapshot FX persistido por documento confirmado.

### 3.6 Sync offline

- `POST /sync/push`: `NOOP`, `SALE`, `SALE_RETURN`, `PURCHASE_RECEIVE`, `INVENTORY_ADJUST`.
- `GET /sync/pull`: cambios de catálogo (`PRODUCT_*`) desde `ServerChangeLog`.
- `opId` idempotente para evitar duplicados de efectos reales.

### 3.7 Proveedores

- CRUD por tienda `suppliers`.
- Compras validan proveedor activo y de la misma tienda.

### 3.8 POS tickets en espera (held/parked)

- **Fase actual**: solo cliente (SQLite front), sin endpoint backend dedicado.
- `ON_HOLD` no es `Sale`, no es `sync op`, no descuenta inventario.
- Al cobrar:
  - online => `POST /sales`
  - offline => op `SALE` en `sync/push`.

## 4) Módulos backend que importan

- `products`
- `inventory`
- `sales`
- `purchases`
- `sale-returns`
- `suppliers`
- `exchange-rates`
- `business-settings`
- `sync`
- `ops`
- `outbox` worker

## 5) Endpoints clave para frontend POS

- `GET /stores/:storeId/business-settings`
- `PATCH /stores/:storeId/business-settings`
- `GET /exchange-rates/latest`
- `POST /products`
- `PATCH /products/:id`
- `PATCH /products/:id/image` / `DELETE /products/:id/image`
- `GET /products` / `GET /products/:id`
- `POST /uploads/products-image` / `GET /uploads/products-image/:storeId/:fileName`
- `POST /products-with-stock` (**con `Idempotency-Key`**)
- `GET /inventory` / `POST /inventory/adjustments`
- `POST /sales` / `GET /sales`
- `POST /purchases`
- `POST /sale-returns`
- `POST /sync/push` / `GET /sync/pull`

## 6) Entorno y bases de datos

- PostgreSQL: nombre de DB viene en `DATABASE_URL` (`...:5432/<db>?schema=public`).
- Mongo: nombre de DB viene en `MONGODB_DATABASE_NAME` (default `quickmarket`).

Reset dev:

- `npm run db:reset` => reset Postgres.
- `npm run db:reset:dev` => reset Postgres + limpiar colecciones read model en Mongo (si hay URI).
- `npm run db:reset:dev:mongo-drop` => reset Postgres + `dropDatabase()` de Mongo DB configurada.

## 7) Política post-compra (precio/ganancia)

- Compra actualiza inventario/costo medio funcional.
- No muta automáticamente `Product.price` ni `Product.cost`.
- Sugerencias de margen en catálogo usan `Product.cost` actual de ficha.
- Si se quiere aplicar nuevo precio/costo: `PATCH /products/:id` explícito.

## 8) Convención de trabajo futuro (para no perder contexto)

Cuando se agregue funcionalidad nueva:

1. Actualizar este archivo en:
   - bloque de estado implementado,
   - endpoints clave (si cambia contrato),
   - reglas transversales (si cambia negocio).
2. Registrar brevemente:
   - qué cambió,
   - por qué,
   - impacto front/back.
3. Si hay migración:
   - anotar nuevos campos/tablas en secciones 3 y 6.
4. Si hay nuevo flujo POS:
   - describir estado/transition y momento exacto del side effect (inventario, sync, contable).

## 9) Backlog vivo mínimo

- Tests integrales ampliados para M7 (`M7-P8`).
- Opcional fase 2 tickets en espera: módulo backend `parked-sales` multi-dispositivo.
- Mejoras reservas inventario (`reserved`) y reportería de utilidad real.

## 10) Documento operativo frontend

- Set vigente (usar solo estos):
  - `docs/FRONT_OFFLINE_EXECUTION_PLAN_V2.md` (plan offline, checklist y QA)
  - `docs/quickmarket_pos_pago_mixto_usd_ves.md` (contrato/flujo cobro mixto)
  - `docs/FRONT_PRODUCT_PHOTO_UPLOAD_CONTRACT.md` (upload + attach/detach foto)

