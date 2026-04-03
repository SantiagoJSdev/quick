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

## 2) Alcance MVP Tecnico - Fase 1

### Incluye (in scope)

1. Modulo `products` en PostgreSQL:
   - CRUD base.
   - validaciones minimas (`sku` unico, nombre, precio, estado activo).
2. Outbox para `products`:
   - tabla `outbox_events` en PostgreSQL.
   - evento por `PRODUCT_CREATED | PRODUCT_UPDATED | PRODUCT_DEACTIVATED`.
3. Worker de proyeccion a Mongo:
   - actualiza coleccion `products_read`.
   - marca evento procesado o programa retry.
4. Lectura para app movil:
   - endpoint `GET /api/v1/products` con lectura desde Mongo.
   - fallback temporal a PostgreSQL si Mongo no responde (controlado en backend).
5. Base de sincronizacion offline:
   - contrato definido para `POST /sync/push` y `GET /sync/pull`.
   - manejo idempotente por `opId`.

### No incluye (out of scope en Fase 1)

- Resolucion avanzada de conflictos multi-dispositivo.
- Sincronizacion completa de ventas, compras y transferencias.
- WebSockets en tiempo real.
- Reconciliacion automatica completa de inventario por job nocturno.
- Reporteria avanzada y dashboards.

## 3) Roadmap por modulos

### M0 - Fundacion tecnica
- [ ] Definir `api/v1` estandar de respuestas/errores.
- [ ] Configurar validacion global y manejo de excepciones.
- [ ] Definir convencion de IDs (`UUID v4`) y trazabilidad (`requestId`, `opId`).

### M1 - Products + Outbox + Mongo Projection (MVP inicial)
- [ ] CRUD de productos en PostgreSQL.
- [ ] Crear tabla `outbox_events`.
- [ ] Publicar eventos de producto dentro de transaccion.
- [ ] Worker para proyectar a Mongo.
- [ ] Endpoint lectura de productos para mobile.
- [ ] Pruebas de consistencia Postgres -> Mongo.

### M2 - Inventory base
- [ ] Endpoints de inventario por tienda.
- [ ] Ajustes manuales con `StockMovement`.
- [ ] Reglas atomicas `increment/decrement`.

### M3 - Sync offline POS (operativo)
- [ ] `POST /sync/push` con batch y acuse por op.
- [ ] `GET /sync/pull` por `serverVersion`.
- [ ] Persistencia de `SyncOperation` + estados.
- [ ] Tests de reintento e idempotencia.

### M4 - Sales integradas con inventario
- [ ] Crear venta + lineas en transaccion.
- [ ] Generar `StockMovement` tipo `OUT_SALE`.
- [ ] Evitar stock negativo segun politica definida.

### M5 - Reconciliacion y observabilidad
- [ ] Job de conciliacion inventario vs movimientos.
- [ ] Alertas por desfases y cola outbox acumulada.
- [ ] Metricas de lag de sincronizacion.

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
  - endpoint de health y metrica de `outbox_lag_seconds`.

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

## 5) Backlog detallado (tareas accionables)

Estado: `TODO | IN_PROGRESS | DONE | BLOCKED`

### Sprint actual

- [x] DONE - Definir contrato DTO para `sync/push` y `sync/pull`. (ver `docs/api/SYNC_CONTRACTS.md`)
- [x] DONE - Diseñar `outbox_events` (schema e indices). (ver `docs/api/OUTBOX_EVENTS.md` + modelo `OutboxEvent` en `prisma/schema.prisma`)
- [x] DONE - Definir documento Mongo `products_read`. (ver `docs/api/MONGO_PRODUCTS_READ.md`)
- [x] DONE - Definir politica de borrado de producto (soft delete). (ver `docs/api/PRODUCT_SOFT_DELETE_POLICY.md`)
- [ ] TODO - Crear test cases minimos de idempotencia por `opId`.

### Proximas tareas

- [ ] TODO - Implementar CRUD `products` con validacion.
- [ ] TODO - Implementar escritura a outbox en transaccion.
- [ ] TODO - Implementar worker de proyeccion a Mongo.
- [ ] TODO - Implementar endpoint lectura mobile con fallback.
- [ ] TODO - Implementar primer corte de `sync/push`.

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

