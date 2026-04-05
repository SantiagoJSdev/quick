# API de proveedores — **implementado** (Quick Market)

Los proveedores son **por tienda** (`storeId` = `X-Store-Id`).  
`POST /api/v1/purchases` exige un `supplierId` existente **de esa misma tienda** y **activo**.

---

## Modelo JSON (respuesta)

| Campo | Tipo | Notas |
|--------|------|--------|
| `id` | UUID | Generado por el servidor. |
| `storeId` | UUID | Coincide con la tienda del header. |
| `name` | string | Obligatorio en alta. |
| `phone` | string? | |
| `email` | string? | |
| `address` | string? | |
| `taxId` | string? | Identificador fiscal (columna DB legada `rif`). |
| `notes` | string? | |
| `active` | boolean | Default `true`. |
| `createdAt` / `updatedAt` | ISO8601 | |

---

## `POST /api/v1/suppliers`

- **201** + cuerpo del proveedor creado.
- **No** enviar `id`.
- Cabecera: `X-Store-Id`.

**Body (ejemplo):**

```json
{
  "name": "Distribuidora Norte",
  "phone": "+58 412-0000000",
  "email": "pedidos@ejemplo.com",
  "address": "Av. Principal 123, Caracas",
  "taxId": "J-00000000-0",
  "notes": "Pago 30 días"
}
```

---

## `GET /api/v1/suppliers`

Query:

| Parámetro | Descripción |
|-----------|-------------|
| `q` | Busca texto en `name`, `taxId`, `phone` (contiene, case-insensitive). |
| `active` | `true` (default) \| `false` \| `all`. |
| `limit` | Default 50, max 200. |
| `cursor` | Paginación keyset (`nextCursor`); no usar con `format=array`. |
| `format` | `object` (default) \| `array`. |

**Respuesta por defecto:**

```json
{
  "items": [ { "...": "..." } ],
  "nextCursor": null,
  "meta": { "limit": 50, "hasMore": false, "activeFilter": "true" }
}
```

Con `format=array`: solo el array `items` (primera página, sin cursor).

---

## `GET /api/v1/suppliers/:id`

- **404** si no existe o no pertenece a la tienda del header.

---

## `PATCH /api/v1/suppliers/:id`

- Actualización parcial (`name`, `phone`, `email`, `address`, `taxId`, `notes`, `active`).
- Strings vacíos en opcionales → se guardan como `null` donde aplica.

---

## `DELETE /api/v1/suppliers/:id`

- **Soft delete:** pone `active: false` (no borra fila).
- **200** + objeto actualizado.

---

## Compras

- `POST /purchases` valida que el proveedor exista, **`storeId` coincidente** y **`active === true`**.
- Proveedores inactivos → **400** `Supplier is inactive`.

---

## Sync / Mongo

- Sin eventos `SUPPLIER_*` en sync/pull por ahora; catálogo de proveedores vía REST.

---

## Código

- `src/modules/suppliers/`
- Migración: `suppliers_store_scoped` (`storeId`, `notes`, `active`).

---

## Flutter

- Sustituir UUID manual: **listar** con `GET /suppliers`, **crear** con `POST /suppliers`, usar el `id` devuelto en `POST /purchases`.
- Contexto general: `docs/FRONTEND_INTEGRATION_CONTEXT.md`.
