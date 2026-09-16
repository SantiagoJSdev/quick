# Gastos y mermas — constantes Quick Market

**Para qué sirve:** un solo lugar con **todos los valores** que restan de ganancia real (y los % de comisión).  
Si cambia el alquiler, la luz o el % del punto, se edita **aquí** y en implementación se replica a config/DB. El motor de `realProfit` **se ajusta solo**.

Tienda: `0b54c944-28ba-4542-991a-4840c4801906` · moneda funcional (USD) · zona `America/Caracas`.

**Dónde vive hoy en código:** `src/modules/kpis/gasto-constants.ts` (espejo de este MD) y JSON `BusinessSettings.realProfitConfig`.  
**Dónde vivirá:** mismo JSON (fijos/nómina/bolsas) + tabla `StorePaymentMethod` (comisiones) + `OUT_LOSS` (merma real, no constante).

Editar: cambiar el número en este archivo → backend aplica en seed/PATCH → KPI sin tocar fórmula.

---

## 1. Fijos diarios (ya en ganancia real)

Montos **por día calendario**, moneda funcional.

| Clave | Qué es | USD / día | Notas |
|-------|--------|-----------|--------|
| `fixedDaily.utilities` | Luz / servicios | **1.46** | |
| `fixedDaily.rent` | Alquiler | **2.50** | |
| `fixedDaily.transport` | Transporte | **4.41** | |
| **Suma fijos** | | **8.37** | × `calendarDays` del rango |

---

## 2. Nómina diaria (ya en ganancia real)

| Clave | Nombre | USD / día |
|-------|--------|-----------|
| `employees[0].dailyPay` | Empleado 1 | **11.66** |
| `employees[1].dailyPay` | Empleado 2 | **8.33** |
| `employees[2].dailyPay` | Empleado 3 | **4.16** |
| **Suma nómina** | | **24.15** | × `calendarDays` |

---

## 3. Empaque estimado (ya en ganancia real)

No es merma de inventario: es **estimado** hasta que se venda como línea o se registre merma.

| Clave | Valor | Cómo se usa |
|-------|--------|-------------|
| `bag.productId` | `e63d9367-d5bb-46b5-98e6-85b1d2703b89` | Costo paquete / `packSize` |
| `bag.packSize` | **100** | Bolsas por paquete |
| `bag.ticketCoverageRate` | **0.90** | 90% de tickets = 1 bolsa |
| `charcuterieWrap.unitCost` | **0.025** | USD por unidad vendida de SKUs charcutería |
| `charcuterieWrap.productIds` | lista en código | SKUs que usan plato/film |

---

## 4. Comisiones de pago (Paso 3 — catálogo POS)

**No son constantes diarias:** % sobre el **monto del pago** en funcional. Efectivo = 0.

| code | Nombre UI | `commissionPercent` | `isCashLike` |
|------|-----------|---------------------|--------------|
| `CASH_USD` | Efectivo USD | **0** | true |
| `CASH_VES` | Efectivo VES | **0** | true |
| `DEBITO_BDV` | Débito Banco de Venezuela | **2.1** | false |
| `DEBITO_BNC` | Débito Banco Nacional de Crédito (BNC) | **2.0** | false |
| `PAGO_MOVIL` | Pago Móvil | **0** | false |

Fórmula (por tramo de pago):

```text
commissionFunctional = amountFunctional × (commissionPercent / 100)
```

Split (parte efectivo + parte punto): comisión **solo** en el tramo con %.  
El % vigente se **guarda en el pago** al cobrar (foto), para no reescribir el pasado si mañana cambia el 2.1 → 2.5.

**Cómo cambiar:** editar esta tabla → `PATCH /payment-methods/:id` o seed. Ganancia real resta `Σ comisiones` del rango en `realProfit.deductions.paymentCommissions`.

API: `GET /payment-methods` (activos) · admin `GET/POST/PATCH`.

---

## 5. Merma (no es constante)

Papa podrida, cebolla, etc. **no** van aquí como % fijo.  
Se registran con `POST /inventory/losses` (`OUT_LOSS`) y el costo promedio del día se resta de `realProfit.deductions.losses`.

Si más adelante quieres un **estimado** extra (ej. 0.5% frescos sin registrar), se agrega una fila en §1 o §6.

---

## 6. Pendientes (agregar filas cuando se definan)

| Clave sugerida | Idea | Valor actual |
|----------------|------|----------------|
| `cashShortage` | Faltante al cerrar caja | — (dato real, no constante) |
| `otherPackaging` | Film / bolsa negra / servilleta | — |
| `taxPercent` | Impuesto estimado | — |
| `replenishReservePercent` | % del efectivo neto a no sugerir sacar | **0** (v1; subir si quieren dejar cambio) |

`cashAvailable` (Paso 4):

```text
cashNet = Σ pagos isCashLike (hoy) − abonos proveedores (hoy)
reserve = cashNet × (replenishReservePercent / 100)   // si cashNet > 0
amount  = max(0, cashNet − reserve)
suggestedWithdraw = min(max(0, realProfitHoy), amount)
```

---

## 7. Totales de referencia (1 día, sin ventas)

```text
fijos + nómina = 8.37 + 24.15 = 32.52 USD/día
+ bolsas (según tickets) + platos (según qty) + comisiones (según mix de pago) + merma registrada
= deductions.total
realProfit = grossProfit − deductions.total
```

---

## 8. Cómo actualizar (operación)

Este archivo **entra en la implementación** (`KPI_IMPLEMENTACION_BACK.md` Paso 0). No es solo nota.

1. Cambiar el número **aquí**.  
2. Mismo PR: seed / `real-profit-config.ts` / `PATCH` métodos de pago.  
3. Recargar `GET /kpis/snapshot`.

Contrato Front: [`KPI_FRONTEND.md`](./KPI_FRONTEND.md).  
Pasos backend: [`KPI_IMPLEMENTACION_BACK.md`](./KPI_IMPLEMENTACION_BACK.md).
