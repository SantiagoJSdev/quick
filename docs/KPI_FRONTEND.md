# KPIs + POS — guía única Front

**Este es el único documento de integración Front** para tablero KPIs, patrimonio, merma, métodos de pago y cierre de caja.

**Contrato de entrega v1 (validar con Front):** [`KPI_CONTRATO_FRONT.md`](./KPI_CONTRATO_FRONT.md).  
Pasos backend: [`KPI_IMPLEMENTACION_BACK.md`](./KPI_IMPLEMENTACION_BACK.md).  
Constantes (luz, alquiler, débitos BDV/BNC): [`KPI_GASTOS_CONSTANTES.md`](./KPI_GASTOS_CONSTANTES.md).  
Modelo patrimonio: [`KPI_PATRIMONIO_CRECIMIENTO.md`](./KPI_PATRIMONIO_CRECIMIENTO.md).  
Contrato HTTP ya vivo: [`api/KPIS.md`](./api/KPIS.md).

Header siempre: **`X-Store-Id`**. Montos = **strings decimales** en moneda funcional (`currencyCode`). Formatear en UI; no recalcular totales ni comisiones en el cliente.

Zona: **`America/Caracas`**. Si la API trae `timezoneSource === 'fallback_utc'`, mostrar aviso y no confiar en Hoy/Ayer.

---

## 0. Cómo piensa el dueño (no mezclar)

```text
DIARIO
  1) Ganancia real = “esto me gané hoy” (referencia para llevarme plata)
  2) Patrimonio (inv − deuda) no debe caer al llevármela
  3) (después) Disponible para sacar = freno de caja:
     no llevar más que min(ganancia real, efectivo disponible)

SEMANA
  4) Veo ganancia real acumulada
  5) Decido si INYECTO parte de eso al capital del negocio
```

| Señal | Pregunta | No es |
|-------|----------|--------|
| **Ganancia real** | ¿Cuánto gané operando? | Efectivo para retirar |
| **Patrimonio / capital** | ¿El negocio crece o se come? | Ganancia del día |
| **Disponible para sacar** | ¿Cuánto cash puedo sacar hoy sin joder el local? | Igual a realProfit |
| **Cierre de caja** | ¿Cuánto vendió **este** POS en el turno? | Foto de patrimonio de la tienda |

**Regla:** compras del día / abonos = **contexto** en el detalle, no card héroe.

---

## 1. Hub KPIs — layout

Tabs (o scroll): **Hoy (operar)** · **Capital (crecer)** · (luego) **Sacar**.

```text
[Hoy] [Ayer] [Semana] [Mes]     ← preset (solo gana bruta/real)
Período from→to · currencyCode

TAB HOY
  Ganancia REAL (hero)     Ganancia BRUTA
  Desglose deducciones (expandible)
  Deuda aging              Stock alertas     ← siempre “ahora”

TAB CAPITAL
  [7 días] [Mes] [Desde–Hasta]   ← serie de fotos
  Patrimonio neto (inv − deuda)
  vs ayer / vs inicio rango
  Inventario a costo | Deuda
  Gráfica netInventoryEquity (+ opcional realProfit)
  Hoy: real | merma | (luego) comisiones | compras | abonos
```

Móvil: bloques en vertical. Pull-to-refresh. Skeleton, no spinners sueltos.

---

## 2. `GET /kpis/snapshot` — tablero live (YA existe)

```http
GET /api/v1/kpis/snapshot?preset=today
GET /api/v1/kpis/snapshot?preset=yesterday|week|month
GET /api/v1/kpis/snapshot?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
```

| Query | Afecta |
|-------|--------|
| `preset` / fechas | **Solo** `grossProfit` y `realProfit` |
| — | `payables` y `stockAlerts` son **ahora**, ignoran preset |

### Meta

| Campo | UI |
|-------|-----|
| `currencyCode` | Símbolo |
| `from` / `to` | Subtítulo |
| `timezone` | Debe ser `America/Caracas` |
| `timezoneSource` | `store` OK · `fallback_utc` = alerta |
| `realProfit.explain` | `dayProgress`, `warnings` (día a medias) |

Hoy negativo temprano con nómina+fijos de 1 día **puede ser esperado** (`explain.warnings`).

### `grossProfit`

| Campo | UI |
|-------|-----|
| `grossProfit` | Card secundaria |
| `netSales` / `cogs` / `marginPercent` | Subtexto |
| `byDay[]` | Sparkline en week/month |

Copy: “Después del costo de mercancía, **antes** de gastos/merma.”  
Costo operativo = **`Product.cost`** del catálogo (mantenerlo al día cuando cambie el proveedor). Promedio de inventario solo si catálogo = 0.

### `realProfit` (fase 1 hoy; se irá ampliando)

```text
realProfit = grossProfit
           − bolsas
           − platos charcutería
           − nómina × calendarDays
           − (luz + alquiler + transporte) × días
           − merma OUT_LOSS
           − comisiones de pago
```

Hero = `realProfit.realProfit`. Expandir `deductions.*`.  
**Nunca** titular “disponible para sacar”.

Campos: `bags`, `charcuterieWrap`, `payroll`, `fixed`, `losses`, `paymentCommissions`, `total`.

Si `calendarDays > 1`, mostrar “calculado sobre N días”.

### `payables` (ahora)

Total, `openInvoiceCount`, aging (`overdue` / `dueToday` / `dueNext7Days` / `laterOrNoDueDate`), `byDay`.  
Tap → hub Facturas / `GET /purchases/payables`. Anuladas no entran.

### `stockAlerts` (ahora)

Badges `negativeCount` / `lowCount`; listas `negatives` luego `low`. Tap → ficha producto.

### `capital` (live — Paso 1 listo)

```text
capital.inventoryCapital
capital.payablesDue
capital.netInventoryEquity     ← hero tab Capital
capital.lossCostToday
```

No sigue el preset (es **ahora**). `deductions.losses` sí sigue el rango.

---

## 3. Serie de crecimiento — `GET /kpis/capital-series` (**listo**)

```http
GET /api/v1/kpis/capital-series?preset=week
GET /api/v1/kpis/capital-series?preset=month
GET /api/v1/kpis/capital-series?dateFrom=2026-08-01&dateTo=2026-08-14
```

Chips: **7 días** · **Mes** · **Elegir fechas**. Máx. ~62 días.

```json
{
  "timezone": "America/Caracas",
  "timezoneSource": "store",
  "from": "2026-08-08",
  "to": "2026-08-14",
  "preset": "week",
  "lazyYesterday": false,
  "missingDates": ["2026-08-10"],
  "items": [
    {
      "date": "2026-08-14",
      "inventoryCapital": "5210.21",
      "payablesDue": "800.00",
      "netInventoryEquity": "4410.21",
      "realProfit": "48.50",
      "lossCostFunctional": "0.65",
      "purchasesFunctional": "120.00",
      "supplierPayments": "50.00",
      "deltaEquity": "35.20",
      "source": "CASH_CLOSE",
      "capturedAt": "2026-08-14T22:15:00.000Z"
    }
  ]
}
```

- `preset=week` = **últimos 7 días** calendario (no semana ISO). `month` = mes en curso hasta hoy. Custom `dateFrom`/`dateTo` máx. 62 días.
- `deltaEquity` = vs **el día calendario anterior si hay foto** (`null` si ese día es hueco o es el primero). Verde ≥ 0, rojo &lt; 0.
- Día **sin foto** → no viene en `items`; está en `missingDates`. **No inventar** inventario pasado.
- `realProfit` en la serie se **recalcula** con el motor actual (si cambia config/mermas, la gráfica de ganancia se alinea). Inventario/deuda quedan como la foto.
- Warning opcional: `realProfit` &gt; 0 y `deltaEquity` &lt; 0.

La primera vez que abras la serie, el backend puede **crear lazy** la foto de ayer (`lazyYesterday: true`). Inventario/deuda de esa foto lazy = **ahora** (no hay máquina del tiempo). No hace falta un botón extra.

---

## 4. Cierre de caja → foto de patrimonio (**listo**)

El cierre de caja (`POST /cash-sessions/:id/close`) es por **device / turno**. La foto de patrimonio es de **toda la tienda**.

| Qué | Cómo |
|-----|------|
| Disparo | Al **cerrar caja** con éxito, el backend hace **upsert** de `StoreCapitalSnapshot` del **día Caracas de la tienda** |
| Granularidad | **1 foto por tienda por día**, no por caja |
| Varios POS | 2º y 3º cierre **del mismo día reescriben** la misma fila (recalcula inv + deuda + real de **toda** la tienda) |
| UX | Toast suave si `capitalPhoto.ok === true`: “Capital del día actualizado”. **No** bloquear: si `ok: false` el cierre ya quedó |
| Si nadie cierra | Respaldo: lazy al abrir serie o `POST .../run`. **No** hace falta cron para el flujo normal |

La respuesta de close incluye `capitalPhoto` (no hace falta un segundo GET):

```json
{ "capitalPhoto": { "date": "2026-08-18", "ok": true, "netInventoryEquity": "4410.21" } }
```

o `{ "capitalPhoto": { "ok": false } }` si el upsert falló (el turno igual está CLOSED).

Front **no** llama `POST /kpis/capital-snapshots/run` al cerrar.

No mezclar en UI: resumen de **esta caja** ≠ patrimonio de la **tienda**.

---

## 5. Merma (**listo**)

**No** campo `merma` en el producto.

En ficha producto / inventario → **Registrar merma**:

| UI | API |
|----|-----|
| Cantidad | `quantity` (`"1"`, `"0.5"`) |
| Motivo | `reason`: Podrido / Vencido / Rotura / Autoconsumo / Otro |
| (opc) | `opId` |

```http
POST /api/v1/inventory/losses
{ "productId": "...", "quantity": "1", "reason": "Podrido", "opId": "..." }
```

Efecto: baja stock, resta `realProfit.deductions.losses`, baja capital live.  
1 kg papa + 0.5 kg cebolla = **dos** registros. PIN admin como otros ajustes.

---

## 6. Métodos de pago y comisiones (Paso 3) — **listo**

Catálogo por tienda (valores actuales):

| `code` (enviar en venta) | UI | % | Efectivo |
|--------------------------|-----|---|----------|
| `CASH_USD` | Efectivo USD | 0 | sí |
| `CASH_VES` | Efectivo VES | 0 | sí |
| `DEBITO_BDV` | Débito Banco de Venezuela | **2.1** | no |
| `DEBITO_BNC` | Débito BNC | **2.0** | no |

Cambiar %: `PATCH /payment-methods/:id` o [`KPI_GASTOS_CONSTANTES.md`](./KPI_GASTOS_CONSTANTES.md) → seed. Ventas **ya cobradas** no cambian (foto del % en el pago).

### Cobro

1. `GET /payment-methods` — solo `active`.  
2. `method` en la venta = `code` exacto.  
3. Si `commissionPercent > 0`: “Este método descuenta X% de la ganancia.”  
4. Split: comisión solo en el tramo con %.  
5. Front **no** calcula el KPI; lee `realProfit.deductions.paymentCommissions`.  
6. Método desconocido: la venta **pasa** con comisión 0 y warning `PAYMENT_METHOD_UNKNOWN` (mejor usar catálogo).

Cada pago guarda `amountFunctional`, `commissionPercentApplied`, `commissionFunctional`.

---

## 7. Disponible para sacar (Paso 4) — **listo**

No toca inventario. No registra el retiro. Solo guía de **caja** (**siempre hoy**, no sigue el preset de ganancia):

```text
cashNet = Σ pagos isCashLike (hoy) − abonos proveedores (hoy)
amount  = max(0, cashNet − reserva%)
suggestedWithdraw = min(max(0, realProfitToday), amount)
```

Reserva v1 = **0%** (`KPI_GASTOS_CONSTANTES.md`). Chip aparte. **Nunca** reemplaza el hero de ganancia real.

```json
{
  "cashAvailable": {
    "asOf": "2026-08-20",
    "cashCollected": "40.00",
    "supplierPayments": "10.00",
    "cashNet": "30.00",
    "replenishReservePercent": "0",
    "replenishReserve": "0",
    "amount": "30.00",
    "realProfitToday": "18.50",
    "suggestedWithdraw": "18.50"
  }
}
```

Usar `suggestedWithdraw` en el chip. Si `realProfitToday` &lt; 0 → sugerido `0`.

---

## 8. Endpoints que el Front necesita

Todos bajo `/api/v1`, header **`X-Store-Id`**. Montos string decimal.

### Listos ahora

| Método | Ruta | Uso Front |
|--------|------|-----------|
| `GET` | `/kpis/snapshot?preset=today\|yesterday\|week\|month` | Tablero. Query `dateFrom`/`dateTo` opcional |
| `GET` | `/kpis/capital-series?preset=week\|month` | Tab Capital. `dateFrom`/`dateTo` opcional (máx. 62 días) |
| `POST` | `/kpis/capital-snapshots/run` | Soporte / backfill `{ "date": "YYYY-MM-DD" }` (default ayer) |
| `GET` | `/purchases/payables` | Detalle deuda (tap desde card) |
| `POST` | `/cash-sessions/:id/close` | Cierre de **este** POS; `capitalPhoto` = foto del día de la tienda |
| `GET` | `/payment-methods` | Catálogo activo para cobro POS |
| `GET` | `/payment-methods/admin` | Admin: todos |
| `POST` | `/payment-methods` | Admin: crear |
| `PATCH` | `/payment-methods/:id` | Admin: % / active / nombre |
| `PATCH` | `/stores/:storeId/business-settings` | `{ "realProfitConfig": { ... } }` fijos/nómina/bolsas |
| `POST` | `/sales` + sync `SALE` | Venta; `payments[].method` = code del catálogo |

### Paso 1 — merma + capital live (**listo**)

```http
POST /api/v1/inventory/losses
{ "productId": "<uuid>", "quantity": "1", "reason": "Podrido", "opId": "<uuid>" }
```

`GET /kpis/snapshot` **ampliado**:

```json
{
  "capital": {
    "inventoryCapital": "5210.21",
    "payablesDue": "800.00",
    "netInventoryEquity": "4410.21",
    "lossCostToday": "0.65"
  },
  "realProfit": {
    "deductions": {
      "losses": { "amount": "0.65", "movementCount": 2 }
    }
  }
}
```

### Paso 2 — crecimiento (serie + foto) — **listo**

```http
GET /api/v1/kpis/capital-series?preset=week
GET /api/v1/kpis/capital-series?preset=month
GET /api/v1/kpis/capital-series?dateFrom=2026-08-01&dateTo=2026-08-14

POST /api/v1/kpis/capital-snapshots/run
{ "date": "2026-08-17" }
```

Serie — `items[]`: `date`, `inventoryCapital`, `payablesDue`, `netInventoryEquity`, `realProfit`, `lossCostFunctional`, `deltaEquity`.

Al **cerrar caja** el back hace upsert de la foto del día (misma fila si hay varios POS). Front no llama `run` en el close; toast opcional.

### Paso 3 — catálogo de pagos — **listo**

```http
GET    /api/v1/payment-methods
GET    /api/v1/payment-methods/admin
POST   /api/v1/payment-methods
PATCH  /api/v1/payment-methods/:id
```

Lista activa (cobro):

```json
{
  "items": [
    { "id": "...", "code": "CASH_USD", "name": "Efectivo USD", "commissionPercent": "0", "isCashLike": true, "active": true, "sortOrder": 10 },
    { "id": "...", "code": "DEBITO_BDV", "name": "Débito Banco de Venezuela", "commissionPercent": "2.1", "isCashLike": false, "active": true, "sortOrder": 30 },
    { "id": "...", "code": "DEBITO_BNC", "name": "Débito BNC", "commissionPercent": "2.0", "isCashLike": false, "active": true, "sortOrder": 40 }
  ]
}
```

PATCH ejemplo: `{ "commissionPercent": "2.5", "active": true }`.  
Snapshot: `realProfit.deductions.paymentCommissions.amount` (+ `paymentCount`).

### Paso 4 — disponible — **listo**

Mismo `GET /kpis/snapshot` → bloque `cashAvailable` (siempre hoy).

`suggestedWithdraw` = `min(max(0, realProfitToday), amount)` ya calculado en el back.

Chip aparte. No inventar patrimonio restando ventas en el cliente.

---

## 9. Checklist Front

### Ya se puede (snapshot + capital)

- [ ] `GET /kpis/snapshot` + `X-Store-Id`
- [ ] Chips today / yesterday / week / month
- [ ] Hero real + expand deducciones
- [ ] Card bruta + `byDay` en week/month
- [ ] Deuda aging + link facturas
- [ ] Stock badges + listas
- [ ] No llamar real “para sacar”
- [ ] Aviso si `timezoneSource === fallback_utc`
- [ ] Tab **Capital**: `GET /kpis/capital-series?preset=week|month`
- [ ] Huecos = `missingDates` (no inventar puntos)
- [ ] **Registrar merma** `POST /inventory/losses`
- [ ] Tras cerrar caja: leer `capitalPhoto`; toast si `ok`; no confundir turno vs tienda

### Cuando Fase 2 (POS) — **listo en back**

- [ ] Admin métodos + %
- [ ] Cobro solo con catálogo + warning comisión
- [ ] Pintar `deductions.paymentCommissions`

### Paso 4 — sacar — **listo en back**

- [ ] Chip “te puedes llevar hoy ~X” = `cashAvailable.suggestedWithdraw`
- [ ] No mezclar con hero de ganancia real

### Extra (no v1)

---

## 10. Pseudocódigo snapshot (hoy)

```dart
final res = await api.get('/kpis/snapshot', query: {'preset': preset});
final currency = res['currencyCode'];
final real = res['realProfit']['realProfit'];
final gross = res['grossProfit']['grossProfit'];
final debt = res['payables']['totalDueFunctional'];
final neg = res['stockAlerts']['negativeCount'];
```
