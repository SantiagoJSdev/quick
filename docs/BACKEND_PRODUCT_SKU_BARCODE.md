# Quick Market — SKU vs código de barras (contrato backend + guía Flutter)

## Semántica

| Campo      | Rol |
|------------|-----|
| **`sku`**  | Referencia **interna** de catálogo e inventario (legible, estable para reportes). |
| **`barcode`** | Código **escaneable** en el POS y búsqueda por lector; opcional. |

Son **independientes**: el mismo valor en ambos solo si el usuario lo decide.

---

## `POST /api/v1/products`

- **`sku`** — **opcional**.  
  - Si **no se envía**, viene **vacío** o solo espacios → el servidor asigna un SKU autogenerado: **`SKU-000001`**, **`SKU-000002`**, … (secuencia global, 6 dígitos).  
  - Si el cliente envía un SKU explícito, debe ser **único** (como hasta ahora).
- **`barcode`** — **opcional**.  
  - Si no se envía o va vacío tras `trim` → se guarda **`null`** (varios productos pueden no tener barcode).  
  - Si se informa, debe ser **único** en Postgres (`@unique` en columna nullable → varios `NULL`, un solo valor no nulo por código).

**Respuesta** del `POST` incluye el producto creado con el **`sku` final** (autogenerado o el enviado). El front debe **mostrar y persistir** ese `sku` si lo necesita offline.

---

## `PATCH /api/v1/products/:id`

- **`sku`**: si se envía, no puede quedar vacío (tras trim).
- **`barcode`**: string vacío o solo espacios → se guarda **`null`** (quita el barcode).

---

## Evolución futura (no implementado aún)

- Prefijos por categoría (ej. `ALIM-000123`) o secuencias por tienda, al estilo extensiones Odoo.
- Ajustar el contador `ProductSkuCounter` en migraciones/ops si importáis catálogos masivos y queréis evitar colisiones con `SKU-00000N`.

---

## Qué debe hacer la app (Flutter / POS)

1. **No copiar** el valor escaneado en **`barcode`** hacia **`sku`** de forma automática. Solo si el usuario **confirma** explícitamente (misma cadena en ambos).
2. Al **crear producto nuevo** tras escanear: enviar **`barcode`** con lo leído; **omitir `sku`** (o enviarlo vacío) para que el backend genere `SKU-000xxx`.
3. Tras el `POST`, usar el **`sku` devuelto** para listados internos, inventario impreso, etc.
4. Búsqueda por lector: priorizar **`barcode`**; búsqueda manual de referencia interna: **`sku`**.

---

## Mongo `products_read`

La proyección sigue el producto en Postgres; **`barcode`** puede ser `null`. Un índice **sparse** único en Mongo (si lo usáis) encaja con “único solo cuando viene informado”.

---

## Referencias en repo

- Implementación: `src/modules/products/products.service.ts`, DTOs `create-product.dto.ts` / `update-product.dto.ts`.
- Tabla secuencia: `ProductSkuCounter` (`id = 'global'`, `nextNumber`).
- Contexto general API: `docs/FRONTEND_INTEGRATION_CONTEXT.md`.
