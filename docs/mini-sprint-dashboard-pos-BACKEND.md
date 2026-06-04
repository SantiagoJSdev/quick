# Mini Sprint Dashboard POS — Implementación Backend

> **Origen:** `docs/mini-sprint-dashboard-pos.md`  
> **Compañero:** `docs/mini-sprint-dashboard-pos-FRONTEND.md`  
> **Inicio recomendado:** este documento (backend primero).

---

## 1. Análisis profundo (validado contra el repo)

### 1.1 Lo que el sprint propone y es correcto

| Propuesta | Validación en código actual |
|-----------|----------------------------|
| KPIs de ventas / devoluciones / neto | `Sale` y `SaleReturn` existen con `total`, `totalDocument`, `totalFunctional`. |
| Filtro por tienda | `StoreConfiguredGuard` + `X-Store-Id` en casi toda la API. |
| Filtro por dispositivo | `Sale.deviceId` y `SaleReturn` vía venta; coincide con `POSDevice.deviceId` (string estable, no UUID de fila). |
| Pagos por método | `SalePayment` con `method`, `currencyCode`, `amount`, `amountDocumentCurrency`. |
| Separar OLTP vs lectura agregada | Alineado con `docs/DATABASE_SCHEMA_GUIDE.md`. |
| Modo kiosk por dispositivo | `POSDevice` existe; hoy solo `touchOrRegister` en sync/ventas, sin API pública de configuración. |

### 1.2 Hallazgos críticos (ajustar antes de codificar)

#### A) Estados de venta y devolución — ya definidos en código

Hoy **solo se crean** documentos en estado final:

- `Sale.status = 'CONFIRMED'` (`sales.service.ts`)
- `SaleReturn.status = 'CONFIRMED'` (`sale-returns.service.ts`)

**Decisión v1:** filtrar reportes con `status = 'CONFIRMED'`. No usar `COMPLETED` (no existe en el backend actual). Si en el futuro aparecen `VOIDED` / `DRAFT`, quedarán excluidos automáticamente.

#### B) Monto oficial del dashboard = moneda funcional

Usar en agregaciones:

```sql
COALESCE("totalFunctional", "total")::text
```

Ventas y devoluciones ya persisten `totalFunctional` al confirmar. Evita mezclar `total` (moneda documento) con KPIs “en funcional”.

`currencyCode` en respuestas: leer de `BusinessSettings.functionalCurrency` (mismo patrón que ventas).

#### C) Pagos en moneda funcional — hueco del modelo actual

`SalePayment` **no tiene** `amountFunctional`. Solo:

- `amount` → monto en `currencyCode` del pago
- `amountDocumentCurrency` → normalizado a moneda **documento** de la venta

Para “total cobrado por método en funcional” hay que **convertir en servicio** (reutilizar `convertAmountDocumentToFunctional` de `src/common/fx/`) uniendo cada pago con el FX snapshot de su `Sale`, o:

- **Mejora v1.1 (recomendada):** migración `SalePayment.amountFunctional` + persistir al crear venta (menos CPU en kiosk con refresh cada 30s).

**Decisión v1 pragmática:** agregación en `ReportsService` en TypeScript (batch por rango, no N+1 por venta). Postergar `vw_dashboard_payments_daily` hasta tener columna funcional o función SQL de conversión auditada.

#### D) Fechas — reutilizar lógica existente

`resolveSaleListUtcRange` (`sales-list-range.ts`) ya resuelve:

- calendario en `Store.timezone` (IANA, fallback UTC)
- tope de **31 días** inclusive
- defaults de rango

**No duplicar** lógica de presets en el módulo reports: extraer a `src/common/dates/` o importar desde sales y exponer presets (`today`, `yesterday`, `week`, `month`, `custom`).

#### E) `GET /sales` historial no filtra por status

`listHistory` filtra por fechas/dispositivo pero **no** por `status`. Los reportes **sí** deben filtrar `CONFIRMED` explícitamente (defensivo si luego hay otros estados).

#### F) Seguridad kiosk vs `X-Store-Id`

El guard global exige `X-Store-Id`. Para pantalla dedicada:

- **Opción recomendada:** `GET /api/v1/dashboard/device/:deviceId` con `@SkipStoreConfigured()`, validar `X-Device-Token`, resolver `storeId` desde `POSDevice`.
- El front kiosk guarda `deviceId` + token; opcionalmente también `storeId` para otras rutas.

`PATCH dashboard-config` **no** debe ser público: proteger con `CONFIG_ADMIN_PIN` (mismo concepto que front) o `OPS_API_KEY` hasta auth real.

#### G) Vistas SQL en v1 — cuándo sí / cuándo no

| Escenario | Recomendación |
|-----------|----------------|
| Volumen bajo, uso ocasional | Agregación Prisma/`$queryRaw` directa sobre `Sale` / `SaleReturn` con índices. |
| TV kiosk refrescando cada 30s | Vista materializada o caché en memoria (TTL 30–60s) por `storeId` + preset. |

**v1 backend:** implementar agregación en servicio + índices; dejar scripts SQL de vistas en repo como **opcional** (Historia 3 bis), activar materialized view solo si perf confirma lentitud.

Índices sugeridos (migración si no existen):

```sql
CREATE INDEX IF NOT EXISTS "Sale_storeId_status_createdAt_idx"
  ON "Sale" ("storeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SaleReturn_storeId_status_createdAt_idx"
  ON "SaleReturn" ("storeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SalePayment_saleId_method_idx"
  ON "SalePayment" ("saleId", "method");
```

#### H) Naming de rutas

- Módulo Nest: **`reports`** (dominio claro).
- Ruta kiosk: **`dashboard`** (producto).
- Evitar mezclar ambos en un solo controller sin sub-rutas.

---

## 2. Mejoras recomendadas (prioridad)

### P0 — Bloqueantes de calidad

1. Documento **`docs/api/REPORTS.md`** con fórmulas, estados, presets y ejemplos JSON.
2. Filtro `status = 'CONFIRMED'` en todas las queries de reportes.
3. `avgTicket = netSales / tickets` con `tickets > 0`, sino `"0.00"`.
4. Montos en respuesta como **string** decimal (convención del proyecto).
5. Token de dashboard: generar con `crypto.randomBytes(32).toString('hex')`, guardar hash (bcrypt o SHA-256) — no persistir token en claro si se puede evitar.

### P1 — Alto valor, bajo riesgo

6. Reutilizar `resolveSaleListUtcRange` + meta `timezone`, `dateFrom`, `dateTo` en respuestas.
7. Query param `preset=today|yesterday|week|month` además de `from`/`to`.
8. Endpoint consolidado kiosk (una sola llamada).
9. Tests de integración: 2 ventas + 1 devolución → summary coherente.

### P2 — Post v1

10. `SalePayment.amountFunctional` + backfill.
11. Materialized views + job refresh.
12. `businessDate` explícito en `Sale` (cierres post-medianoche).
13. Enum Prisma para `Sale.status` / `SaleReturn.status`.
14. Rate limit en `/dashboard/device/*`.

---

## 3. Decisiones cerradas para v1 (spec técnica)

| Tema | Decisión |
|------|----------|
| Estados incluidos | Solo `CONFIRMED` |
| Campo monetario ventas/devoluciones | `COALESCE(totalFunctional, total)` |
| Campo fecha | `Sale.createdAt` / `SaleReturn.createdAt` en TZ de tienda |
| Ticket promedio | `netSales / tickets` (neto, no bruto) |
| Tasa de devolución (opcional en API) | `returns / grossSales` si `grossSales > 0` |
| Rango máximo | 31 días (misma regla que historial de ventas) |
| `deviceId` en query | Filtra `Sale.deviceId` / devoluciones de ventas de ese dispositivo |
| Pagos por método | Agrupar por `method`; monto en funcional vía conversión en servicio |

---

## 4. Cambios de esquema (Prisma)

### 4.1 Extender `POSDevice`

```prisma
enum PosDeviceMode {
  POS
  DASHBOARD
  HYBRID
}

enum DashboardView {
  SALES_SUMMARY
}

model POSDevice {
  // ... campos existentes
  dashboardEnabled      Boolean        @default(false)
  deviceMode            PosDeviceMode  @default(POS)
  dashboardView         DashboardView  @default(SALES_SUMMARY)
  dashboardAccessTokenHash String?     // hash, no token plano
  lastHeartbeatAt       DateTime?
}
```

**Defaults:** dispositivos existentes → `deviceMode = POS`, `dashboardEnabled = false`.

**Generación de token:** al activar dashboard, API devuelve token **una sola vez** en PATCH; en DB solo hash.

### 4.2 (Opcional v1.1) `SalePayment.amountFunctional`

Solo si el agregado de pagos en TS resulta lento en pruebas de carga.

---

## 5. Arquitectura del módulo

```text
src/modules/reports/
  reports.module.ts
  reports.controller.ts          # /api/v1/reports/sales/*
  dashboard-device.controller.ts # /api/v1/dashboard/device/:deviceId
  reports.service.ts
  reports-payments.service.ts    # conversión FX pagos
  dto/
    sales-report-query.dto.ts
    sales-summary-response.dto.ts
    ...
src/modules/pos-device/
  pos-device.controller.ts       # GET/PATCH dashboard-config (nuevo)
  pos-device-dashboard.service.ts
```

Registrar `ReportsModule` en `app.module.ts`.

### 5.1 Guards

| Ruta | Guard |
|------|--------|
| `/reports/sales/*` | `StoreConfiguredGuard` (normal) |
| `/pos-devices/:deviceId/dashboard-config` | `StoreConfiguredGuard` + validación admin (PIN header o API key) |
| `/dashboard/device/:deviceId` | `@SkipStoreConfigured()` + `DeviceDashboardGuard` (token + enabled) |

---

## 6. Contratos API (implementación)

Base: `/api/v1`. Header estándar: `X-Store-Id` (excepto kiosk).

### 6.1 `GET /reports/sales/summary`

**Query:** `dateFrom`, `dateTo`, `preset?`, `deviceId?`  
(`storeId` implícito desde `req.storeContext`)

**Response:**

```json
{
  "storeId": "uuid",
  "currencyCode": "USD",
  "from": "2026-06-01",
  "to": "2026-06-07",
  "timezone": "America/Caracas",
  "grossSales": "1000.00",
  "returns": "120.00",
  "netSales": "880.00",
  "tickets": 84,
  "avgTicket": "10.48",
  "returnRate": "0.12"
}
```

### 6.2 `GET /reports/sales/timeseries`

**Query:** igual + `groupBy=day` (único valor v1)

**Response:**

```json
{
  "meta": { "timezone": "America/Caracas", "from": "...", "to": "..." },
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

Implementación: dos agregaciones (ventas por día, devoluciones por día) y merge por `bucket` en servicio.

### 6.3 `GET /reports/sales/payments`

**Response:**

```json
{
  "currencyCode": "USD",
  "items": [
    { "method": "USD_CASH", "amount": "120.00" },
    { "method": "VES_CASH", "amount": "80.00" }
  ]
}
```

Algoritmo pagos (v1):

1. Ventas `CONFIRMED` en rango con `SalePayment`.
2. Por cada pago, convertir `amountDocumentCurrency` (o `amount` si moneda pago = funcional) a funcional usando FX de la venta.
3. Sumar por `method`.

### 6.4 `GET /reports/sales/by-device`

```json
{
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

### 6.5 Config dispositivo

`GET|PATCH /api/v1/pos-devices/:deviceId/dashboard-config`

- `:deviceId` = campo **`deviceId`** (string de instalación), no `POSDevice.id` UUID.
- PATCH body: `dashboardEnabled`, `deviceMode`, `dashboardView`, `regenerateToken?: boolean`
- Si `regenerateToken: true` → respuesta incluye `dashboardAccessToken` (solo en esa respuesta).

### 6.6 Kiosk — `GET /dashboard/device/:deviceId`

**Headers:**

```http
X-Device-Token: <token>
```

**Query:** `preset=today` (default) o `from`/`to`

**Response:** payload consolidado (como en spec original): `device`, `filters`, `summary`, `payments`, `series`.

Validaciones:

1. Dispositivo existe.
2. `dashboardEnabled === true`.
3. Token coincide con hash.
4. Opcional: `deviceMode` en `DASHBOARD` | `HYBRID`.

---

## 7. SQL de referencia (opcional — vistas)

Si se implementan vistas, unir `Store` para día de negocio:

```sql
-- prisma/migrations/.../dashboard_views/migration.sql (opcional)

CREATE OR REPLACE VIEW vw_dashboard_sales_daily AS
SELECT
  s."storeId"     AS store_id,
  s."deviceId"    AS device_id,
  (s."createdAt" AT TIME ZONE COALESCE(NULLIF(TRIM(st.timezone), ''), 'UTC'))::date AS business_day,
  COUNT(*)::int   AS sales_count,
  SUM(COALESCE(s."totalFunctional", s.total)) AS gross_sales_functional
FROM "Sale" s
JOIN "Store" st ON st.id = s."storeId"
WHERE s.status = 'CONFIRMED'
GROUP BY 1, 2, 3;
```

Análogo para `SaleReturn` (join venta si se filtra por `deviceId` de la venta original).

---

## 8. Orden de implementación (backend)

### Fase 0 — Spec (0.5 día)

- [ ] Crear `docs/api/REPORTS.md`
- [ ] Añadir enlace en `docs/api/README.md`

### Fase 1 — Fundamentos (1 día)

- [ ] Migración `POSDevice` + enums
- [ ] `PosDeviceController` + dashboard-config + generación token
- [ ] Índices en `Sale` / `SaleReturn` / `SalePayment`

### Fase 2 — Reports core (1.5–2 días)

- [ ] `ReportsModule` + DTOs + validación query
- [ ] Servicio de rango (presets + `resolveSaleListUtcRange`)
- [ ] `GET summary`, `timeseries`, `by-device`
- [ ] Servicio pagos con conversión FX

### Fase 3 — Kiosk (0.5–1 día)

- [ ] `DeviceDashboardGuard`
- [ ] `GET /dashboard/device/:deviceId`
- [ ] Tests integración

### Fase 4 — Cierre (0.5 día)

- [ ] Postman collection
- [ ] Actualizar `docs/MASTER_CONTEXT.md` y `DATABASE_SCHEMA_GUIDE.md` (sección reportes)

---

## 9. Tests mínimos

```text
reports.service.spec.ts     — presets, avgTicket, netSales
reports.integration.spec.ts — seed: 2 sales CONFIRMED, 1 return → summary/timeseries
dashboard-device.spec.ts    — token inválido 401, disabled 403, ok 200
```

Casos borde:

- Rango sin ventas → ceros y `tickets: 0`.
- `grossSales = 0` → `returnRate` omitido o `null`.
- `deviceId` sin ventas → filas vacías o ceros según endpoint.

---

## 10. Checklist backend (copiar a PR)

- [ ] Migración Prisma `POSDevice`
- [ ] Estados `CONFIRMED` documentados
- [ ] `ReportsModule` + 4 endpoints sales
- [ ] Endpoint kiosk con token
- [ ] `docs/api/REPORTS.md`
- [ ] Tests integración summary + devoluciones
- [ ] Postman actualizado

---

## 11. Riesgos residuales

| Riesgo | Mitigación |
|--------|------------|
| Pagos mal convertidos a funcional | Tests con cobro mixto USD/VES; v1.1 columna `amountFunctional` |
| TZ incorrecta en tienda | Validar `Store.timezone` en seed; meta en respuesta |
| Token filtrado en logs | No loguear `X-Device-Token` |
| Carga kiosk | TTL caché 30s en `ReportsService` por clave `storeId+preset` |

---

**Siguiente paso:** implementar Fase 0 + Fase 1 en este repo; el front puede mockear con Postman hasta tener `summary` y `dashboard/device`.
