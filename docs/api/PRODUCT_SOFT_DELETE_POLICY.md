# Politica de Borrado de Producto (Soft Delete)

Objetivo: evitar perdida de historial y mantener consistencia entre PostgreSQL, Mongo y POS offline.

## 1) Principio general

- Un producto **no se elimina fisicamente** en MVP.
- "Eliminar producto" en UI significa **desactivar** (`active=false`).
- Esto preserva:
  - historial de ventas,
  - movimientos de inventario,
  - referencias en documentos previos.

## 2) Reglas de negocio

### Regla principal

- Si un producto existe, el endpoint de borrado debe marcar:
  - `Product.active = false`
  - actualizar `updatedAt`

### Restricciones recomendadas

- Producto desactivado:
  - no puede venderse en nuevas ventas,
  - no aparece en listados por defecto de productos activos,
  - puede aparecer en consultas historicas/auditoria.

- Reactivacion:
  - permitida via endpoint explicito (`/products/:id/reactivate` o `PATCH active=true`).

### Casos con inventario

- Si tiene stock > 0:
  - opcion A (recomendada MVP): permitir desactivar y dejar stock historico, pero bloquear venta.
  - opcion B (mas estricta): no permitir desactivar hasta ajuste a 0.

Para avanzar rapido en MVP: usar **opcion A**.

## 3) Contrato API recomendado

### "Borrar" producto

- Endpoint: `DELETE /api/v1/products/:id`
- Comportamiento real: soft delete.

#### Respuesta sugerida

```json
{
  "id": "p-uuid",
  "active": false,
  "updatedAt": "2026-03-26T19:00:00Z",
  "message": "Product deactivated"
}
```

### Listado de productos

- `GET /api/v1/products` debe devolver activos por defecto.
- Query opcional:
  - `includeInactive=true` para admin/auditoria.

## 4) Integracion con Outbox y Mongo

### Evento de dominio

- Al desactivar producto en PostgreSQL, crear `OutboxEvent`:
  - `eventType = PRODUCT_DEACTIVATED`
  - payload con `product.id`, `active=false`, `updatedAt` y metadatos relevantes.

### Proyeccion en Mongo (`products_read`)

- Worker procesa `PRODUCT_DEACTIVATED` y hace:
  - `active=false`
  - actualiza `pg.updatedAt`
  - actualiza `sync.lastEventType/lastProjectedAt`

- En MVP **no borrar documento de Mongo**.

## 5) Integracion con Sync POS (pull)

- El servidor publica `PRODUCT_DEACTIVATED` en stream de cambios (`serverVersion`).
- En `GET /sync/pull`, POS recibe ese evento.
- Cliente POS:
  - marca producto local como inactivo,
  - evita nuevas ventas con ese producto.

## 6) Idempotencia y concurrencia

- Repetir `DELETE` sobre producto ya inactivo:
  - responder `200` idempotente con `active=false` (o `204`), sin error.

- Si dos procesos desactivan a la vez:
  - mantener resultado final `active=false`,
  - generar maximo un evento efectivo por cambio de estado (recomendado dedupe en outbox).

## 7) Hard delete (solo mantenimiento)

No habilitar en API publica en MVP.

Si a futuro se requiere purga:
- job administrativo restringido,
- solo para productos sin referencias historicas,
- con respaldo previo.

## 8) Criterios de aceptacion de esta politica

- Borrar en API no rompe ventas historicas ni movimientos.
- Producto desactivado no se vende ni aparece en listados por defecto.
- Mongo y POS reflejan `active=false` via outbox + pull sync.
- Repetir la desactivacion no crea inconsistencias.

