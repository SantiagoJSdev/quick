# Sync push — proveedores (`SUPPLIER_*`) y compras con id provisional

Referencia de contrato **alineada al backend actual**. Base URL: **`/api/v1`**. Header obligatorio en sync: **`X-Store-Id: <uuid tienda>`** + autenticación que use el proyecto (p. ej. JWT).

---

## 1. `POST /api/v1/sync/push`

### 1.1 Request (body JSON)

```json
{
  "deviceId": "string-no-vacio",
  "appVersion": "opcional-hasta-80-chars",
  "clientTime": "2026-04-14T12:00:00.000Z",
  "lastServerVersion": 0,
  "ops": [
    {
      "opId": "9c1b39e8-2f4a-4c17-9a89-8b5e7cb4b9d7",
      "opType": "SUPPLIER_CREATE",
      "timestamp": "2026-04-14T12:00:00.000Z",
      "payload": {}
    }
  ]
}
```

| Campo | Tipo | Obligatorio | Reglas |
|-------|------|-------------|--------|
| `deviceId` | string | Sí | No vacío. |
| `appVersion` | string | No | Máx. 80 caracteres. |
| `clientTime` | string ISO-8601 | No | `IsDateString`. |
| `lastServerVersion` | number | No | Entero; última versión vista por el dispositivo (informativo). |
| `ops` | array | Sí | **1–200** elementos. |

Cada elemento de `ops`:

| Campo | Tipo | Obligatorio | Reglas |
|-------|------|-------------|--------|
| `opId` | string | Sí | **UUID v4** (validación estricta). |
| `opType` | string | Sí | Uno de: `SALE`, `SALE_RETURN`, `PURCHASE_RECEIVE`, `INVENTORY_ADJUST`, `SUPPLIER_CREATE`, `SUPPLIER_UPDATE`, `SUPPLIER_DEACTIVATE`, `NOOP`. |
| `timestamp` | string | Sí | ISO-8601 (`IsDateString`). **No reordena** el batch: el orden de aplicación es el **orden del array `ops`**. |
| `payload` | object | Sí | Objeto JSON; forma según `opType`. |

Si el body incumple lo anterior (p. ej. `ops.length > 200`, `opId` no UUID v4, `opType` ilegal), el framework responde **400** con el formato de error estándar del API.

---

## 2. Payloads por `opType` (solo proveedores)

En los tres casos el servidor espera **`payload.supplier`** como **objeto**. Propiedades extra en `payload` fuera de `supplier` se ignoran para la validación de proveedor (no rompen si `payload` es solo `{ "supplier": { ... } }`).

### 2.1 `SUPPLIER_CREATE`

**Objeto `payload.supplier`:**

| Campo | Tipo | Obligatorio | Reglas |
|-------|------|-------------|--------|
| `clientSupplierId` | string | Sí | UUID v4. Id provisional del cliente hasta recibir id servidor en `acked`. |
| `name` | string | Sí | Tras `trim`, longitud **1–200**. |
| `phone` | string | No | Tras `trim`, si no vacío: máx. **80**. |
| `email` | string | No | Si se envía y tras `trim` no está vacío: email válido, máx. **200**. |
| `address` | string | No | Tras `trim`, si no vacío: máx. **500**. |
| `taxId` | string | No | Tras `trim`, si no vacío: máx. **80** (RIF/CUIT/NIT). |
| `notes` | string | No | Tras `trim`, si no vacío: máx. **2000**. |

**Ejemplo mínimo:**

```json
{
  "opId": "11111111-1111-4111-8111-111111111111",
  "opType": "SUPPLIER_CREATE",
  "timestamp": "2026-04-14T12:00:00.000Z",
  "payload": {
    "supplier": {
      "clientSupplierId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "name": "Distribuidora Norte"
    }
  }
}
```

**Ejemplo completo (opcionales):**

```json
{
  "opId": "22222222-2222-4222-8222-222222222222",
  "opType": "SUPPLIER_CREATE",
  "timestamp": "2026-04-14T12:00:01.000Z",
  "payload": {
    "supplier": {
      "clientSupplierId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "name": "Acme CA",
      "phone": "+58 412-0000000",
      "email": "pedidos@ejemplo.com",
      "address": "Av. Principal 123",
      "taxId": "J-00000000-0",
      "notes": "Pago quincenal"
    }
  }
}
```

**Regla de batch:** no puede haber **dos** `SUPPLIER_CREATE` en el mismo `ops` con el mismo `clientSupplierId`. Si ocurre, la segunda operación va a **`failed`** con `reason: "validation_error"`.

---

### 2.2 `SUPPLIER_UPDATE`

Equivalente semántico a **`PATCH /api/v1/suppliers/:id`** (campos parciales).

**Objeto `payload.supplier`:**

| Campo | Tipo | Obligatorio | Reglas |
|-------|------|-------------|--------|
| `supplierId` | string | Sí | UUID v4. Puede ser id **servidor** o el **`clientSupplierId`** de un create **ya aplicado antes en el mismo `ops`** (ver §4). |
| `name` | string | No* | Tras `trim`, longitud **1–200**. |
| `phone` | string | No* | Tras `trim`; vacío → se persiste como null en servidor. |
| `email` | string \| null | No* | `null` o string; string vacío tras trim → limpiar email; si no vacío: válido y ≤200. |
| `address` | string | No* | Igual criterio que `phone` para vacío. |
| `taxId` | string | No* | Igual. |
| `notes` | string | No* | Igual. |
| `active` | boolean | No* | Reactivar / desactivar soft. |

\* **Al menos uno** de `name`, `phone`, `email`, `address`, `taxId`, `notes`, `active` debe ir presente (si no, `validation_error`).

**Ejemplo:**

```json
{
  "opId": "33333333-3333-4333-8333-333333333333",
  "opType": "SUPPLIER_UPDATE",
  "timestamp": "2026-04-14T12:00:02.000Z",
  "payload": {
    "supplier": {
      "supplierId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "name": "Acme CA Actualizado",
      "active": true
    }
  }
}
```

---

### 2.3 `SUPPLIER_DEACTIVATE`

Equivalente semántico a **`DELETE /api/v1/suppliers/:id`** (soft: `active = false`).

**Objeto `payload.supplier`:**

| Campo | Tipo | Obligatorio | Reglas |
|-------|------|-------------|--------|
| `supplierId` | string | Sí | UUID v4; misma resolución provisional que en §4 si aplica. |

**Ejemplo:**

```json
{
  "opId": "44444444-4444-4444-8444-444444444444",
  "opType": "SUPPLIER_DEACTIVATE",
  "timestamp": "2026-04-14T12:00:03.000Z",
  "payload": {
    "supplier": {
      "supplierId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    }
  }
}
```

---

## 3. Respuesta `POST /sync/push` (200 OK)

Cuerpo JSON típico:

```json
{
  "serverTime": "2026-04-14T12:00:05.123Z",
  "acked": [],
  "skipped": [],
  "failed": []
}
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `serverTime` | string ISO-8601 | Hora del servidor al cerrar la respuesta. |
| `acked` | array | Operaciones aplicadas en esta petición. |
| `skipped` | array | Operaciones no re-ejecutadas (idempotencia). |
| `failed` | array | Operaciones rechazadas; el batch puede ser **parcialmente** aplicado (las ops anteriores en `ops` ya confirmadas en la misma transacción no se “deshacen” salvo error que aborte todo el request). |

### 3.1 Elemento `acked[]`

```json
{
  "opId": "11111111-1111-4111-8111-111111111111",
  "serverVersion": 42
}
```

Para **`SUPPLIER_CREATE`**, **`SUPPLIER_UPDATE`** y **`SUPPLIER_DEACTIVATE`**, se añade **`supplier`** (objeto):

```json
{
  "opId": "11111111-1111-4111-8111-111111111111",
  "serverVersion": 42,
  "supplier": {
    "clientSupplierId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "supplierId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  }
}
```

| Campo en `supplier` | Presente en | Descripción |
|---------------------|-------------|-------------|
| `supplierId` | CREATE, UPDATE, DEACTIVATE | Id **definitivo** en base de datos (siempre). |
| `clientSupplierId` | Solo **CREATE** | Eco del provisional enviado en `payload.supplier.clientSupplierId`. |

**Ejemplo ack solo UPDATE / DEACTIVATE:**

```json
{
  "opId": "33333333-3333-4333-8333-333333333333",
  "serverVersion": 43,
  "supplier": {
    "supplierId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  }
}
```

**Nota:** `serverVersion` en `acked` es el contador **por tienda** (`StoreSyncState`), distinto del `serverVersion` global de `GET /sync/pull`.

---

### 3.2 Elemento `skipped[]`

```json
{
  "opId": "11111111-1111-4111-8111-111111111111",
  "reason": "already_applied"
}
```

| `reason` | Significado |
|----------|-------------|
| `already_applied` | Misma `opId` ya existía con **mismo** `payload` y estado aplicado. No se duplica la mutación. El cliente debe confiar en su estado local / primer ack (el servidor **no** repite el objeto `supplier` en `skipped`; si hace falta, reconciliar con `GET /suppliers` o pull). |

---

### 3.3 Elemento `failed[]`

```json
{
  "opId": "55555555-5555-4555-8555-555555555555",
  "reason": "validation_error",
  "details": "Supplier not found"
}
```

| `reason` | Cuándo | Acción cliente típica |
|----------|--------|------------------------|
| `validation_error` | Payload inválido, negocio (p. ej. proveedor no encontrado, proveedor inactivo en compra), etc. | Corregir datos; si la op quedó persistida como **failed** en servidor, usar **nueva `opId`**. |
| `payload_mismatch` | Misma `opId` que una op ya guardada pero **distinto** `payload`. | Conflicto / replay: nueva `opId` o alinear payload al original. |
| `pending_or_stuck` | Estado anómalo en `SyncOperation`. | Soporte. |
| `unknown_op_type` | `opType` no implementado (no debería ocurrir si el DTO solo permite tipos conocidos). | Actualizar cliente. |

`details` es texto humano (también truncado en persistencia interna con límite alto); conviene loguearlo en el POS.

---

## 4. `PURCHASE_RECEIVE` y `supplierId` provisional (mismo batch)

Dentro del **mismo** array `ops`, si antes aparece un `SUPPLIER_CREATE` que registra `clientSupplierId = X` y obtiene `supplierId = S` en servidor, entonces una operación posterior **`PURCHASE_RECEIVE`** puede enviar:

```json
"purchase": {
  "storeId": "<misma tienda que X-Store-Id>",
  "supplierId": "X",
  "lines": [ ... ]
}
```

El servidor **reemplaza** `purchase.supplierId` por `S` antes de ejecutar la misma lógica que `POST /purchases`.

**Ejemplo de batch (orden relevante):**

```json
{
  "deviceId": "pos-001",
  "ops": [
    {
      "opId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "opType": "SUPPLIER_CREATE",
      "timestamp": "2026-04-14T12:00:00.000Z",
      "payload": {
        "supplier": {
          "clientSupplierId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "name": "Proveedor offline"
        }
      }
    },
    {
      "opId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "opType": "PURCHASE_RECEIVE",
      "timestamp": "2026-04-14T12:00:01.000Z",
      "payload": {
        "purchase": {
          "storeId": "10000000-0000-4000-8000-000000000001",
          "supplierId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "lines": [
            {
              "productId": "20000000-0000-4000-8000-000000000002",
              "quantity": "10",
              "unitCost": "5.00"
            }
          ]
        }
      }
    }
  ]
}
```

**Entre dos peticiones `sync/push` distintas:** el mapa provisional **no** se conserva. El cliente debe:

1. Enviar primero el batch (o la op) que confirma el `SUPPLIER_CREATE`, leer `acked[].supplier.supplierId`, y  
2. Reescribir colas locales (`PURCHASE_RECEIVE`, etc.) con ese **UUID servidor**, **o** incluir de nuevo el create en el mismo batch que la compra.

---

## 5. Idempotencia y errores HTTP globales

- **Misma `opId` + mismo `payload`:** la op se trata como repetición → entrada en **`skipped`** (`already_applied`), no en `failed`.
- **Misma `opId` + `payload` distinto:** **`failed`** con `reason: "payload_mismatch"` (HTTP sigue siendo 200 en respuestas batch normales).
- **`opId` ya usada en otra tienda:** el servidor lanza **409 Conflict** en la **transacción completa** del push (no es un ítem de `failed[]`); mensaje tipo: `opId … is already used in another store`.

Coherencia con REST: validaciones de proveedor y compra (proveedor de la tienda, activo para recibir compra, etc.) son las mismas que en `POST /suppliers`, `PATCH /suppliers/:id`, `DELETE /suppliers/:id` y `POST /purchases`.

---

## 6. `GET /api/v1/sync/pull` — eventos de proveedor

Tras `SUPPLIER_CREATE` / `UPDATE` / `DEACTIVATE` aplicados en push, el servidor agrega filas a **`ServerChangeLog`** visibles en pull.

**`opType` en pull (pasado, catálogo):**

| Valor | Origen |
|-------|--------|
| `SUPPLIER_CREATED` | Alta vía sync (y mismo registro de negocio que alta servidor). |
| `SUPPLIER_UPDATED` | PATCH vía sync. |
| `SUPPLIER_DEACTIVATED` | Baja soft vía sync. |

**Alcance:** `storeScopeId` = `storeId` de la tienda. El filtro de pull ya incluye eventos globales (`storeScopeId: null`) **y** los de esa tienda.

**Forma de `payload` en cada op de pull:**

```json
{
  "supplierId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "fields": {
    "storeId": "10000000-0000-4000-8000-000000000001",
    "name": "Distribuidora Norte",
    "taxId": "J-00000000-0",
    "email": "pedidos@ejemplo.com",
    "phone": "+58 412-0000000",
    "address": "Av. Principal 123",
    "notes": null,
    "active": true,
    "createdAt": "2026-04-14T12:00:00.000Z",
    "updatedAt": "2026-04-14T12:00:00.000Z"
  }
}
```

**Respuesta pull (recorte):**

```json
{
  "serverTime": "2026-04-14T12:05:00.000Z",
  "fromVersion": 100,
  "toVersion": 101,
  "ops": [
    {
      "serverVersion": 101,
      "opType": "SUPPLIER_CREATED",
      "timestamp": "2026-04-14T12:00:00.000Z",
      "payload": {
        "supplierId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "fields": {
          "storeId": "10000000-0000-4000-8000-000000000001",
          "name": "Distribuidora Norte",
          "taxId": "J-00000000-0",
          "email": "pedidos@ejemplo.com",
          "phone": "+58 412-0000000",
          "address": "Av. Principal 123",
          "notes": null,
          "active": true,
          "createdAt": "2026-04-14T12:00:00.000Z",
          "updatedAt": "2026-04-14T12:00:00.000Z"
        }
      }
    }
  ],
  "hasMore": false
}
```

**Recomendación cliente:** al procesar estos `opType`, actualizar caché local de proveedores; opcionalmente refrescar con **`GET /api/v1/suppliers`** para pantallas que dependan de listados completos.

---

## 7. REST paralelo (misma tienda)

| Acción | Método y ruta |
|--------|----------------|
| Listar | `GET /api/v1/suppliers` |
| Crear | `POST /api/v1/suppliers` |
| Actualizar | `PATCH /api/v1/suppliers/:id` |
| Baja soft | `DELETE /api/v1/suppliers/:id` |

Los campos y límites de strings deben coincidir con los descritos en §2 para sync.

---

*Documento generado para integración cliente–servidor; el comportamiento normativo es el código en `sync.service.ts`, `supplier-sync-payload.ts` y `suppliers.service.ts`.*
