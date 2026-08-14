# KPIs — endpoint y cómo mostrarlos (Front)

Contrato técnico: [`api/KPIS.md`](./api/KPIS.md).  
Pendientes fase 2 / “para sacar”: [`KPI_GANANCIA_REAL_PENDIENTES.md`](./KPI_GANANCIA_REAL_PENDIENTES.md).

Header: **`X-Store-Id`**. Montos en **moneda funcional** (`currencyCode`); son **strings decimales** — formatear en UI, no recalcular totales.

---

## 1. Endpoint (único hoy)

```http
GET /api/v1/kpis/snapshot?preset=today
X-Store-Id: <uuid tienda>
```

| Query | Valores | Qué afecta |
|-------|---------|------------|
| `preset` | `today` (default) \| `yesterday` \| `week` \| `month` | Solo **grossProfit** y **realProfit** |
| `dateFrom` / `dateTo` | `YYYY-MM-DD` (zona tienda) | Idem, rango custom |

**Importante:** `payables` y `stockAlerts` son **siempre snapshot actual** (no siguen el preset). El chip de “Hoy / Semana / Mes” solo cambia ganancia.

Meta de respuesta (siempre):

| Campo | Uso UI |
|-------|--------|
| `currencyCode` | Sufijo / símbolo (ej. USD) |
| `from` / `to` | Subtítulo del período |
| `timezone` | Debe ser `America/Caracas` en Quick Market |
| `timezoneSource` | `store` OK · `fallback_utc` = **bug de config** (mostrar aviso) |
| `rangeUtc` | Debug: bounds reales `gte`/`lt` |
| `realProfit.explain` | `dayProgress`, `warnings` (día parcial / TZ) |

Si `timezoneSource === 'fallback_utc'`, el día está mal cortado vs Venezuela — no confiar en Hoy/Ayer hasta corregir `Store.timezone`.

---

## 2. Mapa de pantalla sugerido (1 composición)

Una sola llamada alimenta el tablero. Orden recomendado:

```text
┌─────────────────────────────────────────────┐
│  [Hoy] [Ayer] [Semana] [Mes]     ← preset   │
│  Período: from → to · currencyCode          │
├──────────────────┬──────────────────────────┤
│  GANANCIA REAL   │  GANANCIA BRUTA          │  ← hero nums
│  (número grande) │  (secundario + margen %) │
├──────────────────┴──────────────────────────┤
│  Desglose deducciones (expandible)          │
├──────────────────┬──────────────────────────┤
│  DEUDA (aging)   │  STOCK (badges)          │  ← siempre “ahora”
└──────────────────┴──────────────────────────┘
```

- **No** mezclar “ganancia real” con “cuánto puedo sacar de caja” (ese KPI aún no existe).
- En móvil: 4 bloques en scroll vertical (Real → Bruta → Deuda → Stock).

---

## 3. Bloque `grossProfit` — ganancia bruta

### Campos

| Campo | Significado |
|-------|-------------|
| `netSales` | Venta neta del rango |
| `cogs` | Costo de lo vendido |
| `grossProfit` | `netSales − cogs` |
| `marginPercent` | Margen % o `null` |
| `byDay[]` | Serie diaria: `date`, `netSales`, `cogs`, `grossProfit` |

### Cómo mostrarlo

| Elemento | Sugerencia |
|----------|------------|
| Card secundaria | Título **Ganancia bruta**, número = `grossProfit` |
| Subtexto | `netSales` venta · `cogs` costo · margen `marginPercent`% |
| Semana/mes | Mini sparkline o barras con `byDay` (eje = `date`) |
| Hoy/ayer | Ocultar chart; solo totales |

**Copy corto:** “Lo que queda después del costo de mercancía, **antes** de bolsas, personal y fijos.”

---

## 4. Bloque `realProfit` — ganancia real (fase 1)

### Fórmula (mostrar en “?” / detalle)

```text
realProfit = grossProfit
           − bolsas
           − platos charcutería
           − nómina × días
           − (luz + alquiler + transporte) × días
```

### Campos clave

| Campo | UI |
|-------|-----|
| `realProfit` | **Número hero** del tablero |
| `realMarginPercent` | Chip “margen real %” |
| `phase` | Badge discreto `fase 1` (opcional) |
| `calendarDays` | “Calculado sobre N días” |
| `deductions.total` | Total restado |
| `deductions.bags` | Tickets, bolsas estimadas, monto |
| `deductions.charcuterieWrap` | Unidades × 0.025 |
| `deductions.payroll` | Lista empleados + `amount` |
| `deductions.fixed` | Luz / alquiler / transporte |

### Cómo mostrarlo

| Elemento | Sugerencia |
|----------|------------|
| Hero | Título **Ganancia real del día** (o del período), valor = `realProfit` |
| Color | Verde si ≥ 0, ámbar/rojo si &lt; 0 |
| Expandible | Lista de deducciones con montos; total = `deductions.total` |
| Comparación | Una línea: bruta `grossProfit` → real `realProfit` |
| Config | Enlace admin a editar `realProfitConfig` vía `PATCH /business-settings` (no en el tablero operador) |

**Copy corto:** “Después de empaque estimado, nómina y gastos fijos diarios. Las ventas ya hechas no se reescriben.”

**No mostrar** como “efectivo disponible para retirar”.

---

## 5. Bloque `payables` — deuda a proveedores

Snapshot **ahora** (ignora preset).

### Campos

| Campo | UI |
|-------|-----|
| `totalDueFunctional` | Número grande **Deuda abierta** |
| `openInvoiceCount` | “N facturas” |
| `asOf` | “Al …” |
| `aging.overdue` | Chip rojo **Vencida** |
| `aging.dueToday` | Chip ámbar **Hoy** |
| `aging.dueNext7Days` | Chip **7 días** |
| `aging.laterOrNoDueDate` | Chip gris **Luego / sin fecha** |
| `byDay[]` | `date` (`null` = sin vencimiento), `amountDueFunctional`, `invoiceCount` |

### Cómo mostrarlo

| Elemento | Sugerencia |
|----------|------------|
| Card | Total + count |
| Aging | 4 chips horizontales (montos) |
| Lista | `byDay` ordenado; `date == null` → fila “Sin vencimiento” |
| Tap | Navegar a hub Facturas / `GET /purchases/payables` para detalle por proveedor |

**Copy corto:** “Saldo de facturas crédito/parcial activas (anuladas no entran).”

---

## 6. Bloque `stockAlerts` — alertas de inventario

Snapshot **ahora**.

### Campos

| Campo | UI |
|-------|-----|
| `negativeCount` / `lowCount` | Badges en header de la card |
| `negatives[]` | Lista roja (hasta 100): sku, name, `available` |
| `low[]` | Lista ámbar: `available` vs `threshold` |
| `defaults.lowUnits` / `lowKg` | Tooltip umbral default |

### Cómo mostrarlo

| Elemento | Sugerencia |
|----------|------------|
| Resumen | Dos badges: **Negativos N** · **Bajos M** |
| Prioridad | Primero `negatives`, luego `low` |
| Filas | Nombre + disponible; en bajos mostrar “umbral X” |
| Vacío | “Sin alertas” (estado sano) |
| Tap fila | Ir a ficha producto / inventario |

**Copy corto:** “Negativo = qty o disponible &lt; 0. Bajo = disponible &lt; minStock (o 5 ud / 3 kg).”

---

## 7. Comportamiento UX recomendado

1. **Un fetch** al entrar al tablero + al cambiar preset.
2. Pull-to-refresh.
3. Loading: skeleton de 4 cards (no spinners sueltos).
4. Error de red: toast + último snapshot en cache opcional.
5. No inventar KPIs en cliente restando campos a mano salvo visualizaciones derivadas triviales (ej. “deducciones = bruta − real” ya viene en `deductions.total`).
6. Presets week/month: enfatizar que nómina/fijos se multiplican por `calendarDays`.

---

## 8. Qué NO está listo (no inventar UI como si existiera)

| KPI | Estado |
|-----|--------|
| **Disponible para sacar** (caja neta del día) | Pendiente — ver `KPI_GANANCIA_REAL_PENDIENTES.md` |
| Comisión puntos/transferencias, faltante caja, merma frescos, `OUT_LOSS` | Fase 2 de ganancia real |
| Sync / endpoint aparte de snapshot | No hay; todo va en este GET |

Si el negocio pregunta “¿cuánto puedo sacar?”, responder: **aún no hay endpoint**; no reutilizar `realProfit`.

---

## 9. Ejemplo mínimo de integración

```dart
// Pseudocódigo
final res = await api.get('/kpis/snapshot', query: {'preset': preset});
final currency = res['currencyCode'];
final real = res['realProfit']['realProfit'];
final gross = res['grossProfit']['grossProfit'];
final debt = res['payables']['totalDueFunctional'];
final neg = res['stockAlerts']['negativeCount'];
final low = res['stockAlerts']['lowCount'];
```

Filtros sugeridos en app:

- Chip período → `preset`
- Card deuda → pantalla payables
- Card stock → lista completa de `negatives` + `low`

---

## 10. Checklist front

- [ ] Llamar `GET /kpis/snapshot` con `X-Store-Id`
- [ ] Chips `today` / `yesterday` / `week` / `month`
- [ ] Hero = `realProfit.realProfit` + expand deducciones
- [ ] Card bruta + opcional `byDay` en week/month
- [ ] Deuda: total + aging + link a facturas
- [ ] Stock: badges + listas
- [ ] No etiquetar ganancia real como “para sacar”
- [ ] Formatear strings decimales con `currencyCode`
