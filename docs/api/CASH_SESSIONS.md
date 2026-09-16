# Cash sessions — cierre de caja (B2)

Base: `/api/v1` · Header obligatorio: `X-Store-Id`

Plan: [`../POS_NEGATIVE_STOCK_BACKEND_IMPLEMENTATION.md`](../POS_NEGATIVE_STOCK_BACKEND_IMPLEMENTATION.md) · FE: [`../POS_NEGATIVE_STOCK_FRONTEND_IMPLEMENTATION.md`](../POS_NEGATIVE_STOCK_FRONTEND_IMPLEMENTATION.md)

## Endpoints

| Método | Ruta | Uso |
|--------|------|-----|
| `POST` | `/cash-sessions` | Abrir turno (idempotente: si ya hay OPEN del `deviceId`, la devuelve) |
| `GET` | `/cash-sessions/current?deviceId=` | Sesión OPEN del dispositivo |
| `GET` | `/cash-sessions/:id` | Detalle |
| `GET` | `/cash-sessions/:id/summary` | Resumen live (OPEN) o congelado (CLOSED) |
| `POST` | `/cash-sessions/:id/close` | Cerrar turno |

## Abrir

```http
POST /api/v1/cash-sessions
X-Store-Id: {store-uuid}
Content-Type: application/json

{
  "deviceId": "68a65e72-5e2a-4712-baa0-53281390d156",
  "openingCash": "100.00",
  "clientOpenedAt": "2026-08-29T12:00:00.000Z",
  "appVersion": "1.0.0"
}
```

Registra/actualiza el `POSDevice` si hace falta.

### Idempotencia y fondo (sesión OPEN existente)

Si ya hay `OPEN` para el mismo `storeId` + `deviceId`:

| `openingCash` en servidor | Body | Efecto |
|---------------------------|------|--------|
| `null` / `0` / `0.00` | `openingCash` ≥ 0 | **Actualiza** el fondo en esa misma sesión (claim de “zombie”) |
| ≠ 0 (ej. `50`) | cualquier `openingCash` | **No pisa**; devuelve la sesión tal cual |

No hay `PATCH`: todo va en este POST.

### `clientOpenedAt` (apertura offline)

Campo **opcional**, ISO-8601 UTC. Si viene:

- Al **crear** sesión → se usa como `openedAt` (en lugar de `now()` del servidor).
- Si hay OPEN “zombie” (fondo null/0) → también puede corregir `openedAt` en el claim.
- Si la OPEN ya tiene fondo ≠ 0 → **no** se reescribe `openedAt`.

Límites (400 si falla):

- Debe ser datetime válido.
- No futuro (margen ~2 min por reloj del POS).
- No más de **36 horas** atrás.

Así, si abren a las 08:00 sin red y sincronizan a las 12:00, el summary del turno sigue el rango desde las 08:00 (`[openedAt, now|closedAt]`).

### Body

| Campo | Obligatorio | Notas |
|-------|-------------|-------|
| `deviceId` | sí | Mismo id de sync/ventas |
| `openingCash` | no | Decimal ≥ 0 string |
| `clientOpenedAt` | no | ISO UTC; ver reglas arriba |
| `appVersion` | no | Info del POS |

## Summary (ejemplo)

```json
{
  "session": { "id": "...", "status": "OPEN", "deviceId": "...", "openedAt": "..." },
  "summary": {
    "openedAt": "...",
    "closedAt": null,
    "ticketsCount": 12,
    "salesTotalFunctional": "450.00",
    "returnsTotalFunctional": "10.00",
    "netSalesFunctional": "440.00",
    "stockConflictSalesCount": 1,
    "negativeSkuCount": 2,
    "syncFailedCount": 0,
    "pendingCountDeclared": 0
  },
  "warnings": [],
  "requireSuccessfulSyncAtClose": false
}
```

- Ventas/devoluciones del rango `[openedAt, now|closedAt]` filtradas por `deviceId` en ventas.
- `negativeSkuCount`: SKUs de la tienda con `quantity < 0` (valor real, p. ej. `-2`).
- `syncFailedCount`: ops `failed` del device en el rango.

## Cerrar

```http
POST /api/v1/cash-sessions/{id}/close
X-Store-Id: {store-uuid}
Content-Type: application/json

{
  "closeMode": "OFFLINE",
  "countedCash": "250.00",
  "pendingSales": [
    {
      "saleId": "uuid-ticket-local",
      "opId": "uuid-op",
      "total": "12.50",
      "createdAt": "2026-07-26T18:00:00.000Z"
    }
  ],
  "notes": "Cierre sin red"
}
```

| Campo | Notas |
|-------|--------|
| `closeMode` | `ONLINE` \| `OFFLINE` (obligatorio) |
| `pendingSales` | Declaración de cola local; **no** borra tickets del dispositivo |
| Warnings | Soft: `PENDING_SALES_DECLARED`, `CLOSED_OFFLINE`, `REQUIRE_SYNC_SOFT`, etc. **Nunca** bloquea el cierre |

## Flujo FE recomendado

1. Al iniciar turno (con o sin red) → guardar localmente `clientOpenedAt` = ahora UTC + fondo contado.
2. Al sincronizar apertura → `POST /cash-sessions` con `deviceId`, `openingCash`, `clientOpenedAt`.
3. Confirmar en la respuesta que `openingCash` y `openedAt` coinciden con lo enviado (claim zombie o sesión nueva).
4. Durante el día → sync continuo; opcional `GET .../summary`.
5. Al cerrar → push/pull si hay red → `POST .../close` con pendientes que queden.
6. Cola local sigue hasta ACK; el server solo guarda la declaración.

## Errores

| Código | Caso |
|--------|------|
| 404 | Sesión no existe / no hay OPEN en `current` |
| 409 | `close` sobre sesión ya `CLOSED` |
| 400 | `deviceId` vacío, montos inválidos |
