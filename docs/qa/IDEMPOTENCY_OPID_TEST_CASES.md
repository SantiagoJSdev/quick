# Test Cases Minimos - Idempotencia por `opId`

Objetivo: asegurar que una misma operacion enviada varias veces desde POS no genere efectos duplicados.

Scope MVP: `POST /api/v1/sync/push` + persistencia en `SyncOperation` y entidades afectadas (ej: `Sale`, `StockMovement`).

## 1) Datos base de prueba

- `deviceId`: `device-qa-001`
- `storeId`: `store-qa-001`
- `productId`: `product-qa-001`
- `opId` valido UUID v4: `9c1b39e8-2f4a-4c17-9a89-8b5e7cb4b9d7`
- `opType`: `SALE`
- `initialStock`: 20
- `saleQty`: 2

## 2) Casos minimos obligatorios

### TC-01 - Primer envio de `opId` nuevo

- Precondicion:
  - `opId` no existe en `SyncOperation`.
- Paso:
  - Enviar `POST /sync/push` con 1 op (`SALE`) y `opId` nuevo.
- Esperado:
  - respuesta incluye `acked` con ese `opId`,
  - se crea `SyncOperation` una sola vez,
  - se crea la venta una sola vez,
  - se crea `StockMovement` una sola vez,
  - stock final = `initialStock - saleQty`.

### TC-02 - Reintento exacto del mismo payload y mismo `opId`

- Precondicion:
  - TC-01 ejecutado correctamente.
- Paso:
  - reenviar mismo request (mismo `opId`, mismo payload).
- Esperado:
  - respuesta marca `skipped` (o `acked` idempotente sin nuevo efecto, según contrato),
  - no se crea nueva venta,
  - no se crea nuevo `StockMovement`,
  - stock no cambia respecto al final de TC-01.

### TC-03 - Mismo `opId` con payload distinto

- Precondicion:
  - existe `opId` aplicado previamente.
- Paso:
  - enviar request con mismo `opId` pero contenido diferente (ej: cantidad distinta).
- Esperado:
  - backend rechaza con conflicto controlado (`409`) o `failed` con reason de conflicto,
  - no se altera venta/movimiento original,
  - stock no cambia.

### TC-04 - Batch con mezcla (`nuevo + duplicado`)

- Precondicion:
  - existe una op previa con `opId=A`.
- Paso:
  - enviar batch con:
    - op `A` duplicada,
    - op `B` nueva.
- Esperado:
  - respuesta:
    - `A` en `skipped` (o idempotente sin efectos),
    - `B` en `acked`,
  - solo hay efectos de `B`.

### TC-05 - `opId` invalido (no UUID v4)

- Paso:
  - enviar op con `opId=abc123`.
- Esperado:
  - `400` validation error,
  - no se crea `SyncOperation`,
  - no hay cambios de negocio.

### TC-06 - Concurrencia: dos requests simultáneos con mismo `opId`

- Paso:
  - lanzar dos `POST /sync/push` casi al mismo tiempo con el mismo `opId`.
- Esperado:
  - solo uno aplica efectos,
  - el otro queda `skipped`/conflict idempotente,
  - no duplicados en venta/movimientos.

### TC-07 - Reintento tras timeout de red en cliente

- Paso:
  - simular que cliente no recibe respuesta del primer envío y reintenta.
- Esperado:
  - backend mantiene un solo efecto final,
  - cliente puede converger con `acked/skipped`.

## 3) Verificaciones de DB (checklist)

Para cada test, verificar:

- `SyncOperation`:
  - existe maximo 1 registro por `opId` (indice unico).
- `Sale`:
  - no hay duplicados funcionales por misma op.
- `StockMovement`:
  - maximo 1 movimiento asociado al `opId`.
- `InventoryItem.quantity`:
  - cambia solo cuando corresponde.

## 4) Criterio de aprobacion MVP

Se considera aprobado si:

- TC-01..TC-07 pasan.
- No hay duplicados de efectos de negocio bajo reintentos o concurrencia.
- El contrato de respuesta (`acked/skipped/failed`) permite al cliente converger estado local.

## 5) Siguiente paso sugerido (cuando se codifique)

- Implementar primero tests de integracion para `sync/push` en Jest + DB de prueba.
- Luego completar unit tests del servicio de idempotencia.

