# Contrato KPI → Front (v1 entregado)

**Estado:** backend Pasos 0–4 **listos**. Este documento es el contrato para que Front valide y construya sin reinventar fórmulas.

Base URL: `/api/v1`  
Header obligatorio: **`X-Store-Id`** (UUID tienda)  
Montos: **string decimal** en moneda funcional (`currencyCode`, Quick Market ≈ USD).  
Zona: **`America/Caracas`**. Si `timezoneSource === "fallback_utc"` → aviso en UI y no confiar en Hoy/Ayer.

Detalle UX largo: [`KPI_FRONTEND.md`](./KPI_FRONTEND.md).  
Constantes (% / fijos): [`KPI_GASTOS_CONSTANTES.md`](./KPI_GASTOS_CONSTANTES.md).

---

## 1. Reglas de producto (no negociables)

| Señal | Campo API | Pregunta | **No es** |
|-------|-----------|----------|-----------|
| Ganancia real | `realProfit.realProfit` | ¿Cuánto gané operando? | Efectivo para retirar |
| Patrimonio | `capital.netInventoryEquity` / serie | ¿El negocio crece? | Ganancia del día |
| Disponible sacar | `cashAvailable.suggestedWithdraw` | ¿Cuánto cash puedo sacar hoy? | Igual a realProfit |
| Cierre de caja | `POST /cash-sessions/:id/close` | Totales **de este POS** | Foto de patrimonio de la tienda |

- Front **no recalcula** totales, comisiones ni `suggestedWithdraw`.
- Compras / abonos = contexto en detalle, no hero.
- Chip “sacar” **nunca** reemplaza el hero de ganancia real.

---

## 2. Endpoints vivos

| Método | Ruta | Para qué |
|--------|------|----------|
| `GET` | `/kpis/snapshot?preset=today\|yesterday\|week\|month` | Tablero. También `dateFrom`/`dateTo` |
| `GET` | `/kpis/capital-series?preset=week\|month` | Tab Capital. Custom `dateFrom`/`dateTo` (máx. 62 días) |
| `POST` | `/kpis/capital-snapshots/run` | Soporte/backfill `{ "date": "YYYY-MM-DD" }` (default ayer) |
| `POST` | `/inventory/losses` | Registrar merma |
| `GET` | `/payment-methods` | Catálogo activo POS |
| `GET` | `/payment-methods/admin` | Todos (admin) |
| `POST` | `/payment-methods` | Crear método |
| `PATCH` | `/payment-methods/:id` | % / active / nombre |
| `POST` | `/cash-sessions/:id/close` | Cierre turno + `capitalPhoto` |
| `GET` | `/purchases/payables` | Detalle deuda (tap desde card) |
| `POST` | `/sales` + sync `SALE` | Cobro; `payments[].method` = `code` del catálogo |

---

## 3. `GET /kpis/snapshot`

### Qué sigue el preset / fechas

| Bloque | Sigue preset |
|--------|--------------|
| `grossProfit`, `realProfit` | **Sí** |
| `payables`, `stockAlerts`, `capital` | **No** (siempre “ahora”) |
| `cashAvailable` | **No** (siempre **hoy**) |

### Forma (campos que Front debe pintar)

```json
{
  "currencyCode": "USD",
  "from": "2026-08-21",
  "to": "2026-08-21",
  "timezone": "America/Caracas",
  "timezoneSource": "store",
  "preset": "today",
  "grossProfit": {
    "netSales": "580",
    "cogs": "495",
    "grossProfit": "85",
    "marginPercent": "14.65",
    "byDay": []
  },
  "realProfit": {
    "calendarDays": 1,
    "grossProfit": "85",
    "deductions": {
      "bags": { "amount": "..." },
      "charcuterieWrap": { "amount": "..." },
      "payroll": { "dailyTotal": "24.15", "days": 1, "amount": "24.15" },
      "fixed": { "utilities": "1.46", "rent": "2.5", "transport": "4.41", "amount": "8.37" },
      "losses": { "amount": "0.65", "movementCount": 2 },
      "paymentCommissions": { "amount": "2.10", "paymentCount": 1 },
      "total": "..."
    },
    "realProfit": "...",
    "realMarginPercent": "...",
    "explain": {
      "dayProgress": 0.85,
      "warnings": []
    }
  },
  "capital": {
    "inventoryCapital": "5210.21",
    "payablesDue": "800.00",
    "netInventoryEquity": "4410.21",
    "lossCostToday": "0.65",
    "lossMovementCountToday": 2
  },
  "cashAvailable": {
    "asOf": "2026-08-21",
    "cashCollected": "40.00",
    "supplierPayments": "10.00",
    "cashNet": "30.00",
    "replenishReservePercent": "0",
    "replenishReserve": "0",
    "amount": "30.00",
    "realProfitToday": "18.50",
    "suggestedWithdraw": "18.50"
  },
  "payables": { "totalDueFunctional": "...", "aging": {}, "byDay": [] },
  "stockAlerts": { "negativeCount": 0, "lowCount": 0, "negatives": [], "low": [] }
}
```

### Fórmulas (solo referencia; no recalcular en cliente)

```text
realProfit = gross
           − bags − charcuterieWrap
           − payroll×days − fixed×days
           − losses − paymentCommissions

suggestedWithdraw = min(max(0, realProfitToday), cashAvailable.amount)
cashAvailable.amount = max(0, cashCollected − supplierPayments − reserve%)
```

Reserva v1 = **0%**. Hoy temprano con real negativo por nómina+fijos de 1 día **puede ser esperado** (`explain.warnings`).

---

## 4. `GET /kpis/capital-series`

```http
GET /kpis/capital-series?preset=week
GET /kpis/capital-series?preset=month
GET /kpis/capital-series?dateFrom=2026-08-01&dateTo=2026-08-14
```

- `week` = **últimos 7 días calendario** (no semana ISO).
- Día sin foto → `missingDates[]`; **no inventar** puntos de inventario.
- `deltaEquity` = vs día anterior **si hay foto**; si no, `null`.
- `realProfit` en serie se **recalcula**; inventario/deuda = foto guardada.
- Lazy: si falta ayer, el back puede crearla (`lazyYesterday: true`).

```json
{
  "from": "2026-08-15",
  "to": "2026-08-21",
  "missingDates": ["2026-08-17"],
  "items": [
    {
      "date": "2026-08-21",
      "inventoryCapital": "5210.21",
      "payablesDue": "800.00",
      "netInventoryEquity": "4410.21",
      "realProfit": "48.50",
      "lossCostFunctional": "0.65",
      "purchasesFunctional": "120.00",
      "supplierPayments": "50.00",
      "deltaEquity": "35.20",
      "source": "CASH_CLOSE",
      "capturedAt": "..."
    }
  ]
}
```

---

## 5. Merma

```http
POST /inventory/losses
{
  "productId": "<uuid>",
  "quantity": "1",
  "reason": "Podrido",
  "opId": "<uuid opcional>"
}
```

- Baja stock a costo promedio.
- Motivos sugeridos: Podrido | Vencido | Rotura | Autoconsumo | Otro.
- 1 kg papa + 0.5 kg cebolla = **dos** POSTs.
- Idempotente con `opId`.

---

## 6. Métodos de pago (POS)

```http
GET /payment-methods
```

| `code` | UI | % | Efectivo (`isCashLike`) |
|--------|-----|---|-------------------------|
| `CASH_USD` | Efectivo USD | 0 | true |
| `CASH_VES` | Efectivo VES | 0 | true |
| `DEBITO_BDV` | Débito BDV | **2.1** | false |
| `DEBITO_BNC` | Débito BNC | **2.0** | false |

Cobro:

1. Listar solo `active`.
2. En venta/sync: `payments[].method` = `code` **exacto**.
3. Si `% > 0` → warning UI (“descuenta X% de la ganancia”).
4. Split: comisión solo en el tramo con %.
5. KPI: pintar `realProfit.deductions.paymentCommissions` (no calcular % en cliente).
6. Método desconocido: venta pasa, comisión 0, warning `PAYMENT_METHOD_UNKNOWN`.

Admin: `GET/POST /payment-methods` + `PATCH /payment-methods/:id`  
Ej. `{ "commissionPercent": "2.5", "active": true }`.

---

## 7. Cierre de caja → foto patrimonio

```http
POST /cash-sessions/:id/close
```

Respuesta incluye:

```json
{ "capitalPhoto": { "date": "2026-08-21", "ok": true, "netInventoryEquity": "4410.21" } }
```

o `{ "capitalPhoto": { "ok": false } }` (cierre **igual** quedó CLOSED).

- 1 foto por **tienda + día**; varios POS el mismo día **reescriben** la misma fila.
- Front **no** llama `/kpis/capital-snapshots/run` al cerrar.
- Toast opcional si `ok === true`. No confundir totales del turno con patrimonio.

---

## 8. Layout sugerido (validar con producto)

```text
TAB HOY
  [Hoy|Ayer|Semana|Mes]          ← solo bruta/real
  Hero: ganancia REAL
  Card: ganancia BRUTA
  Expand: deductions (bags, wrap, payroll, fixed, losses, paymentCommissions)
  Chip: “te puedes llevar hoy ~X” = cashAvailable.suggestedWithdraw
  Deuda aging | Stock alertas    ← siempre ahora
  Cards capital live (opcional en este tab)

TAB CAPITAL
  [7d|Mes|Fechas]
  Hero: netInventoryEquity + deltaEquity
  Gráfica items[].netInventoryEquity
  Huecos = missingDates
```

---

## 9. Checklist de aceptación Front

### Tablero

- [ ] `GET /kpis/snapshot` + header `X-Store-Id`
- [ ] Chips today / yesterday / week / month
- [ ] Hero = `realProfit.realProfit` (nunca titulado “para sacar”)
- [ ] Expand deducciones: bags, wrap, payroll, fixed, **losses**, **paymentCommissions**
- [ ] Bruta + `byDay` en week/month
- [ ] Deuda aging + link a payables
- [ ] Stock badges + listas
- [ ] Aviso si `timezoneSource === fallback_utc`
- [ ] Chip sacar = `cashAvailable.suggestedWithdraw` (aparte del hero)

### Capital

- [ ] `GET /kpis/capital-series?preset=week|month`
- [ ] No inventar puntos: usar `missingDates`
- [ ] `deltaEquity` null → sin flecha inventada
- [ ] Tras close: toast si `capitalPhoto.ok`; no mezclar con resumen del POS

### Merma / POS

- [ ] `POST /inventory/losses` desde ficha producto
- [ ] Cobro solo con `GET /payment-methods`
- [ ] Warning si `commissionPercent > 0`
- [ ] Admin PATCH % opcional

### Prohibido

- [ ] Recalcular real / comisión / suggestedWithdraw en cliente
- [ ] Usar `Product.cost` de catálogo como COGS del KPI
- [ ] Igualar realProfit del día a Δ patrimonio del mismo día

---

## 10. Fuera de alcance v1 (no pedir al Front aún)

- Alertas “3 días Δ &lt; 0”
- Registrar el retiro del dueño en sistema
- Cron nocturno de fotos
- Reserva reposición &gt; 0% (hoy es 0; si cambia, solo back + constante)

---

**Store de prueba Quick Market:** `0b54c944-28ba-4542-991a-4840c4801906`  
Smoke: `GET /api/v1/kpis/snapshot?preset=today` con ese `X-Store-Id`.
