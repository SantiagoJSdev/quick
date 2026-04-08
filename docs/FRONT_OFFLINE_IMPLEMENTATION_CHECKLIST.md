# Frontend POS Offline - Guia tecnica y checklist de implementacion

Este documento es para el equipo frontend. Define que debe analizar e implementar para que el POS funcione offline, sincronice automaticamente al volver internet y mantenga datos consistentes en todas las vistas.

## 1) Objetivo

Implementar un modo offline-first en frontend que permita:

- vender sin internet,
- operar inventario basico sin internet (segun permisos/flujo),
- reintentar sincronizacion automaticamente al reconectar o por intervalos,
- evitar duplicados usando idempotencia,
- mantener catalogo/inventario/historial local actualizados con pull incremental.

## 2) Principios tecnicos obligatorios

- Toda operacion de negocio offline debe persistirse localmente antes de enviarse.
- Cada operacion sincronizable debe llevar `opId` UUID v4 unico e inmutable.
- Reintentos deben reenviar el mismo `opId` y el mismo payload logico.
- Dinero y cantidades decimales deben manejarse como string decimal (no float JS/Dart).
- Si una pantalla permite crear producto+stock en un paso, usar `Idempotency-Key` estable por intento de formulario.
- No asumir conectividad estable: todo flujo debe soportar timeout, reconexion y reintento.

## 3) Endpoints backend a usar para estrategia offline

## 3.1 Sync principal

- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull?since=<version>&limit=<n>`

`sync/push` acepta operaciones por lote (`ops`) con `opType`:

- `NOOP`
- `SALE`
- `SALE_RETURN`
- `PURCHASE_RECEIVE`
- `INVENTORY_ADJUST`

## 3.2 Catalogo y configuracion base

- `GET /api/v1/stores/:storeId/business-settings`
- `PATCH /api/v1/stores/:storeId/business-settings`
- `GET /api/v1/products`
- `GET /api/v1/products/:id`
- `POST /api/v1/products`
- `PATCH /api/v1/products/:id`
- `DELETE /api/v1/products/:id`
- `POST /api/v1/products-with-stock` (requiere `Idempotency-Key`)

## 3.3 Inventario

- `GET /api/v1/inventory`
- `GET /api/v1/inventory/:productId`
- `GET /api/v1/inventory/movements`
- `POST /api/v1/inventory/adjustments`

## 3.4 Ventas, compras, devoluciones

- `POST /api/v1/sales`
- `GET /api/v1/sales`
- `GET /api/v1/sales/:id`
- `POST /api/v1/purchases`
- `GET /api/v1/purchases/:id`
- `POST /api/v1/sale-returns`
- `GET /api/v1/sale-returns/:id`

## 3.5 Tasas y multi-moneda

- `GET /api/v1/exchange-rates/latest`
- `POST /api/v1/exchange-rates` (si rol/admin en app)

## 4) Componentes frontend que deben existir para offline completo

Minimo recomendado en arquitectura frontend:

- `ConnectivityService`: estado online/offline + eventos de reconexion.
- `SyncScheduler`: temporizador de sync cada X segundos/minutos y trigger por reconexion.
- `SyncQueueRepository` (SQLite): cola local `pending/sent/ack/failed`.
- `SyncEngine`:
  - arma batch de `sync/push`,
  - procesa respuesta `acked/skipped/failed`,
  - hace backoff exponencial en error transitorio,
  - evita concurrencia doble (lock).
- `PullUpdater`:
  - guarda `sinceVersion` local,
  - ejecuta `sync/pull`,
  - aplica cambios al read model local.
- `LocalReadModels` por vista:
  - catalogo local,
  - inventario local,
  - historico local (si aplica),
  - metadatos de sync.
- `Conflict/Retry Handler`:
  - marca items para revision manual cuando fallen por reglas de negocio.

## 5) Modelo local recomendado (SQLite)

Tablas base sugeridas:

- `local_ops`:
  - `opId`, `opType`, `payloadJson`, `status`, `createdAt`, `lastAttemptAt`, `attemptCount`, `lastError`.
- `sync_state`:
  - `storeId`, `lastPullVersion`, `lastSuccessfulPushAt`, `lastSuccessfulPullAt`.
- `products_local` (cache lectura).
- `inventory_local` (cache lectura).
- `exchange_rates_local` (cache lectura).
- `held_tickets` y `held_ticket_lines` (tickets en espera locales).

Estados de `local_ops`:

- `pending`
- `sent`
- `ack`
- `failed_retryable`
- `failed_manual`

## 6) Flujo operativo esperado

## 6.1 En cada accion de usuario offline

1. Validar datos del formulario.
2. Generar `opId` UUID v4.
3. Guardar op en `local_ops` como `pending`.
4. Actualizar UI optimista y read model local.
5. Encolar para sync.

## 6.2 Al reconectar o cada intervalo

1. Tomar lock de sincronizacion.
2. Ejecutar `push` por lotes (ej. 50 ops).
3. Marcar `ack`/`skipped` como completadas.
4. Clasificar `failed`:
   - retryable (timeout, 5xx, red),
   - manual (400/409 negocio no recuperable automatico).
5. Ejecutar `pull` incremental con `since`.
6. Aplicar cambios al cache local.
7. Liberar lock y notificar estado a UI.

## 6.3 Al crear producto+stock desde frontend

1. Generar `Idempotency-Key` al abrir formulario.
2. Mantener esa key para todos los reintentos del mismo intento de alta.
3. Si usuario cambia datos y reinicia flujo, generar nueva key.
4. Manejar `409` como clave reutilizada con body distinto.

## 7) Checklist tecnico de analisis, verificacion e implementacion

Este es el checklist oficial a ejecutar en el frontend.

## Fase A - Analisis inicial (primer paso obligatorio)

- [ ] Inventariar todas las vistas y acciones que hoy dependen de internet.
- [ ] Mapear cada accion a endpoint backend correspondiente.
- [ ] Identificar cuales acciones ya tienen soporte por `sync/push` y cuales no.
- [ ] Listar pantallas criticas que hoy no guardan estado local.
- [ ] Definir matriz: pantalla -> online-only / offline-capable / pendiente.
- [ ] Validar estrategia de identificadores (`opId`, `sale.id`, `Idempotency-Key`).
- [ ] Revisar manejo actual de money/decimales y corregir uso de float si existe.

## Fase B - Diseno tecnico frontend

- [ ] Definir estructura SQLite (cola ops + read models + sync_state).
- [ ] Diseñar `SyncEngine` con lock para evitar dos sync simultaneos.
- [ ] Definir politicas de reintento (intervalo, backoff, max intentos).
- [ ] Definir clasificacion de errores retryable vs manual.
- [ ] Definir UX de estado sync (icono, banner, contador pendientes, ultimo sync).
- [ ] Definir telemetria minima (errores de sync por tipo).

## Fase C - Implementacion base offline

- [ ] Crear `ConnectivityService`.
- [ ] Crear persistencia local `local_ops`.
- [ ] Integrar generacion de `opId` en acciones sincronizables.
- [ ] Implementar `SyncScheduler` (trigger reconexion + trigger periodico).
- [ ] Implementar `POST /sync/push` por lotes.
- [ ] Implementar `GET /sync/pull` incremental por `since`.
- [ ] Aplicar cambios de pull a caches locales.
- [ ] Asegurar idempotencia en reintentos (mismo opId, mismo payload).

## Fase D - Cobertura por modulos funcionales

- [ ] Ventas: flujo offline completo + sync `SALE`.
- [ ] Ajustes inventario: flujo offline + sync `INVENTORY_ADJUST`.
- [ ] Compras: definir si se habilita offline o se fuerza online; si offline, usar `PURCHASE_RECEIVE`.
- [ ] Devoluciones: definir offline policy; si aplica offline, usar `SALE_RETURN`.
- [ ] Productos: crear/editar local con cola o restringir a online segun riesgo operativo.
- [ ] Producto+stock: implementar `Idempotency-Key` obligatorio en frontend.

## Fase E - Tickets en espera y continuidad de caja

- [ ] Guardar tickets en espera solo en SQLite local.
- [ ] Permitir recuperar/editar/cobrar ticket en espera sin internet.
- [ ] Al cobrar ticket: generar op definitiva (`SALE`) y sincronizar.
- [ ] Asegurar que ticket en espera no afecte inventario hasta confirmar venta.

## Fase F - Verificacion QA (paso a paso)

- [ ] Prueba sin internet total: crear operaciones y reiniciar app (deben persistir).
- [ ] Reconectar internet: verificar push automatico y limpieza de pendientes.
- [ ] Simular timeout en push: validar reintento sin duplicados.
- [ ] Repetir envio mismo `opId`: backend debe responder `skipped`/equivalente sin duplicar efecto.
- [ ] Probar `products-with-stock` con mismo `Idempotency-Key` y mismo body: una sola creacion.
- [ ] Probar misma key y body distinto: recibir `409`.
- [ ] Validar consistencia visual tras pull (catalogo e inventario actualizados).
- [ ] Validar multi-moneda offline (snapshot FX preservado).

## Fase G - Salida a produccion

- [ ] Feature flag para activar offline por modulo.
- [ ] Migracion de base local versionada.
- [ ] Monitoreo inicial de errores de sync y backlog local.
- [ ] Runbook soporte: como recuperar operaciones `failed_manual`.
- [ ] Capacitar equipo operativo en estados de sync.

## 8) Criterios de exito

Se considera implementado correctamente cuando:

- una caida de internet no detiene operaciones criticas del POS,
- al reconectar, el sistema sincroniza solo y sin duplicar datos,
- todas las vistas relevantes leen de cache local y se refrescan por pull,
- existe checklist QA ejecutado con evidencia por modulo.

## 9) Recomendacion inmediata para iniciar

Primer sprint frontend:

1. Ejecutar completa la **Fase A** (analisis inventario de vistas).
2. Entregar documento interno con matriz de cobertura offline por pantalla.
3. Implementar base tecnica de **Fase C** (cola + push/pull + scheduler).
4. Activar primero en Ventas e Inventario.

