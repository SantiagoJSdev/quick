# Backend Quick Market - Implementation Tracker

Este archivo es la fuente de seguimiento del proyecto desde dia 1.
Se actualiza al cerrar cada tarea y al cambiar alcance.

## 1) Conceptos clave (explicados simple)

### Sincronizacion offline POS (push/pull con oplog)

- Cada POS (app movil) trabaja offline con SQLite local.
- Cuando el usuario vende, ajusta inventario o crea datos, el POS guarda operaciones en su `oplog` local (`local_ops`) con:
  - `opId` (UUID unico),
  - `opType`,
  - `payload`,
  - `timestamp`,
  - `status` (`pending | sent | ack`).
- Al reconectar:
  1. Hace `POST /sync/push` con lote de ops `pending`.
  2. El backend aplica cada op de forma idempotente (si `opId` ya existe, no la vuelve a aplicar).
  3. El backend responde `acked` y `skipped`.
  4. El POS hace `GET /sync/pull?since=serverVersion` para traer cambios del servidor.

Resultado: el POS puede operar sin internet y sincronizar sin duplicar ventas o movimientos.

### Outbox Pattern (PostgreSQL -> MongoDB)

- PostgreSQL es la fuente maestra para escritura.
- MongoDB es una proyeccion de lectura rapida (por ejemplo, productos para mobile).
- En cada cambio de producto en PostgreSQL (crear, actualizar, desactivar), se escribe en la misma transaccion:
  - cambio principal (`products`),
  - evento en `outbox_events`.
- Un worker procesa `outbox_events` y actualiza `products_read` en Mongo.
- Si Mongo falla, el evento queda pendiente y se reintenta. No se pierde el cambio.

Resultado: sincronizacion robusta sin inconsistencias por fallos intermedios.

### Multi-moneda (Venezuela, ERP simplificado)

- Moneda **funcional** por sucursal (`BusinessSettings.functionalCurrencyId`); documentos en USD y/o VES.
- Cada compra/venta **confirmada** guarda snapshot: `exchangeRateDate`, par base/quote y `fxRateQuotePerBase` (ver dominio).
- Lineas con importes en **moneda documento** y **moneda funcional**; inventario valorizado solo en funcional.
- **No** recalcular documentos historicos al cambiar la tasa; offline envia FX en payload (`opId` / idempotencia intactos).
- Diseno completo: `docs/domain/MULTI_CURRENCY_ARCHITECTURE.md`. Contexto Front: `docs/FRONTEND_INTEGRATION_CONTEXT.md`.

## 2) Alcance MVP Tecnico - Fase 1

### Incluye (in scope)

1. Modulo `products` en PostgreSQL:
   - CRUD base.
   - validaciones minimas (`sku` unico, nombre, precio, estado activo).
   - semantica: `cost` = costo medio en **moneda funcional**; `price` + `currency` = lista en moneda indicada (ver dominio multi-moneda).
2. Outbox para `products`:
   - tabla `outbox_events` en PostgreSQL.
   - evento por `PRODUCT_CREATED | PRODUCT_UPDATED | PRODUCT_DEACTIVATED`.
3. Worker de proyeccion a Mongo:
   - actualiza coleccion `products_read`.
   - marca evento procesado o programa retry.
4. Lectura para app movil:
   - `GET /api/v1/products` y `GET /api/v1/products/:id`: por defecto (`source=auto`) leen `products_read` en Mongo y hacen fallback a PostgreSQL si Mongo no esta disponible o falla la consulta; cabecera de respuesta `X-Catalog-Source: mongo|postgres`.
   - Query opcional `source=mongo|postgres|auto` para forzar origen (`mongo` sin cliente disponible -> `503`).
5. Base de sincronizacion offline:
   - contrato definido para `POST /sync/push` y `GET /sync/pull`.
   - manejo idempotente por `opId`.
6. Fundamentos multi-moneda en Postgres (schema):
   - `Currency`, `ExchangeRate`, `BusinessSettings`.
   - campos opcionales FX y duales en `Sale` / `SaleLine`, `Purchase` / `PurchaseLine`.
   - valorizacion inventario: `InventoryItem.averageUnitCostFunctional`, `totalCostFunctional`; `StockMovement` costos funcionales opcionales.
7. Inventario por tienda (API M2): lectura de líneas y movimientos, ajustes manuales atómicos, `sync/push` con `INVENTORY_ADJUST`.

### No incluye (out of scope en Fase 1)

- Resolucion avanzada de conflictos multi-dispositivo.
- Sincronizacion completa de ventas, compras y transferencias.
- WebSockets en tiempo real.
- Reconciliacion automatica completa de inventario por job nocturno.
- Reporteria avanzada y dashboards.
- **Devolución de compra** a proveedor y flujos contables avanzados (devolución de **venta** con FX heredada ya implementada).
- Contabilidad completa (mayor, asientos dobles).

## 3) Roadmap por modulos

### Estado general de avance (actualizar en cada entrega)

- Estado de fase: `Sprint 1` + `M0 parcial (requestId + errores JSON); M3 sync DONE; M2–M5 + devoluciones venta operativas`
- Avance global estimado Fase 1: `~92%` (pendiente: auth `/ops`, tests integración FX pesados, login, transferencias, dashboards)
- Ultima actualizacion: `2026-04-03`

### Implementado vs. pasos a futuro (deuda conocida)

| Tema | Estado hoy | Futuro / deuda |
|------|------------|----------------|
| **`/sync/pull` vs `/sync/push` `serverVersion`** | Dos contadores (ver `SYNC_CONTRACTS.md`): pull = `ServerChangeLog`; push ack = `StoreSyncState` por tienda | Opcional: unificar un solo stream de versión para el POS |
| **Histórico `ServerChangeLog`** | Solo eventos **después** de desplegar la tabla (sin backfill de productos viejos) | Job de rehidratación o snapshot inicial si hace falta |
| **Ajustes de inventario en `pull`** | No: el POS actualiza stock vía **push** (`INVENTORY_ADJUST`) o **REST** | Opcional: `INVENTORY_*` en pull para auditoría multi-dispositivo |
| **`reserved` / reservas** | Campo existe; API de ajuste solo valida `quantity - reserved` en salidas | Endpoints de reserva para carrito / pedidos |
| **Ventas `SALE` / compras / devoluciones en sync** | `SALE`, `SALE_RETURN`, `PURCHASE_RECEIVE`, `INVENTORY_ADJUST`, `NOOP` | Transferencias; más tests por `opType` en CI |
| **Multi-moneda** | Pares arbitrarios en `ExchangeRate`; `findLatestForDocumentFunctionalPair`; devolución `SPOT_ON_RETURN`; seed EUR/USD; redondeo documentado en `convert-amount` / servicios | Cross-rates indirectos (cadena de pares); más integración compras/devoluciones |

### Estado por modulo

- M0 Fundacion tecnica: `IN_PROGRESS` (errores JSON + `X-Request-Id` listos; sin envoltorio global en respuestas 2xx)
- M1 Products + Outbox + Mongo Projection: `DONE` (MVP API + proyección)
- M2 Inventory base: `DONE` (API ajustes + lectura; sin reservas avanzadas)
- M3 Sync offline POS: `DONE` (push/pull + ops implementadas; tests unitarios `NOOP` / `INVENTORY_ADJUST` / `unknown_op_type` en `sync.service.spec.ts`)
- M4 Sales integradas: `DONE`
- M5 Reconciliacion y observabilidad: `DONE` (MVP: `OpsModule`, métricas REST, scheduler + logs)
- M6 Multi-moneda (dominio + API): `IN_PROGRESS` (API + conversión listas; integración crítica parcial: `sales-fx-historical.integration.spec.ts`, sync `SALE` opId)

### M0 - Fundacion tecnica
- [x] Estándar **errores** JSON bajo `api/v1`: `{ statusCode, error, message[], requestId }` vía `ApiExceptionFilter` (`src/common/filters/api-exception.filter.ts`). Respuestas **2xx** siguen siendo el cuerpo del recurso (sin envoltorio global); cabecera `X-Request-Id` en respuestas HTTP.
- [x] Configurar validacion global (ValidationPipe + transform + whitelist).
- [x] Log de conexion a bases de datos al arrancar: PostgreSQL (Prisma) y MongoDB opcional (`MONGODB_URI`). (ver `prisma.service.ts`, `mongo.service.ts`)
- [x] **requestId**: middleware asigna/genera UUID; cliente puede enviar `X-Request-Id` (máx. 128 chars). **opId** sigue siendo contrato sync/POS (UUID v4 en DTOs).

### M1 - Products + Outbox + Mongo Projection (MVP inicial)
- [x] CRUD de productos en PostgreSQL (base, con soft delete por `active=false`).
- [x] Crear tabla `outbox_events` (modelo `OutboxEvent` + migracion aplicada).
- [x] Publicar eventos de producto dentro de transaccion (`PRODUCT_CREATED|UPDATED|DEACTIVATED`).
- [x] Worker para proyectar a Mongo (`OutboxMongoWorker` -> coleccion `products_read`, retry/backoff).
- [x] Endpoint lectura de productos para mobile (`GET /products`, `GET /products/:id`: Mongo + fallback Postgres; `?source=`, `X-Catalog-Source`).
- [x] Pruebas minimas: outbox al crear producto + forma del payload para worker (`RUN_INTEGRATION=1`); igualdad estable de payload en sync (`stableJsonStringify`). Paridad documento Mongo tras worker: manual o e2e futuro con app + `MONGODB_URI`.

### M2 - Inventory base
- [x] Endpoints inventario por tienda (header `X-Store-Id`): `GET /inventory`, `GET /inventory/:productId`, `GET /inventory/movements`, `POST /inventory/adjustments`.
- [x] Ajustes manuales `IN_ADJUST` / `OUT_ADJUST` con `StockMovement` y `opId` opcional (idempotencia).
- [x] Transacción Prisma atómica por ajuste; no permite stock negativo (`quantity - reserved` en salidas).
- [x] Valorización moneda funcional: costeo medio en entrada; salida proporcional a `averageUnitCostFunctional`.
- [ ] Futuro: PATCH metadatos línea (`minStock`, `maxStock`, `locationInStore`); reservas (`reserved`) explícitas vía API.

### M3 - Sync offline POS (operativo)
- [x] `POST /sync/push` primer corte: batch, `acked` / `skipped` / `failed`, idempotencia por `opId`, `NOOP` para pruebas; `SALE` y `PURCHASE_RECEIVE` operativos.
- [x] `INVENTORY_ADJUST` en push: aplica mismo negocio que `POST /inventory/adjustments` (payload `inventoryAdjust` o raíz).
- [x] `GET /sync/pull?since&limit` — `ServerChangeLog` (version global); productos escriben `PRODUCT_*` en la misma transacción que outbox.
- [x] Persistencia `SyncOperation` + `StoreSyncState` (version por tienda) + registro `POSDevice`.
- [x] Tests: unit sync vacio + integracion NOOP (`RUN_INTEGRATION=1`); casos TC completos en `docs/qa/IDEMPOTENCY_OPID_TEST_CASES.md`.

### M4 - Sales integradas con inventario
- [x] Crear venta + lineas en transaccion.
- [x] Generar `StockMovement` tipo `OUT_SALE`.
- [x] Evitar stock negativo segun politica definida.
- [x] Persistir snapshot FX + totales documento/funcional + lineas duales (sync offline respeta payload).

### M6 - Multi-moneda (Venezuela)
- [x] Modelo datos: `Currency`, `ExchangeRate`, `BusinessSettings` + campos en documentos/inventario/movimientos (migracion `multi_currency_foundation`).
- [x] Documentacion dominio (flujos, invariantes, DTOs, ejemplos, errores comunes): `docs/domain/MULTI_CURRENCY_ARCHITECTURE.md`.
- [x] Contexto Front actualizado: `docs/FRONTEND_INTEGRATION_CONTEXT.md`.
- [x] Seed inicial `USD` / `VES` + `BusinessSettings` por tienda existente + tasas ejemplo (`npm run db:seed`). Ver `prisma/seed.ts`.
- [x] Función conversión documento→funcional `convertAmountDocumentToFunctional` + tests unitarios USD/VES (`src/common/fx/convert-amount.spec.ts`).
- [x] API tasas: `GET /exchange-rates/latest` + `POST /exchange-rates` (solo por tienda; header `X-Store-Id`; outbox -> Mongo `fx_rates_read`).
- [x] Confirmacion compra/venta MVP: `POST /sales`, `POST /purchases`, `sync/push` `SALE` / `PURCHASE_RECEIVE`; `StoreFxSnapshotService` compartido; idempotencia `opId` por línea + `id` documento.
- [x] Devoluciones venta MVP: `SaleReturn` + `IN_RETURN`; políticas `INHERIT_ORIGINAL_SALE` y `SPOT_ON_RETURN` (tasa del día en funcional comercial); doc `docs/api/RETURNS_POLICY.md`; REST + `sync/push` `SALE_RETURN`.
- [x] Pruebas integración críticas (con `RUN_INTEGRATION=1`): FX **no se reescribe** en ventas ya guardadas al insertar tasa más nueva (`sales-fx-historical.integration.spec.ts`); offline **sync `SALE`** mismo `opId` → `skipped` (`sync.service.integration.spec.ts`). Sigue pendiente ampliar (compras, devoluciones, outbox→Mongo E2E).

### M5 - Reconciliacion y observabilidad
- [x] Job de conciliacion inventario vs movimientos (suma algebraica `StockMovement` IN_* / OUT_* vs `InventoryItem.quantity`; `GET /api/v1/ops/metrics`, query opcional `storeId`).
- [x] Alertas por desfases y cola outbox acumulada (scheduler configurable: backlog pending, eventos FAILED, `pendingLagSeconds`; umbrales por env).
- [x] Metricas de lag de sincronizacion (`outbox.pendingLagSeconds`; conteos `SyncOperation` por `status` + `StoreSyncState.serverVersion` por tienda).
- [x] **Seguridad `/ops/*`:** `OpsAuthGuard` — `OPS_API_KEY` (`X-Ops-Api-Key` o `Authorization: Bearer`), opcional `OPS_IP_ALLOWLIST`; sin clave ni allowlist el endpoint queda abierto con warning en log (solo conveniente en dev). `TRUST_PROXY=1` para allowlist detrás de proxy.

## 4) Riesgos principales y mitigacion

### R1 - Duplicacion de operaciones por reconexion
- Riesgo: una venta se aplica dos veces.
- Mitigacion:
  - `opId` UUID unico por operacion cliente.
  - indice unico en `SyncOperation.opId` y `StockMovement.opId`.
  - respuesta `skipped` cuando ya existe.

### R2 - Colision o mala generacion de UUID
- Riesgo: dos operaciones con mismo ID o IDs predecibles.
- Mitigacion:
  - estandarizar `UUID v4` en cliente y servidor.
  - validar formato de UUID en DTO.
  - rechazar `opId` invalido con error 400.
  - agregar tests de contrato para IDs.

### R3 - Inconsistencia PostgreSQL vs Mongo
- Riesgo: producto actualizado en PostgreSQL no llega a Mongo.
- Mitigacion:
  - Outbox pattern obligatorio para cambios de producto.
  - worker con retry exponencial + dead-letter.
  - `GET /api/v1/ops/metrics` expone `outbox.pendingLagSeconds` y backlog; job M5 alerta en logs.

### R4 - Conflictos por cambios concurrentes
- Riesgo: dos POS actualizan datos relacionados al mismo tiempo.
- Mitigacion:
  - controlar versiones (`updatedAt`/`version`) donde aplique.
  - reglas de negocio por tipo de entidad.
  - cola de revisiones manuales para conflictos no resolubles.

### R5 - Degradacion en modo offline prolongado
- Riesgo: backlog grande y sync lenta.
- Mitigacion:
  - envio por lotes paginados.
  - limites por batch y reintentos graduales.
  - limpieza de ops `acked` en cliente.

### R6 - Multi-moneda / tasas (Venezuela)
- Riesgo: mezclar monedas sin snapshot; recalcular ventas con tasa nueva; redondeo con float.
- Mitigacion:
  - columnas duales documento/funcional en lineas y cabecera; `exchangeRateDate` + `fx*` inmutables tras confirmar.
  - `Decimal` en Postgres/Prisma; strings en API donde aplique.
  - validar payload offline vs servidor con tolerancia documentada.
  - tasas diarias append-only; auditoria por `createdAt` / `source`.

## 5) Backlog detallado (tareas accionables)

Estado: `TODO | IN_PROGRESS | DONE | BLOCKED`

### Lo que sigue o falta (prioridad razonable)

Checklist vivo; marcar al cerrar cada ítem.

- [x] **1. Seguridad `/ops/*`** — `OPS_API_KEY` + cabeceras `X-Ops-Api-Key` o `Bearer`; opcional `OPS_IP_ALLOWLIST`; `TRUST_PROXY` (ver M5 y README).
- [x] **2. M6 — Pruebas integración críticas** — FX inmutable + sync `SALE` mismo `opId` (`npm run test:integration` + seed).
- [x] **3. M0 — Respuestas / trazabilidad** — Errores JSON unificados + `X-Request-Id` + `requestId` en payload de error (hecho).
- [x] **4. M3 — Cierre + tests sync** — Módulo marcado DONE; tests `push()` con transacción simulada: `NOOP`, `INVENTORY_ADJUST` aplicado, `unknown_op_type` (`sync.service.spec.ts`).
- [ ] **5. M2 futuro** — PATCH metadatos línea inventario; API reservas (`reserved`).
- [x] **6. Multi-moneda** — Pares por `ExchangeRate` + `findLatestForDocumentFunctionalPair`; `SPOT_ON_RETURN` + `fxSnapshot`; redondeo en `convert-amount` / `SalesService` / `SaleReturnsService`; seed EUR/USD.
- [ ] **7. Sync / producto** — Unificar o aclarar dos `serverVersion` (pull vs push); backfill `ServerChangeLog`; opcional inventario en pull.
- [ ] **8. Fuera Fase 1** — Devolución compra a proveedor, auth usuarios/login POS, reportería, contabilidad, WebSockets.
- [x] **9. Documentación front** — `FRONTEND_INTEGRATION_CONTEXT`: §13 ejemplos JSON por pantalla/flujo; §14 FX (pares, snapshots, límites).

### Sprint 0 (cerrado)

- [x] DONE - Definir contrato DTO para `sync/push` y `sync/pull`. (ver `docs/api/SYNC_CONTRACTS.md`)
- [x] DONE - Diseñar `outbox_events` (schema e indices). (ver `docs/api/OUTBOX_EVENTS.md` + modelo `OutboxEvent` en `prisma/schema.prisma`)
- [x] DONE - Definir documento Mongo `products_read`. (ver `docs/api/MONGO_PRODUCTS_READ.md`)
- [x] DONE - Definir politica de borrado de producto (soft delete). (ver `docs/api/PRODUCT_SOFT_DELETE_POLICY.md`)
- [x] DONE - Crear test cases minimos de idempotencia por `opId`. (ver `docs/qa/IDEMPOTENCY_OPID_TEST_CASES.md`)

### Sprint 1 (actual) - Implementacion + Documentacion API

- [x] DONE - Implementar CRUD `products` con validacion (DTOs, validacion global y soft delete). (ver `src/modules/products/`)
- [x] DONE - Implementar escritura a outbox en transaccion para `PRODUCT_CREATED|UPDATED|DEACTIVATED`. (ver `products.service.ts` + `product-outbox.payload.ts`)
- [x] DONE - Logs al arranque: PostgreSQL conectado + MongoDB (conectado, omitido sin URI, o error si URI invalida). (ver `PrismaService`, `MongoService`)
- [x] DONE - Implementar worker de proyeccion a Mongo (`products_read`) con retry/backoff. (ver `src/outbox/outbox-mongo.worker.ts`)
- [x] DONE - Fundacion **multi-moneda** (Venezuela): modelos `Currency`, `ExchangeRate`, `BusinessSettings`; campos FX/duales en ventas/compras/lineas/inventario/movimientos; doc dominio + `FRONTEND_INTEGRATION_CONTEXT.md` + migracion `multi_currency_foundation`. (confirmación compra/venta MVP + tests conversión: hecho; devoluciones / más pares: pendiente)
- [x] DONE - Endpoints `GET /stores/:storeId/business-settings`, `GET /exchange-rates/latest`, `POST /exchange-rates` + `npm run db:seed`.
- [x] DONE - Guard global `X-Store-Id` (tienda + `BusinessSettings`); tasas solo por tienda; proyeccion Mongo `fx_rates_read` via outbox. Ver `StoreConfiguredGuard`, `FX_RATES_READ.md`.
- [x] DONE - Lectura catalogo: `GET /products` y `GET /products/:id` desde Mongo `products_read` con fallback a Postgres (`source=auto` por defecto); `X-Catalog-Source`; `source=mongo|postgres`.
- [x] DONE - `POST /sync/push` + `StoreSyncState` + `SyncOperation` (ver `src/modules/sync/`, `SYNC_CONTRACTS.md`).
- [x] DONE - `GET /sync/pull` + `ServerChangeLog` + registro `PRODUCT_*` desde `products.service.ts`.
- [x] DONE - Módulo `inventory`: lecturas + `POST /inventory/adjustments`; `sync/push` `INVENTORY_ADJUST` enlazado.
- [x] DONE - Módulo **ventas (M4)**: `POST /api/v1/sales`, `GET /api/v1/sales/:id`; `sync/push` `SALE` operativo (FX snapshot, `OUT_SALE` por línea, idempotencia `sale.id` + `opId`). Ver `src/modules/sales/`, `SYNC_CONTRACTS.md`.
- [x] DONE - Módulo **compras / recepción**: `POST /api/v1/purchases`, `GET /api/v1/purchases/:id`; `sync/push` `PURCHASE_RECEIVE`; `IN_PURCHASE` por línea; seed `Supplier` por defecto. Ver `src/modules/purchases/`.
- [x] DONE - **FX compartido**: `StoreFxSnapshotService` + `FxSnapshotDto` en `exchange-rates` (ventas/compras/sync).
- [x] DONE - **M5 observabilidad**: `GET /api/v1/ops/metrics` (reconciliación inventario, outbox, sync); `OpsSchedulerService` (intervalo env, alertas en log). Ver `src/modules/ops/`.
- [x] DONE - **Devoluciones venta**: `POST/GET /api/v1/sale-returns`, `sync/push` `SALE_RETURN`; migración `SaleReturn` / `SaleReturnLine`. Ver `RETURNS_POLICY.md`, `src/modules/sale-returns/`.
- [x] DONE - Swagger en `http://localhost:3000/api/docs` (`@nestjs/swagger` + DTOs documentados en sync).
- [x] DONE - Coleccion Postman `postman/QuickMarket_API.postman_collection.json` (variables `baseUrl`, `storeId`).
- [x] DONE - **M0 API**: `RequestIdMiddleware`, `ApiExceptionFilter`, Swagger opcional `X-Request-Id`; tests `api-exception.filter.spec.ts`.
- [x] DONE - **M3 tests sync**: ampliación `sync.service.spec.ts` (`NOOP`, `INVENTORY_ADJUST`, op desconocida).
- [x] DONE - **Checklist seguridad `/ops/*`**: `OpsAuthGuard`, env `OPS_*`, tests `ops-auth.guard.spec.ts`.
- [x] DONE - **Checklist M6 integración**: `sales-fx-historical.integration.spec.ts` + `sync.service.integration.spec.ts` (`SALE` mismo `opId`).
- [x] DONE - **Checklist multi-moneda (§5.6)**: pares FX genéricos, `SPOT_ON_RETURN`, documentación redondeo, seed EUR/USD.

### Proximas tareas (sprint 2+)

- [x] DONE (base) - `docs/FRONTEND_INTEGRATION_CONTEXT.md` creado con API actual, offline, Mongo, **multi-moneda** y enlaces a dominio. **Ampliar** al implementar cada nuevo endpoint (login, ventas, tasas, inventario).
- [x] DONE - Contexto Front: §13–§14 en `FRONTEND_INTEGRATION_CONTEXT.md` (JSON por pantalla + tabla FX).
- [x] DONE (base) - Guía Flutter/Android + Gemini: `docs/flutter/IMPLEMENTACION_FLUTTER_ANDROID_GEMINI.md`; índice de copia `docs/flutter/DOCUMENTOS_A_COPIAR_AL_PROYECTO_FLUTTER.md`; `FRONTEND_INTEGRATION_CONTEXT.md` ampliado (multi-dispositivo, seguridad, roadmap sprint, proveedores sin API).
- [x] DONE - **Auth `/ops/*`**: `OpsAuthGuard`, `OPS_API_KEY`, `OPS_IP_ALLOWLIST`, `TRUST_PROXY`; Swagger + README.

## 6) Criterios de listo (Definition of Done por modulo)

Un modulo se considera `DONE` cuando cumple:
- API documentada (request/response y errores).
- Tests minimos (unit y/o integracion segun criticidad).
- Logs y metricas basicas.
- Manejo de errores de negocio y tecnicos.
- Actualizacion de este tracker (estado, fecha y decision).

## 7) Decision log (actualizar en cada cambio de arquitectura)

- 2026-03-26: PostgreSQL definido como fuente maestra.
- 2026-03-26: MongoDB definido como read model para productos mobile.
- 2026-03-26: Estrategia offline definida con push/pull + oplog + idempotencia por `opId`.
- 2026-03-26: Se establece Outbox Pattern para consistencia Postgres -> Mongo.
- 2026-04-03: Productos escriben `OutboxEvent` en la misma transaccion que create/update/soft delete.
- 2026-04-03: Arranque con log explicito de conexion PostgreSQL; Mongo opcional via `MONGODB_URI` con ping y manejo de error sin tumbar la API.
- 2026-04-03: Worker `OutboxMongoWorker` consume `OutboxEvent` y hace upsert en Mongo `products_read` (poll configurable, batch, backoff).
- 2026-04-04: Arquitectura multi-moneda (Venezuela) documentada; schema Prisma extendido (`Currency`, `ExchangeRate`, `BusinessSettings`, campos FX/duales en ventas/compras/inventario/movimientos); `FRONTEND_INTEGRATION_CONTEXT.md` y `MONGO_PRODUCTS_READ` alineados.
- 2026-04-04: Guard global `X-Store-Id` + tienda con `BusinessSettings`; tasas solo por tienda; outbox proyecta `fx_rates_read` en Mongo; eliminada tasa global en API y variable `EXCHANGE_RATE_REQUIRE_STORE_ID`.
- 2026-04-03: `GET /api/v1/products` y `GET /api/v1/products/:id` leen primero Mongo (`products_read`) en modo `auto`, con fallback a PostgreSQL; query `source` y cabecera `X-Catalog-Source`.
- 2026-04-04: `POST /api/v1/sync/push`, modelo `StoreSyncState`, `SyncOperation` ampliado; Swagger `/api/docs`; Postman; tests integracion opcionales `RUN_INTEGRATION=1`.
- 2026-04-04: `GET /api/v1/sync/pull` + tabla `ServerChangeLog`; productos registran `PRODUCT_*` para pull; documentado desacople de versiones push vs pull.
- 2026-04-04: Tabla **Implementado vs. pasos a futuro** en tracker; **M2 inventario** (`GET/POST inventory`, movimientos, ajustes atómicos, costeo funcional); `sync/push` `INVENTORY_ADJUST` operativo.
- 2026-04-03: **M4 ventas**: `POST/GET sales`, conversión documento→funcional (USD/VES), `sync/push` `SALE` con `createSaleTx` en transacción de batch; movimientos `OUT_SALE` con `opId` por línea; idempotencia por `sale.id` existente en tienda.
- 2026-04-03: **Compras + M6 parcial**: `POST/GET purchases`, `sync/push` `PURCHASE_RECEIVE`, `createPurchaseTx` + `IN_PURCHASE`; `StoreFxSnapshotService` extraído de ventas; tests `convert-amount.spec.ts`; DTO `sync/push` incluye `PURCHASE_RECEIVE`.
- 2026-04-03: **M5**: módulo `ops` con reconciliación inventario vs movimientos (SQL agregado), métricas outbox/sync, job por `setInterval` + umbrales `OUTBOX_*` / desactivación `OPS_SCHEDULER_ENABLED=0`.
- 2026-04-03: **M6 devoluciones**: `SaleReturn` + `SaleReturnLine`, `IN_RETURN` con COGS desde `OUT_SALE` agregado por venta/producto; FX heredada; `SALE_RETURN` en sync; auth `/ops/*` dejada como backlog explícito.
- 2026-04-04: **M0 + M3**: errores JSON + `X-Request-Id`; checklist “Lo que sigue o falta” en §5; M3 `DONE`; tests sync por tipo (mock `$transaction`).
- 2026-04-04: **Checklist 1–2**: `OpsAuthGuard` en `/ops/*`; integración M6 — venta conserva FX tras nueva `ExchangeRate`; sync `SALE` idempotente por `opId`.
- 2026-04-04: **Multi-moneda (checklist 6)**: `ExchangeRatesService.findLatestForDocumentFunctionalPair`; `StoreFxSnapshotService` sin límite USD/VES; devoluciones `SPOT_ON_RETURN`; documentación redondeo; seed `EUR` + par EUR/USD.
- 2026-04-04: **Documentación front (checklist 9)**: `FRONTEND_INTEGRATION_CONTEXT.md` §13 (JSON por pantalla: errores, settings, FX, productos, inventario, ventas, compras, devoluciones, sync); §14 (escenarios FX y límites).
