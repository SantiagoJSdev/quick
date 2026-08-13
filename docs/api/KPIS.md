# KPIs operativos — snapshot diario

Header obligatorio: **`X-Store-Id`**.

## `GET /api/v1/kpis/snapshot`

Un solo endpoint para el tablero diario del minimarket (fase 1).

### Query

| Param | Descripción |
|-------|-------------|
| `preset` | `today` (default) \| `yesterday` \| `week` \| `month` — aplica a **ganancia** |
| `dateFrom` / `dateTo` | `YYYY-MM-DD` en zona de la tienda (alternativa a preset) |

**Nota:** `payables` y `stockAlerts` son **snapshot actual** (no dependen del rango). El rango solo filtra `grossProfit`.

### Respuesta (forma)

```json
{
  "storeId": "...",
  "currencyCode": "USD",
  "from": "2026-08-13",
  "to": "2026-08-13",
  "timezone": "America/Caracas",
  "preset": "today",
  "grossProfit": {
    "netSales": "580.00",
    "cogs": "495.00",
    "grossProfit": "85.00",
    "marginPercent": "14.6551",
    "byDay": [
      {
        "date": "2026-08-13",
        "netSales": "580.00",
        "cogs": "495.00",
        "grossProfit": "85.00",
        "marginPercent": "14.6551"
      }
    ]
  },
  "payables": {
    "asOf": "2026-08-13",
    "totalDueFunctional": "295.00",
    "openInvoiceCount": 4,
    "aging": {
      "overdue": "100.00",
      "dueToday": "50.00",
      "dueNext7Days": "145.00",
      "laterOrNoDueDate": "0"
    },
    "byDay": [
      { "date": "2026-08-15", "amountDueFunctional": "145.00", "invoiceCount": 2 },
      { "date": null, "amountDueFunctional": "0", "invoiceCount": 0 }
    ]
  },
  "stockAlerts": {
    "negativeCount": 1,
    "lowCount": 12,
    "defaults": { "lowUnits": "5", "lowKg": "3" },
    "negatives": [ { "productId": "...", "sku": "...", "name": "...", "quantity": "-2", "available": "-2", "unit": "unidad" } ],
    "low": [ { "productId": "...", "sku": "...", "name": "...", "quantity": "2", "available": "2", "threshold": "5", "unit": "unidad" } ]
  }
}
```

### Reglas de negocio

| Bloque | Regla |
|--------|--------|
| **Ganancia** | Venta neta (líneas CONFIRMED − devoluciones) − COGS. COGS = qty × (`averageUnitCostFunctional` si &gt; 0, si no `Product.cost`). `marginPercent` = ganancia / venta neta × 100. |
| **Deuda por días** | Facturas `CREDIT`/`PARTIAL` con saldo &gt; 0, agrupadas por `dueDate` (zona tienda). `date: null` = sin vencimiento. Incluye aging. |
| **Stock** | Solo productos `active`. Negativos: `quantity` o disponible &lt; 0. Bajo: disponible &lt; `minStock` (si &gt; 0) o umbral default 5 ud / 3 kg. Máx. 100 ítems por lista. |

### Ejemplo

```http
GET /api/v1/kpis/snapshot?preset=today
X-Store-Id: 0b54c944-28ba-4542-991a-4840c4801906
```
