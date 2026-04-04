# Mongo Read Model: `products_read`

Objetivo: colección optimizada para **lectura desde mobile** (offline-first) sin depender de PostgreSQL.

Regla: PostgreSQL sigue siendo la fuente maestra (writes). Mongo es proyección (read model) alimentada por `OutboxEvent`.

## 1) Documento `products_read` (estructura)

**Colección**: `products_read`

```json
{
  "_id": "p-uuid", 
  "productId": "p-uuid",

  "sku": "SKU-001",
  "barcode": "1234567890123",
  "name": "Harina PAN 1kg",
  "description": "Opcional",
  "image": "https://...",
  "type": "GOODS",

  "category": {
    "id": "cat-uuid",
    "name": "Alimentos"
  },

  "unit": "unidad",
  "currency": "VES",

  "price": "30.00",
  "cost": "20.00",

  "tax": {
    "id": "tax-uuid",
    "name": "IVA",
    "rate": "0.16"
  },

  "supplier": {
    "id": "sup-uuid",
    "name": "Proveedor X"
  },

  "active": true,

  "pg": {
    "updatedAt": "2026-03-26T18:00:02Z"
  },

  "sync": {
    "lastEventId": "outbox-uuid",
    "lastEventType": "PRODUCT_UPDATED",
    "lastProjectedAt": "2026-03-26T18:00:03Z"
  }
}
```

### Notas de tipos

- `price/cost/rate` en Mongo pueden guardarse como:
  - **string decimal** (recomendado si quieres evitar problemas de precisión cross-platform),
  - o `Decimal128` (si vas a usarlo consistentemente en backend).
- `_id` recomendado igual a `productId` para upsert simple y rápido.

## 2) Índices recomendados (Mongo)

Los índices dependen de cómo consultará la app:

### Unicidad / lookup directo

- `productId` (si usas `_id=productId`, ya queda único)
- `sku` **unique** (si en tu negocio es único)
- `barcode` **unique sparse** (porque puede ser null)

### Listado y filtros comunes

- `active` (para listar solo activos)
- `category.id` (filtro por categoría)
- `name` (búsqueda por texto)

### Índices propuestos

1. `sku` único
2. `barcode` único sparse
3. `active + name` (para listados activos ordenados/búsqueda simple)
4. `category.id + active`
5. (Opcional) `text index` en `name` + `sku` si usarás búsqueda tipo “contains”

## 3) Mapeo desde `OutboxEvent.payload`

### Event types (PostgreSQL Outbox)

- `PRODUCT_CREATED`
- `PRODUCT_UPDATED`
- `PRODUCT_DEACTIVATED` (soft delete)

### Payload recomendado (snapshot)

Para simplificar la proyección, el `payload` del outbox debe traer un **snapshot** del producto con lo necesario para Mongo:

```json
{
  "product": {
    "id": "p-uuid",
    "sku": "SKU-001",
    "barcode": "123",
    "name": "Harina",
    "description": null,
    "image": null,
    "type": "GOODS",
    "unit": "unidad",
    "currency": "VES",
    "price": "30.00",
    "cost": "20.00",
    "active": true,
    "updatedAt": "2026-03-26T18:00:02Z",
    "category": { "id": "cat-uuid", "name": "Alimentos" },
    "tax": { "id": "tax-uuid", "name": "IVA", "rate": "0.16" },
    "supplier": { "id": "sup-uuid", "name": "Proveedor X" }
  }
}
```

### Reglas de proyección (worker)

- Si `eventType` es `PRODUCT_CREATED` o `PRODUCT_UPDATED`:
  - **upsert** en `products_read` con `_id = product.id`
  - setear campos de negocio (sku, name, price, etc)
  - setear `pg.updatedAt = product.updatedAt`
  - setear `sync.lastEventId/Type/ProjectedAt`

- Si `eventType` es `PRODUCT_DEACTIVATED`:
  - **NO borrar físicamente** inicialmente
  - setear `active=false`
  - (opcional) setear `pg.updatedAt` y `sync.*`

### ¿Por qué snapshot y no diff?

- Snapshot simplifica el worker (menos queries a PostgreSQL).
- Reduce bugs por “campos faltantes” al reconstruir el estado.
- Si luego necesitas optimizar, puedes migrar a diff con cuidado.

## 4) Queries típicas desde mobile (ejemplos)

- Listar activos: `active=true` (paginado)
- Buscar por SKU: `sku == "..."` (índice)
- Buscar por barcode: `barcode == "..."` (índice sparse unique)
- Buscar por nombre: `text search` o `active + name` según estrategia

## 5) Alcances y límites del read model

- `products_read` **no** debe ser usado para reglas de negocio críticas (eso vive en PostgreSQL).
- Mongo puede estar **eventualmente consistente** (segundos/minutos en fallos).
- El backend puede tener fallback temporal a PostgreSQL para lecturas críticas si Mongo está caído.

## 6) Multi-moneda (Venezuela)

- El catalogo en Postgres mantiene `price` + `currency` y `cost` en **moneda funcional** (ver `docs/domain/MULTI_CURRENCY_ARCHITECTURE.md`).
- La proyeccion `products_read` debe exponer al menos `price`, `currency` (o `listPriceCurrency`) para UI; opcionalmente campos de referencia funcional cuando el worker los incluya en el payload outbox (tarea de evolucion).
- **No** usar la tasa del dia en Mongo para reinterpretar ventas ya cerradas; la tasa vive en el documento de venta/compra en PostgreSQL.

