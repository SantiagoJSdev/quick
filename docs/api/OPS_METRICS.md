# GET `/api/v1/ops/metrics` (M5 — observabilidad)

No requiere **`X-Store-Id`**. Sirve para operaciones, reconciliación de inventario y depuración de la cola de sync (PostgreSQL).

## Autenticación

- Si el servidor define **`OPS_API_KEY`**, enviar **`X-Ops-Api-Key: <valor>`** o **`Authorization: Bearer <valor>`**.
- Opcional: **`OPS_IP_ALLOWLIST`** (IPs separadas por coma). Tras proxy inverso, **`TRUST_PROXY=1`** en el servidor para que la allowlist use `X-Forwarded-For` de forma fiable.
- Si no hay clave ni allowlist, el endpoint puede quedar abierto (solo recomendado en desarrollo).

## Query

| Parámetro  | Obligatorio | Descripción |
|------------|-------------|-------------|
| `storeId`  | No          | Si se envía (UUID), la sección **`inventoryReconciliation`** se limita a esa tienda. Sync es global. |

**Ejemplo:** `GET /api/v1/ops/metrics?storeId=<uuid>`

## Respuesta (forma general)

```json
{
  "serverTime": "2026-04-13T12:00:00.000Z",
  "inventoryReconciliation": { },
  "sync": { }
}
```

### `inventoryReconciliation`

Objeto devuelto por la reconciliación inventario vs movimientos (campos dependen de implementación; suele incluir `mismatchCount` y detalle por producto cuando hay desvíos).

### `sync`

Métricas de **`SyncOperation`** y **`StoreSyncState`**:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `byStatus` | objeto | Conteos por `status` de `SyncOperation` (p. ej. `pending`, `applied`, `failed`). |
| `pendingCount` | number | Ops aún en `pending` (casos raros / atascados). |
| `failedCount` | number | Ops registradas como **`failed`** (histórico; no se re-ejecutan solas). |
| `appliedCount` | number | Ops aplicadas correctamente. |
| `storeVersions` | array | `{ "storeId", "serverVersion" }` por tienda (`serverVersion` de acks `sync/push`). |
| **`failedSamples`** | array | Hasta **30** filas con `status = failed`, ordenadas por **`clientTimestamp` descendente**. Vacío si `failedCount === 0`. |

#### Elementos de `failedSamples`

Cada ítem permite **correlacionar con el POS** (mismo `opId` que el cliente reintenta):

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `opId` | string | UUID de la operación (idempotencia). |
| `storeId` | string | Tienda. |
| `deviceId` | string | Dispositivo POS. |
| `opType` | string | Ej. `SALE`, `PURCHASE_RECEIVE`, `SALE_RETURN`, … |
| `failureReason` | string \| null | Código corto (p. ej. `validation_error`). |
| **`failureDetails`** | string \| null | Mensaje concreto (equivalente a `failed[].details` en la respuesta de `sync/push`). Tras la migración de datos `sync_failure_details_legacy_placeholder`, las filas antiguas sin detalle guardado muestran un **texto orientativo** en lugar de `null`. |
| `clientTimestamp` | string | ISO 8601 del timestamp enviado por el cliente. |

**Nota operativa:** si una op quedó en `failed`, los reintentos con el **mismo `opId`** no vuelven a aplicar la lógica de negocio; el servidor responde error indicando que la operación ya fue rechazada. Hay que **corregir el payload** y usar un **`opId` nuevo**, o intervenir en base de datos solo en entornos controlados.

## Logs del scheduler

El job **`OpsSchedulerService`** (intervalo por defecto **120 s**, configurable con **`OPS_SCHEDULER_ENABLED`**, **`OPS_SCHEDULER_INTERVAL_MS`**) ejecuta reconciliación de inventario y lectura de métricas sync en background.

**Logs periódicos (WARN):** solo cuando **`NODE_ENV !== production`** (desarrollo). En producción el job sigue corriendo pero **no** escribe WARN cada intervalo por sync fallidas o inventario — consulta este endpoint bajo demanda o configura alarmas externas.
