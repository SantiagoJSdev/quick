# KPIs pendientes — plan de implementación backend (pasos)

Constantes (alquiler, luz, débitos BDV/BNC): [`KPI_GASTOS_CONSTANTES.md`](./KPI_GASTOS_CONSTANTES.md).  
**Contrato Front v1:** [`KPI_CONTRATO_FRONT.md`](./KPI_CONTRATO_FRONT.md).  
Front (guía UX): [`KPI_FRONTEND.md`](./KPI_FRONTEND.md).  
Detalle de modelo patrimonio: [`KPI_PATRIMONIO_CRECIMIENTO.md`](./KPI_PATRIMONIO_CRECIMIENTO.md).

Orden: cada paso deja API usable. No mezclar “disponible para sacar” en el hero de ganancia real.

**Fuente de verdad de montos/%:** [`KPI_GASTOS_CONSTANTES.md`](./KPI_GASTOS_CONSTANTES.md).  
Si cambia alquiler, luz, nómina o comisión BDV/BNC → **primero ese MD**, luego seed/PATCH. No hardcodear % en el servicio de KPIs.

---

## Ya está (no rehacer)

- `GET /api/v1/kpis/snapshot` — bruta, real (fase 1 + merma + **comisiones**), **capital live**, **cashAvailable**, deuda, stock, TZ Caracas
- `GET /api/v1/kpis/capital-series` — fotos + `deltaEquity` + lazy ayer
- `POST /api/v1/kpis/capital-snapshots/run` — backfill
- `POST /api/v1/inventory/losses` — merma `OUT_LOSS`
- `GET /api/v1/payment-methods` — catálogo activos (POS)
- `GET /api/v1/payment-methods/admin` · `POST` · `PATCH /:id` — CRUD; seed BDV 2.1 / BNC 2.0
- Al cobrar: `SalePayment.commissionFunctional` (foto del %)
- Constantes en `src/modules/kpis/gasto-constants.ts` (= `KPI_GASTOS_CONSTANTES.md`)
- `PATCH /api/v1/stores/:storeId/business-settings` — acepta `realProfitConfig`
- Cierre de caja `POST /api/v1/cash-sessions/:id/close` — upsert foto de patrimonio del día (`capitalPhoto`)

---

## Paso 0 — Meter `KPI_GASTOS_CONSTANTES.md` en el sistema — **hecho**

| # | Backend |
|---|---------|
| 0.1–0.3 | `gasto-constants.ts` + defaults + migration alinea JSON Quick Market |
| 0.4 | `GASTO_PAYMENT_METHODS` listo para seed Paso 3 (`DEBITO_BDV` 2.1 / `DEBITO_BNC` 2.0) |
| 0.5 | Reserva reposición: `GASTO_REPLENISH_RESERVE_PERCENT` = 0 (Paso 4) |

## Paso 1 — Merma + capital live — **hecho**

**Objetivo:** registrar merma (papa/cebolla) y ver capital **ahora** en el mismo snapshot.

| # | Backend |
|---|---------|
| 1.1 | `POST /api/v1/inventory/losses` → `OUT_LOSS`, baja qty + costo promedio, `opId` |
| 1.2 | `realProfit.deductions.losses` = Σ `OUT_LOSS.totalCostFunctional` del rango |
| 1.3 | Bloque `capital` en `GET /kpis/snapshot`: `inventoryCapital`, `payablesDue`, `netInventoryEquity`, `lossCostToday` |

**Front:** botón merma; pintar `capital` + `deductions.losses`.

---

## Paso 2 — Foto diaria + serie (crecimiento) — **hecho**

**Objetivo:** gráfica semana/mes; 1 fila por tienda por día Caracas.

| # | Backend |
|---|---------|
| 2.1 | Modelo `StoreCapitalSnapshot` + migration |
| 2.2 | Servicio upsert (inv, deuda, realProfit del día, merma, compras, abonos) |
| 2.3 | `POST /api/v1/kpis/capital-snapshots/run` body `{ date? }` — idempotente |
| 2.4 | `GET /api/v1/kpis/capital-series?preset=week\|month\|dateFrom&dateTo` |
| 2.5 | Lazy: al pedir serie, si falta **ayer**, crear foto (`source=LAZY`, no pisa CASH_CLOSE) |
| 2.6 | Hook: `POST /cash-sessions/:id/close` OK → upsert **misma** foto del día. Varios POS = reescribe. Fallo snapshot **no** revierte el cierre |

**Front:** tab Capital, chips 7d/mes/fechas, huecos = `missingDates`, toast si `capitalPhoto.ok`.

---

## Paso 3 — Métodos de pago + comisiones — **hecho**

**Objetivo:** débito BDV 2.1% y débito BNC 2% restan de ganancia real. Valores: [`KPI_GASTOS_CONSTANTES.md`](./KPI_GASTOS_CONSTANTES.md) §4.

| # | Backend |
|---|---------|
| 3.1 | Tabla `StorePaymentMethod` (code, name, commissionPercent, isCashLike, active) |
| 3.2 | Seed: `CASH_USD/VES` 0%, `DEBITO_BDV` 2.1, `DEBITO_BNC` 2.0 |
| 3.3 | `GET /api/v1/payment-methods` (activos) · admin `GET/POST/PATCH` |
| 3.4 | Al cobrar: guardar `commissionFunctional` en el pago (foto del %) |
| 3.5 | `realProfit.deductions.paymentCommissions` |

**Front:** POS cobra con catálogo; warning si % > 0; pintar comisión en desglose.

---

## Paso 4 — Disponible para sacar (último) — **hecho**

**Objetivo:** tope de **caja**, no de inventario. `sugerido = min(realProfitHoy, cashAvailable)`.

| # | Backend |
|---|---------|
| 4.1 | Efectivo `isCashLike` − abonos del día − reserva (`GASTO_REPLENISH_RESERVE_PERCENT`, v1 = **0**) |
| 4.2 | Bloque `cashAvailable` en snapshot (siempre **hoy**) + `cashBalanceEst` / `cashAvailableEst` en foto diaria |
| 4.3 | No registra el retiro del dueño en v1 (solo número guía) |

**Front:** chip aparte, nunca reemplaza el hero real. Leer `cashAvailable.suggestedWithdraw`.

---

## Paso 5 — Extra (no hace falta para v1)

La foto **no depende de un cron**. La hace el **cierre de caja** (Paso 2.6): cada POS que cierra **reescribe** la misma fila del día.

Opcional más adelante: alertas “3 días Δ &lt; 0”, faltante de caja, UI admin de `realProfitConfig`. Cron nocturno **solo** si un día nadie cierra caja.

---

## Criterio de “listo” por paso

| Paso | Prueba rápida |
|------|----------------|
| 0 | MD constantes = `gasto-constants.ts` + `realProfitConfig` Quick Market | **Hecho** |
| 1 | Merma 1 kg → stock baja y real del día baja ese costo; `capital.netInventoryEquity` visible | **Hecho** |
| 2 | Cerrar 2 cajas el mismo día → **una** fila snapshot; serie week trae puntos | **Hecho** |
| 3 | Venta 100$ en `DEBITO_BDV` → comisión 2.10 en deductions | **Hecho** |
| 4 | Chip ≤ efectivo y ≤ realProfit | **Hecho** |
