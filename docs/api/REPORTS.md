# Reportes / Dashboard operativo (API)

**Documento para el equipo Flutter (handoff):** [`../FRONTEND_DASHBOARD_API.md`](../FRONTEND_DASHBOARD_API.md) — incluye qué pantalla llama a qué endpoint y ejemplos completos de respuesta.

Base: `/api/v1`. Montos en **string** decimal. Moneda de KPIs: **moneda funcional** de la tienda (`BusinessSettings.functionalCurrency`).

## Reglas de negocio (v1)

| Regla | Valor |
|-------|--------|
| Ventas incluidas | `Sale.status = CONFIRMED` |
| Devoluciones incluidas | `SaleReturn.status = CONFIRMED` |
| Monto venta/devolución | `COALESCE(totalFunctional, total)` |
| Fecha | `createdAt` interpretado en `Store.timezone` (IANA; `UTC` si vacío) |
| Ventas netas | `grossSales - returns` |
| Ticket promedio | `netSales / tickets` (0 tickets → `"0"`) |
| Tasa devolución | `returns / grossSales` si `grossSales > 0`, sino `null` |
| Rango máximo | 31 días inclusive (igual que historial de ventas) |

## Headers

| Endpoint | Headers |
|----------|---------|
| `/reports/sales/*` | `X-Store-Id` (obligatorio) |
| `/pos-devices/:deviceId/dashboard-config` GET | `X-Store-Id` |
| `/pos-devices/:deviceId/dashboard-config` PATCH | `X-Store-Id` + `X-Dashboard-Admin-Pin` (o `X-Ops-Api-Key` si `OPS_API_KEY` está definido) |
| `/dashboard/device/:deviceId` | `X-Device-Token` (sin `X-Store-Id`) |

Variables de entorno: `DASHBOARD_ADMIN_PIN` (recomendado en producción para PATCH config).

## Query común (`SalesReportQuery`)

| Param | Descripción |
|-------|-------------|
| `preset` | `today`, `yesterday`, `week`, `month` (prioridad sobre fechas) |
| `dateFrom` | `YYYY-MM-DD` inicio inclusive |
| `dateTo` | `YYYY-MM-DD` fin inclusive |
| `deviceId` | Filtra ventas por `Sale.deviceId`; devoluciones de ventas de ese dispositivo |

Si no se envía `preset` ni fechas: últimos 7 días calendario (misma regla que `GET /sales`).

---

## `GET /reports/sales/summary`

**Ejemplo:** `GET /api/v1/reports/sales/summary?preset=today`

```json
{
  "storeId": "uuid",
  "currencyCode": "USD",
  "from": "2026-06-08",
  "to": "2026-06-08",
  "timezone": "America/Caracas",
  "rangeInterpretation": "...",
  "preset": "today",
  "grossSales": "1000.00",
  "returns": "120.00",
  "netSales": "880.00",
  "tickets": 84,
  "avgTicket": "10.476190476190476190476190476",
  "returnRate": "0.12"
}
```

---

## `GET /reports/sales/timeseries`

**Query:** mismos + implícito `groupBy=day`.

```json
{
  "meta": {
    "timezone": "America/Caracas",
    "from": "2026-06-01",
    "to": "2026-06-07",
    "groupBy": "day"
  },
  "points": [
    {
      "bucket": "2026-06-04",
      "grossSales": "250.00",
      "returns": "10.00",
      "netSales": "240.00",
      "tickets": 18
    }
  ]
}
```

---

## `GET /reports/sales/payments`

Desglose por `SalePayment.method` convertido a moneda funcional (FX de la venta).

```json
{
  "storeId": "uuid",
  "currencyCode": "USD",
  "from": "2026-06-01",
  "to": "2026-06-07",
  "items": [
    { "method": "USD_CASH", "amount": "120.00" },
    { "method": "VES_CASH", "amount": "80.00" }
  ]
}
```

---

## `GET /reports/sales/by-device`

```json
{
  "storeId": "uuid",
  "currencyCode": "USD",
  "from": "2026-06-01",
  "to": "2026-06-07",
  "items": [
    {
      "deviceId": "install-uuid",
      "grossSales": "500.00",
      "returns": "20.00",
      "netSales": "480.00",
      "tickets": 40
    }
  ]
}
```

`deviceId: null` agrupa ventas sin dispositivo registrado.

---

## `GET /dashboard/device/:deviceId`

Pantalla kiosk. **Query:** `preset` (default efectivo `today`).

```http
GET /api/v1/dashboard/device/my-install-uuid?preset=today
X-Device-Token: <token from PATCH dashboard-config>
```

```json
{
  "device": {
    "id": "uuid-row",
    "deviceId": "my-install-uuid",
    "storeId": "store-uuid",
    "dashboardEnabled": true,
    "deviceMode": "DASHBOARD",
    "dashboardView": "SALES_SUMMARY"
  },
  "filters": { "preset": "today", "storeId": "...", "from": "...", "to": "...", "timezone": "..." },
  "summary": {
    "grossSales": "250.00",
    "returns": "10.00",
    "netSales": "240.00",
    "tickets": 18,
    "avgTicket": "13.33",
    "currencyCode": "USD"
  },
  "payments": [{ "method": "USD_CASH", "amount": "120.00" }],
  "series": [{ "bucket": "2026-06-08", "netSales": "240.00", "grossSales": "250.00", "returns": "10.00", "tickets": 18 }]
}
```

Errores: `401` token inválido; `403` dashboard deshabilitado o modo no permitido.

---

## `GET|PATCH /pos-devices/:deviceId/dashboard-config`

`:deviceId` = identificador de instalación (`POSDevice.deviceId`), no el UUID de fila.

**PATCH body:**

```json
{
  "dashboardEnabled": true,
  "deviceMode": "DASHBOARD",
  "dashboardView": "SALES_SUMMARY",
  "regenerateToken": true
}
```

Si se genera token, la respuesta incluye **una sola vez**:

```json
{
  "dashboardAccessToken": "64-char-hex",
  "hasDashboardToken": true,
  ...
}
```

---

## SQL manual (pgAdmin)

Ventas y devoluciones del día (reemplazar store y fechas UTC según timezone):

Ver `docs/DATABASE_SCHEMA_GUIDE.md` y queries de ejemplo en conversación de devoluciones.
