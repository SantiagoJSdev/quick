# Sync API Contracts (POS Offline)

Objetivo: permitir operacion offline en POS y sincronizar sin duplicados.

Base: el POS genera operaciones con `opId` (UUID v4). El servidor aplica idempotente.

## Versionado del servidor (`serverVersion`)

- El servidor mantiene un contador monotono `serverVersion` (entero).
- Cada vez que el servidor aplica una operacion (o genera un cambio relevante para dispositivos), asigna un `serverVersion`.
- El dispositivo guarda su ultimo `serverVersion` aplicado localmente (`lastServerVersion`).
- `pull` solicita "todo lo nuevo desde X".

## POST `/api/v1/sync/push`

### Intento

Enviar al servidor un batch de operaciones locales del POS (oplog) para aplicar en PostgreSQL.

### Request (JSON)

```json
{
  "deviceId": "device-123",
  "clientTime": "2026-03-26T18:00:00Z",
  "lastServerVersion": 120,
  "ops": [
    {
      "opId": "9c1b39e8-2f4a-4c17-9a89-8b5e7cb4b9d7",
      "opType": "SALE",
      "timestamp": "2026-03-26T17:59:10Z",
      "payload": {
        "sale": {
          "id": "b3b40cb1-7132-4c86-85ab-7b8ab2c8dbfd",
          "storeId": "store-uuid",
          "userId": "user-uuid",
          "lines": [
            { "productId": "p-uuid", "quantity": "2", "price": "25.00" }
          ]
        }
      }
    }
  ]
}
```

### Reglas del request

- `deviceId` obligatorio.
- `ops` obligatorio; si llega vacio, el servidor responde `200` con arrays vacios.
- `opId` obligatorio por op y debe ser UUID v4.
- `timestamp` obligatorio por op (ISO-8601). Se usa para auditoria/orden aproximado; no debe ser la unica fuente de orden.
- `payload` debe ser JSON valido. Validacion depende de `opType`.

### Response 200 (JSON)

```json
{
  "serverTime": "2026-03-26T18:00:02Z",
  "acked": [
    { "opId": "9c1b39e8-2f4a-4c17-9a89-8b5e7cb4b9d7", "serverVersion": 121 }
  ],
  "skipped": [
    { "opId": "old-op-uuid", "reason": "already_applied" }
  ],
  "failed": [
    { "opId": "bad-op-uuid", "reason": "validation_error", "details": "..." }
  ]
}
```

### Reglas del response

- `acked`: ops aplicadas en el servidor con su `serverVersion`.
- `skipped`: ops reconocidas pero no reaplicadas (idempotencia).
- `failed`: ops que NO se aplicaron (validacion/regla negocio). El cliente debe marcarlas como `failed` y requerir accion.

### Idempotencia (critico)

- El servidor debe tener indice unico por `opId` (al menos en `SyncOperation.opId`).
- Si un `opId` se recibe dos veces:
  - NO se vuelve a aplicar la logica (no crear otra venta, no duplicar movimientos).
  - Se responde en `skipped` o `acked` (segun diseño), pero sin efectos secundarios.

### Limites recomendados (para evitar backlog infinito)

- `ops.length` max: 200 por request (ajustable).
- Tamaño max del body: 1-2MB.
- El cliente reintenta con backoff exponencial.

### Codigos de error (globales)

- `400`: request invalido (JSON mal formado, UUID invalido, etc).
- `401`: no autenticado.
- `403`: sin permisos / dispositivo no autorizado.
- `409`: conflicto (ej: venta ya existe con otro contenido).
- `429`: rate limit.
- `500`: error inesperado.

## GET `/api/v1/sync/pull?since=SERVER_VERSION`

### Intento

Traer del servidor los cambios ocurridos desde el ultimo `serverVersion` del dispositivo.

### Request (query)

- `since` (int) obligatorio, ejemplo: `since=120`
- Opcional: `limit` (int) default 500

### Response 200 (JSON)

```json
{
  "serverTime": "2026-03-26T18:00:10Z",
  "fromVersion": 120,
  "toVersion": 135,
  "ops": [
    {
      "serverVersion": 121,
      "opType": "PRODUCT_UPDATED",
      "timestamp": "2026-03-26T18:00:02Z",
      "payload": { "productId": "p-uuid", "fields": { "price": "30.00" } }
    }
  ],
  "hasMore": false
}
```

### Reglas de pull

- `ops` se ordena ascendente por `serverVersion`.
- El cliente aplica `ops` en ese orden y al final guarda `toVersion` como nuevo `lastServerVersion`.
- Si `hasMore=true`, el cliente hace otro pull con `since=toVersion`.

## Catalogo de `opType` (inicial)

### Ops que se empujan desde POS al servidor (push)

- `SALE` (persistencia en `SyncOperation` con `failed` / `not_implemented` hasta M4; no crea venta aún)
- `INVENTORY_ADJUST` (igual hasta M2)
- `NOOP` — **solo para pruebas de conectividad e idempotencia**: se registra como aplicada, incrementa `serverVersion`, no efecto de negocio
- (futuro) `PURCHASE_RECEIVE`, `TRANSFER_OUT`, `TRANSFER_IN`

### Ops que el servidor entrega a POS (pull)

- `PRODUCT_CREATED`
- `PRODUCT_UPDATED`
- `PRODUCT_DEACTIVATED`
- (futuro) `PRICE_LIST_UPDATED`, `TAX_UPDATED`

## Notas de implementacion (para cuando codifiquemos)

- Registrar cada op recibida en `SyncOperation` con `status` y `serverAppliedAt`.
- Generar `serverVersion` solo cuando la operacion se aplica efectivamente.
- Mantener operaciones de servidor para pull en una tabla/stream (ej: `server_change_log`) para no depender de reconstruccion por queries complejas.

