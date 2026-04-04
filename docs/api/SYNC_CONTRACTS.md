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
          "documentCurrencyCode": "VES",
          "userId": "user-uuid",
          "deviceId": "device-123",
          "lines": [
            { "productId": "p-uuid", "quantity": "2", "price": "25.00", "discount": "0" }
          ],
          "fxSnapshot": {
            "baseCurrencyCode": "USD",
            "quoteCurrencyCode": "VES",
            "rateQuotePerBase": "36.50",
            "effectiveDate": "2026-04-04",
            "fxSource": "POS_OFFLINE"
          }
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

### Versiones: pull vs push (importante)

- **`/sync/pull`**: el `serverVersion` de cada op viene de la tabla **`ServerChangeLog`** (secuencia global monotona de cambios **originados en el servidor**, p. ej. catálogo).
- **`/sync/push`** `acked[].serverVersion`**: viene del contador **por tienda** `StoreSyncState` al aceptar una op del dispositivo.
- Son **dos contadores distintos** en la implementación actual: el POS debe llevar un `lastServerVersion` **solo para pull** (watermark del log del servidor), aparte de lo que use para interpretar acuses de push si lo necesita.

## Catalogo de `opType` (inicial)

### Ops que se empujan desde POS al servidor (push)

- `SALE` — **implementado**: en la misma transacción del batch crea `Sale` + líneas, aplica salidas de inventario (`OUT_SALE`, costo medio funcional) y persiste snapshot FX en cabecera/líneas. `sale.storeId` debe coincidir con `X-Store-Id`. El servidor inyecta `opId` de la op en el DTO interno para idempotencia de movimientos: cada línea usa `StockMovement.opId` en formato `{opIdSync}:{productId}`. Si `sale.id` ya existe en esa tienda, se devuelve la venta existente sin duplicar stock. Payload en `payload.sale` (también se acepta `fx` como alias de `fxSnapshot`):
  ```json
  {
    "sale": {
      "id": "<uuid opcional>",
      "storeId": "<uuid tienda>",
      "documentCurrencyCode": "VES",
      "userId": "<uuid opcional>",
      "deviceId": "<opcional; si falta en sync se usa deviceId del request>",
      "lines": [
        { "productId": "<uuid>", "quantity": "2", "price": "25.00", "discount": "0" }
      ],
      "fxSnapshot": {
        "baseCurrencyCode": "USD",
        "quoteCurrencyCode": "VES",
        "rateQuotePerBase": "36.50",
        "effectiveDate": "2026-04-04",
        "fxSource": "POS_OFFLINE"
      }
    }
  }
  ```
  FX: cualquier par presente en `ExchangeRate` de la tienda (orientación base/quote como en BD); el snapshot debe usar el **mismo par** que la fila servidor. Con `fxSource: "POS_OFFLINE"` se usa la tasa enviada; si no, tolerancia ±0,5% vs servidor.
- `SALE_RETURN` — **implementado**: crea `SaleReturn` + líneas referenciando `SaleLine` de la venta original. Por defecto **hereda** FX de la venta; con `fxPolicy: "SPOT_ON_RETURN"` aplica tasa del día al funcional comercial (opcional `fxSnapshot` / `fx`). `IN_RETURN` por línea; `StockMovement.opId` = `{opIdSync}:{saleLineId}`. Ver `docs/api/RETURNS_POLICY.md`. Payload mínimo:
  ```json
  {
    "saleReturn": {
      "id": "<uuid opcional>",
      "storeId": "<uuid tienda>",
      "originalSaleId": "<uuid venta>",
      "lines": [{ "saleLineId": "<uuid línea venta>", "quantity": "1" }],
      "fxPolicy": "INHERIT_ORIGINAL_SALE",
      "fxSnapshot": {
        "baseCurrencyCode": "USD",
        "quoteCurrencyCode": "VES",
        "rateQuotePerBase": "36.50",
        "effectiveDate": "2026-04-04",
        "fxSource": "POS_OFFLINE"
      }
    }
  }
  ```
  `fxPolicy` y `fxSnapshot` son opcionales; solo tienen efecto conjunto para `SPOT_ON_RETURN`.
- `PURCHASE_RECEIVE` — **implementado**: crea `Purchase` + líneas, entradas de inventario (`IN_PURCHASE`, costo medio funcional actualizado con el costo de la línea en funcional) y snapshot FX en cabecera/líneas. `purchase.storeId` debe coincidir con `X-Store-Id`. Idempotencia de movimientos: `StockMovement.opId` = `{opIdSync}:{productId}` por línea. Si `purchase.id` ya existe en la tienda, se devuelve la compra existente sin duplicar stock. Payload en `payload.purchase` (alias `fx` para `fxSnapshot`):
  ```json
  {
    "purchase": {
      "id": "<uuid opcional>",
      "storeId": "<uuid tienda>",
      "supplierId": "<uuid proveedor>",
      "documentCurrencyCode": "VES",
      "lines": [
        { "productId": "<uuid>", "quantity": "10", "unitCost": "5.00" }
      ],
      "fxSnapshot": {
        "baseCurrencyCode": "USD",
        "quoteCurrencyCode": "VES",
        "rateQuotePerBase": "36.50",
        "effectiveDate": "2026-04-04",
        "fxSource": "POS_OFFLINE"
      }
    }
  }
  ```
- `INVENTORY_ADJUST` — **implementado**: aplica ajuste en la misma transacción que el batch; `opId` de la op = `StockMovement.opId` (idempotente). Payload mínimo:
  ```json
  {
    "inventoryAdjust": {
      "productId": "<uuid>",
      "type": "IN_ADJUST",
      "quantity": "10",
      "unitCostFunctional": "2.50",
      "reason": "conteo"
    }
  }
  ```
  También se acepta el mismo objeto en la raíz del `payload` (sin `inventoryAdjust`). `type`: `IN_ADJUST` | `OUT_ADJUST`; `quantity` string decimal positivo.
- `NOOP` — **solo para pruebas de conectividad e idempotencia**: se registra como aplicada, incrementa `serverVersion`, no efecto de negocio
- (futuro) `TRANSFER_OUT`, `TRANSFER_IN`

### Ops que el servidor entrega a POS (pull)

- `PRODUCT_CREATED`
- `PRODUCT_UPDATED`
- `PRODUCT_DEACTIVATED`
- (futuro) `PRICE_LIST_UPDATED`, `TAX_UPDATED`

## Notas de implementacion (para cuando codifiquemos)

- Registrar cada op recibida en `SyncOperation` con `status` y `serverAppliedAt`.
- Generar `serverVersion` solo cuando la operacion se aplica efectivamente.
- Mantener operaciones de servidor para pull en una tabla/stream (ej: `server_change_log`) para no depender de reconstruccion por queries complejas.

