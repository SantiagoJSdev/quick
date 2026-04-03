# Outbox Events (PostgreSQL) - Diseño + Índices

Objetivo: garantizar que todo cambio que deba replicarse (ej: productos a Mongo) **no se pierda** aunque falle el worker o Mongo.

## Tabla: `outbox_events`

### Campos (mínimos + operativos)

- **id**: UUID (PK).
- **aggregateType**: string (ej: `Product`).
- **aggregateId**: UUID/string (id del registro en PostgreSQL).
- **eventType**: string (ej: `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_DEACTIVATED`).
- **payload**: JSON (snapshot o diff; recomendado snapshot “lo necesario para Mongo”).
- **status**: enum/string:
  - `PENDING`: listo para procesar.
  - `PROCESSING`: tomado por un worker.
  - `PROCESSED`: ya aplicado (Mongo actualizado).
  - `FAILED`: excedió reintentos o error no recuperable (requiere revisión).
- **attempts**: int (default 0).
- **availableAt**: datetime (default now) — para reintentos programados.
- **lockedAt**: datetime nullable — cuándo un worker lo tomó.
- **lockedBy**: string nullable — id del worker/instancia.
- **lastError**: string nullable — mensaje de error (corto).
- **createdAt**: datetime (default now).
- **processedAt**: datetime nullable.

### Reglas de uso

- Se inserta **en la misma transacción** que modifica el agregado (ej: `Product`).
- El worker procesa solo eventos `PENDING` con `availableAt <= now()`.
- Al tomar un evento, el worker lo marca `PROCESSING` y setea `lockedAt/lockedBy`.
- Si el worker falla:
  - incrementa `attempts`,
  - setea `lastError`,
  - vuelve a `PENDING` con `availableAt = now() + backoff`.
- Al superar N intentos (ej 25): marcar `FAILED`.

## Índices recomendados (muy importantes)

1. **Consumir cola rápido**
   - Index: `(status, availableAt)`
   - Permite encontrar “lo próximo a procesar” sin escanear toda la tabla.

2. **Auditoría y troubleshooting**
   - Index: `(createdAt)`
   - Consultas por rango de fechas.

3. **Búsqueda por agregado**
   - Index: `(aggregateType, aggregateId, createdAt)`
   - Útil para ver el historial de un producto específico.

4. **(Opcional) Filtrar por tipo de evento**
   - Index: `(eventType, createdAt)`

## Dedupe (opcional, recomendado si hay riesgo de repetir eventos)

Agregar un campo `dedupeKey` (string) y un índice único para evitar duplicados lógicos.
Ejemplo de `dedupeKey`:

- `Product:{productId}:{updatedAt}`
- o un hash estable del payload si aplica

## Procesamiento seguro (nota técnica)

En PostgreSQL, el worker debe “tomar” trabajos con una estrategia tipo:
- `SELECT ... FOR UPDATE SKIP LOCKED` (ideal)
o una actualización atómica que cambie `status=PENDING -> PROCESSING` en una sola operación.

Esto evita que dos workers procesen el mismo evento.

## Relación con Mongo

Para `products_read` en Mongo:
- usar `productId` = `aggregateId`
- upsert por `productId`
- en “borrado”: preferir `active=false` (soft delete) al inicio

