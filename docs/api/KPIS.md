# KPIs operativos — snapshot diario

Header obligatorio: **`X-Store-Id`**.

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

Pendientes (fase 2, KPI “para sacar”, etc.): [KPI_GANANCIA_REAL_PENDIENTES.md](../KPI_GANANCIA_REAL_PENDIENTES.md).

### Respuesta (forma resumida)

```json
{
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
    "realMarginPercent": "..."
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
