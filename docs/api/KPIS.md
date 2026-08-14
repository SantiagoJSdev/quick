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
```

Config en `BusinessSettings.realProfitConfig` (JSON). Si es null, se usan defaults del código.  
Actualizar: `PATCH /business-settings` con `{ "realProfitConfig": { ... } }`.

Bloque `realProfit.explain`: rangos UTC, `dayProgress` (si es hoy), warnings (día parcial / timezone UTC).  
Logs servidor: cada snapshot escribe una línea `KPI snapshot store=... gross=... real=...`.

Pendientes (fase 2, KPI “para sacar”, etc.): [KPI_GANANCIA_REAL_PENDIENTES.md](../KPI_GANANCIA_REAL_PENDIENTES.md).  
**Front — cómo visualizar:** [KPI_SNAPSHOT_FRONTEND.md](../KPI_SNAPSHOT_FRONTEND.md).  
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
  "stockAlerts": {}
}
```

### Reglas

| Bloque | Regla |
|--------|--------|
| **grossProfit** | Venta neta − COGS (avg cost o `Product.cost`) |
| **realProfit** | gross − mermas variables − nómina − fijos (fase 1) |
| **payables** | Deuda CREDIT/PARTIAL por `dueDate` + aging |
| **stockAlerts** | Negativos + bajo umbral (minStock o 5/3) |

### Ejemplo

```http
GET /api/v1/kpis/snapshot?preset=today
X-Store-Id: 0b54c944-28ba-4542-991a-4840c4801906
```
