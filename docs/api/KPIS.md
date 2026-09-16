# KPIs operativos — snapshot diario

Header obligatorio: **`X-Store-Id`**.

**Zona horaria:** el día KPI usa `Store.timezone` (Quick Market = `America/Caracas`: 00:00→24:00 local). Si está vacío, cae a **UTC** y desplaza el día (~4 h). La respuesta incluye `timezone`, `timezoneSource`, `rangeUtc`.

## `GET /api/v1/kpis/snapshot`

Tablero diario: ganancia bruta, **ganancia real (fase 1)**, deuda y stock.

### Query

| Param | Descripción |
|-------|-------------|
| `preset` | `today` (default) \| `yesterday` \| `week` \| `month` — aplica a **grossProfit** y **realProfit** |
| `dateFrom` / `dateTo` | `YYYY-MM-DD` en zona de la tienda |

**Nota:** `payables` y `stockAlerts` son snapshot actual. El rango filtra ventas/ganancia.

### `realProfit` (fase 1)

```text
realProfit = grossProfit
           − bolsas (tickets × 0.90 × costo_paquete/100)
           − platos charcutería (Σ qty SKUs × 0.025)
           − nómina diaria × días_del_rango
           − (luz+alquiler+transporte) × días_del_rango
           − merma OUT_LOSS del rango
           − comisiones de pago (Σ SalePayment.commissionFunctional del rango)
```

Constantes (luz, alquiler, nómina, % BDV/BNC): [KPI_GASTOS_CONSTANTES.md](../KPI_GASTOS_CONSTANTES.md) + `src/modules/kpis/gasto-constants.ts`.  
Config fijos: `BusinessSettings.realProfitConfig`. Métodos de pago: `GET /payment-methods`.

Bloque **`capital`** (siempre “ahora”, no sigue preset):

| Campo | Significado |
|-------|-------------|
| `inventoryCapital` | Σ costo inventario qty&gt;0 activos |
| `payablesDue` | Deuda CREDIT/PARTIAL RECEIVED |
| `netInventoryEquity` | inventario − deuda |
| `lossCostToday` | Merma `OUT_LOSS` **de hoy** (zona tienda) |

`realProfit.deductions.losses` = merma del **rango** del preset.

Bloque **`cashAvailable`** (siempre **hoy**, no sigue preset):

| Campo | Significado |
|-------|-------------|
| `cashCollected` | Σ pagos con métodos `isCashLike` de hoy |
| `supplierPayments` | Abonos a proveedores de hoy |
| `amount` | max(0, cashNet − reserva%) |
| `realProfitToday` | Ganancia real de hoy |
| `suggestedWithdraw` | min(max(0, realProfitToday), amount) — chip Front |

Reserva: `GASTO_REPLENISH_RESERVE_PERCENT` (v1 = 0). No registra el retiro.

### Merma

```http
POST /api/v1/inventory/losses
{ "productId": "<uuid>", "quantity": "1", "reason": "Podrido", "opId": "<uuid>" }
```

Baja stock a **`Product.cost`** (catálogo). Promedio solo si catálogo = 0. Idempotente con `opId`.

Bloque `realProfit.explain`: rangos UTC, `dayProgress` (si es hoy), warnings (día parcial / timezone UTC).  
Logs servidor: cada snapshot escribe una línea `KPI snapshot store=... gross=... real=...`.

Pendientes extras: [KPI_GANANCIA_REAL_PENDIENTES.md](../KPI_GANANCIA_REAL_PENDIENTES.md).  
**Front (único):** [KPI_FRONTEND.md](../KPI_FRONTEND.md).  
**Verificación senior fase 1:** [KPI_SNAPSHOT_VERIFICACION.md](../KPI_SNAPSHOT_VERIFICACION.md).

### Hoy negativo vs ayer positivo

1. **Bug típico:** `Store.timezone` null → día en UTC. En Caracas a las 20:00, “today” UTC ya es el día siguiente con pocas ventas. **Fix:** `America/Caracas`.
2. **Esperado (día en curso):** con TZ correcta, si aún es temprano, nómina+fijos = 1 día completo vs ventas parciales puede dar real &lt; 0. Ver `explain.warnings` / `dayProgress`.

### Respuesta (forma resumida)

```json
{
  "timezone": "America/Caracas",
  "timezoneSource": "store",
  "rangeUtc": { "gte": "...", "lt": "..." },
  "grossProfit": {
    "netSales": "580",
    "cogs": "495",
    "grossProfit": "85",
    "marginPercent": "14.65",
    "byDay": []
  },
  "realProfit": {
    "phase": "1",
    "calendarDays": 1,
    "grossProfit": "85",
    "deductions": {
      "bags": { "tickets": 40, "bagsEstimated": "36", "amount": "..." },
      "charcuterieWrap": { "unitsSold": "12", "unitCost": "0.025", "amount": "0.3" },
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
      "opsFullDayCharged": true,
      "warnings": []
    }
  },
  "payables": {},
  "stockAlerts": {},
  "capital": {
    "inventoryCapital": "5210.21",
    "payablesDue": "800.00",
    "netInventoryEquity": "4410.21",
    "lossCostToday": "0.65"
  }
}
```

### Reglas

| Bloque | Regla |
|--------|--------|
| **grossProfit** | Venta neta − COGS (`SaleLine.unitCostFunctional`; si falta, costo del snapshot del día; último fallback catálogo live) |
| **capital** / patrimonio | Inventario valorizado a `Product.cost` × qty (live); fotos diarias congelan totales y costos por SKU |
| **realProfit** | gross − mermas variables − nómina − fijos (fase 1) |
| **payables** | Deuda CREDIT/PARTIAL por `dueDate` + aging |
| **stockAlerts** | Negativos + bajo umbral (minStock o 5/3) |

### Ejemplo

```http
GET /api/v1/kpis/snapshot?preset=today
X-Store-Id: 0b54c944-28ba-4542-991a-4840c4801906
```

## `GET /api/v1/kpis/capital-series`

Serie de fotos `StoreCapitalSnapshot` (1 por tienda por día). Header `X-Store-Id`.

| Query | |
|-------|--|
| `preset` | `week` (últimos 7 días calendario tienda) \| `month` (mes en curso → hoy) |
| `dateFrom` / `dateTo` | Custom `YYYY-MM-DD`, máx. 62 días |

Sin query = mismos 7 días que `week`. Días sin foto **no** se inventan (`missingDates`).  
Si falta la foto de **ayer**, el backend la crea lazy (`source=LAZY`, inventario = ahora) y no pisa un `CASH_CLOSE`.  
Cada foto guarda `inventorySkuCosts` (qty + `unitCostFunctional` por SKU activo con stock > 0) para COGS histórico.  
`realProfit` / merma se **recalculan** al leer (COGS usa `SaleLine.unitCostFunctional` o costos del snapshot del día); inventario y deuda son la foto guardada.  
`deltaEquity` = vs el día calendario anterior **si existe foto**; si no, `null`.

```http
GET /api/v1/kpis/capital-series?preset=week
POST /api/v1/kpis/capital-snapshots/run
{ "date": "2026-08-17" }
```

`POST .../run` default = ayer. Idempotente (reescribe). Inventario/deuda = **ahora**.

Al `POST /cash-sessions/:id/close` exitoso: upsert de **hoy** (`source=CASH_CLOSE`). Varios POS = misma fila. Respuesta extra `capitalPhoto`. Si el upsert falla, el cierre **no** se revierte.
