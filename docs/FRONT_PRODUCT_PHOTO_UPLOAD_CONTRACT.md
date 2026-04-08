# Contrato final - Upload de foto de producto (Backend -> Front)

Este documento es para integración directa en frontend (copy/paste).

## Base

- Base path API: `/api/v1`
- Header requerido: `X-Store-Id: <uuid>`
- Auth adicional: **no** (solo lo actual del proyecto: `X-Store-Id`)

## 1) Endpoint de upload

- **Método/Ruta:** `POST /api/v1/uploads/products-image`
- **Tipo request:** `multipart/form-data`
- **Nombre del campo archivo:** `file`
- **Límite actual:** 5MB
- **Tipos permitidos:** `image/*` (ej. jpg, png, webp, gif)

### Ejemplo request (multipart)

- Header:
  - `X-Store-Id: <uuid>`
- Body form-data:
  - `file: <binary image>`

### Respuesta esperada (200)

```json
{
  "fileId": "1712570000000-ab12cd34.jpg",
  "url": "/api/v1/uploads/products-image/550e8400-e29b-41d4-a716-446655440001/1712570000000-ab12cd34.jpg",
  "mimeType": "image/jpeg",
  "bytes": 183422
}
```

## 2) Endpoint para asociar foto al producto

- **Método/Ruta:** `PATCH /api/v1/products/:id/image`
- **Headers:** `X-Store-Id`, `Content-Type: application/json`
- **Payload exacto:**

```json
{
  "imageUrl": "/api/v1/uploads/products-image/<storeId>/<fileId>"
}
```

- `:id` = `productId`.
- Respuesta: objeto producto actualizado (mismo shape de `PATCH /products/:id`).

## 3) Endpoint para eliminar/desasociar foto

- **Método/Ruta:** `DELETE /api/v1/products/:id/image`
- **Headers:** `X-Store-Id`
- **Body:** no requiere.
- Efecto: `image` queda en `null` en el producto.
- Respuesta: objeto producto actualizado.

## 4) Endpoint para visualizar/consumir la imagen

- **Método/Ruta:** `GET /api/v1/uploads/products-image/:storeId/:fileName`
- Uso: render en card/listado/detalle usando el `imageUrl` guardado.

## 5) Reglas de manejo en cola (frontend)

Estado sugerido por item de cola:

- `retryable`
  - timeout/red/5xx en upload o asociación.
- `manual`
  - 400 (payload inválido, archivo inválido, >5MB),
  - 404 de producto al asociar,
  - 409 si llega a aplicar por flujo de negocio.
- `success`
  - upload 200 + patch asociación 200.

## 6) Flujo exacto recomendado

1. Subir archivo (cola background):
   - `POST /uploads/products-image` multipart (`file`).
2. Tomar `url` de respuesta.
3. Asociar al producto:
   - `PATCH /products/:id/image` con `{ imageUrl: "<url>" }`.
4. Marcar cola:
   - `success` si ambos pasos 200,
   - `retryable` o `manual` según reglas arriba.

