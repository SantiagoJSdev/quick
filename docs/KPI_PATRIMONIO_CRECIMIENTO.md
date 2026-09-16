# KPI patrimonio / crecimiento de capital — plan de implementación

**Objetivo:** saber día a día y semana a semana si el capital del negocio **crece o se erosiona**, alineado con **ganancia real** (si sumamos gastos/mermas/comisiones al KPI real, se refleja).

**Front (único):** [`KPI_FRONTEND.md`](./KPI_FRONTEND.md).  
Pasos código: [`KPI_IMPLEMENTACION_BACK.md`](./KPI_IMPLEMENTACION_BACK.md).  
Constantes: [`KPI_GASTOS_CONSTANTES.md`](./KPI_GASTOS_CONSTANTES.md).

---

## 0. En cristiano: ¿qué es P0 y P1?

| Nombre técnico | Qué es en la práctica |
|----------------|------------------------|
| **P0 — “live”** | Lo de **ahora**: cuánto capital tienes hoy (inventario − deuda), merma del día restada en ganancia real. **Sin historial** aún. |
| **P1 — “fotos + gráfica”** | Cada día se guarda una **foto** (`StoreCapitalSnapshot`). El front pide 7 días / mes / fechas y ve si creces. |

**P0 + P1 juntos** = en el mismo trabajo de backend entregamos: capital de hoy + merma + guardar fotos + endpoint de serie para el front.

### ¿Cómo se calcula / guarda la foto del día? (ideas, no solo cron)

El número de la foto = inventario a costo + deuda + ganancia real de **ese** día (mismo motor).  
La pregunta es **cuándo** se escribe la fila del día:

| Idea | Cómo | Pros | Contras |
|------|------|------|---------|
| **A. Lazy al consultar** | La primera vez que pides `capital-series` o `snapshot` y falta la foto de **ayer**, el backend la calcula y la guarda | Sin servidor cron; simple en Neon/Render | Si nadie abre la app un día, la foto se crea al día siguiente al abrir |
| **B. Al cerrar caja** | Al `POST cash-sessions/:id/close`, dispara snapshot del día | Encaja con operación real del minimarket | Si no cierran caja, no hay foto |
| **C. Botón / run manual** | `POST /kpis/capital-snapshots/run` (dueño o soporte) | Control total; backfill | Hay que acordarse |
| **D. Cron** | No forma parte de v1 | — | Solo si un día nadie cierra caja |

**Acordado v1 — la foto la dispara el cierre de caja (no un cron):**

- **B (principal):** al `POST /cash-sessions/:id/close` OK → **upsert** `StoreCapitalSnapshot` del **día Caracas de la tienda**.  
  - 1 foto por **tienda + día**, no por device.  
  - Varios POS el mismo día: **cada cierre reescribe la misma fila**.  
  - Si el upsert falla, el **cierre de caja no se revierte**.  
- **A (respaldo):** lazy al pedir serie si nadie cerró (falta foto de ayer).  
- **C (soporte):** `POST /kpis/capital-snapshots/run`.  
- **D (cron):** **no** forma parte del flujo; solo si más adelante un día nadie cierra.

La foto “oficial” del día = **último cierre de caja** de esa fecha.

---

## 1. KPIs (mapa)

| KPI | Pregunta | Cuándo |
|-----|----------|--------|
| **Ganancia real** | ¿Cuánto me gané hoy tras gastos/merma/comisiones? | Ya + mejoras |
| **Patrimonio** | ¿Crece mi capital (inv − deuda [+ caja])? | P0/P1 |
| **Disponible para sacar** | ¿Cuánto me puedo llevar hoy sin joder el negocio? | Incluido en el plan (después de fotos base) |

Flujo dueño: diario retirar ≈ ganancia real sin tumbar capital; semana decide si **inyecta** parte al capital.

---

## 2. Modelo `StoreCapitalSnapshot`

Una **foto por tienda por día calendario** (`Store.timezone`, Quick Market = `America/Caracas`).

```prisma
model StoreCapitalSnapshot {
  id     String   @id @default(uuid())
  storeId String
  store   Store   @relation(...)
  /// Día local YYYY-MM-DD (Caracas)
  date   DateTime @db.Date

  inventoryCapital     Decimal  // Σ totalCostFunctional qty>0 activos
  payablesDue          Decimal  // deuda abierta RECEIVED
  netInventoryEquity   Decimal  // inventory − payables

  netSales             Decimal
  cogs                 Decimal
  grossProfit          Decimal
  realProfit           Decimal  // mismo motor que /kpis/snapshot ese día
  realProfitDeductions Json?    // copia del desglose (bolsas, nómina, mermas…)

  purchasesFunctional  Decimal  // compras del día
  supplierPayments     Decimal  // abonos del día (no revertidos)
  lossCostFunctional   Decimal  // Σ OUT_LOSS del día (merma)
  paymentCommissions   Decimal? // Σ comisiones métodos de pago del día

  cashBalanceEst       Decimal? // fase caja
  cashAvailableEst     Decimal? // “disponible para sacar” estimado al cierre

  capturedAt DateTime @default(now())
  source     String   @default("AUTO") // AUTO | MANUAL

  @@unique([storeId, date])
  @@index([storeId, date])
}
```

### Qué es inmutable vs qué se puede recalcular

| Campo | Política |
|-------|----------|
| `inventoryCapital`, `payablesDue` | **Foto** al cierre (no reescribir el pasado) |
| `realProfit` + deducciones | Guardado al cierre **y** recalculable al leer serie si cambia `realProfitConfig` o llegan mermas con fecha |
| Serie al front | Preferir: balance desde snapshot; `realProfit` **recomputado** por día con el motor actual (así “ajustamos el KPI” y la serie se alinea) |

Así: agregas merma o un gasto nuevo en config → la gráfica de ganancia real de esa semana **se actualiza**; el patrimonio de días cerrados conserva la foto de inventario/deuda de ese día.

---

## 3. Merma — qué sugerimos (papa 1 kg, cebolla 0.5 kg)

### No hacer

- Campo fijo `merma` en `Product` → no hay historial, ni día, ni costo, ni auditoría.
- Tabla `Merma` **desconectada** del stock → inventario y KPI se desalinean.

### Sí hacer (recomendado)

Usar el tipo que **ya existe** en Prisma: `StockMovementType.OUT_LOSS`.

```text
Front: producto → “Registrar merma”
  qty + motivo (+ opcional occurredAt)
    → POST /inventory/losses  (o adjustments type OUT_LOSS)
      1) Baja InventoryItem (qty + totalCost)
      2) Crea StockMovement OUT_LOSS con unitCost = avg actual
      3) realProfit del día resta Σ totalCostFunctional de OUT_LOSS
      4) Patrimonio “ahora” baja solo; al correr snapshot del día queda registrado lossCostFunctional
```

| Opción | Veredicto |
|--------|-----------|
| Solo `OUT_ADJUST` genérico | Funciona, pero mezcla ajuste de conteo con merma |
| **`OUT_LOSS` dedicado** | Correcto: reportes y realProfit filtran limpio |
| Tabla `StockLoss` + movimiento | Solo si luego quieres fotos/motivo estructurado; **P1 no hace falta** |

**UI front:** en ficha de producto / inventario, botón **Registrar merma** (qty, unidad, motivo: podrido / vencido / rotura). No un campo permanente en el catálogo.

Ejemplo: papa 1 kg × costo avg 0.40 = **0.40**; cebolla 0.5 × 0.50 = **0.25** → **−0.65** en `realProfit.deductions.losses` y −0.65 en capital de inventario.

---

## 4. Alineación ganancia real ↔ patrimonio

```text
                    ┌─────────────────────┐
  Ventas del día ──►│  Motor realProfit   │──► realProfit (serie / snapshot)
  Config gastos  ──►│  (único)            │
  OUT_LOSS día   ──►└──────────┬──────────┘
                               │
  Inventory ahora ─────────────┼──► capital “live” en /kpis/snapshot
  Payables ahora  ─────────────┘
                               │
                    Job cierre día
                               ▼
                    StoreCapitalSnapshot
```

1. **Un solo motor** de `realProfit` (el de hoy + merma `OUT_LOSS`).
2. Snapshot copia resultados del día + foto inv/deuda.
3. Si mañana cambias config (ej. más nómina), la **serie** puede recomputar `realProfit` por día; la foto de inventario de días pasados no se inventa.

---

## 5. Plan de implementación (backend) — alcance ampliado

### Fase 1 — Capital live + merma + fotos (el “crecimiento”)

| # | Tarea |
|---|--------|
| 1.1 | Bloque `capital` en `GET /kpis/snapshot` |
| 1.2 | `POST /inventory/losses` → `OUT_LOSS` + deducir en `realProfit.deductions.losses` |
| 1.3 | Tabla `StoreCapitalSnapshot` + `POST .../run` + lazy al pedir serie |
| 1.4 | `GET /kpis/capital-series?preset=week\|month\|dateFrom&dateTo` |
| 1.5 | Hook en `POST /cash-sessions/:id/close`: upsert foto del día (tienda); varios devices = misma fila |

### Fase 2 — Métodos de pago + comisiones (POS)

Ver **[`KPI_FRONTEND.md`](./KPI_FRONTEND.md)** §6 (POS / comisiones; endpoints se irán pegando ahí).

| # | Tarea |
|---|--------|
| 2.1 | Tabla `StorePaymentMethod` (code, % comisión, isCashLike) |
| 2.2 | CRUD + seed efectivo 0% / tarjeta con % |
| 2.3 | Al vender: calcular y guardar comisión en el pago |
| 2.4 | `realProfit.deductions.paymentCommissions` |
| 2.5 | Front POS: catálogo + warning si hay comisión |

### Fase 3 — Caja en patrimonio + disponible para sacar

```text
disponible_para_sacar ≈
  efectivo_cobrado (métodos isCashLike)
  − abonos a proveedores del día
  − reserva reposición (config %)
  − (opcional) tope para no dejar caja en 0
```

| # | Tarea |
|---|--------|
| 3.1 | Estimar caja / cash en snapshot (`cashBalanceEst`) |
| 3.2 | Bloque `cashAvailable` en `/kpis/snapshot` (diario) |
| 3.3 | Regla: no sugerir sacar más que `min(realProfit, cashAvailable)` |
| 3.4 | Front: chip “te puedes llevar hoy ~X” sin tumbar capital |

### Fase 4 — Extra (no v1)

Alertas 3 días Δ patrimonio &lt; 0. Sin cron: la foto ya sale al cerrar caja.

---

## 6. Endpoints (contrato objetivo)

### Live (ya / ampliar snapshot)

```http
GET /api/v1/kpis/snapshot?preset=today
→ … capital: { inventoryCapital, payablesDue, netInventoryEquity, lossCostToday }
→ … realProfit.deductions.losses
```

### Serie (filtros que pide el front)

```http
GET /api/v1/kpis/capital-series?preset=week
GET /api/v1/kpis/capital-series?preset=month
GET /api/v1/kpis/capital-series?dateFrom=2026-08-01&dateTo=2026-08-14
Header: X-Store-Id
```

| Query | |
|-------|--|
| `preset` | `week` (últimos 7 días calendario tienda) \| `month` \| (opcional `last14`) |
| `dateFrom` / `dateTo` | Rango custom `YYYY-MM-DD` en zona tienda (máx. 62 días) |

Respuesta: `{ timezone, from, to, items: [{ date, inventoryCapital, payablesDue, netInventoryEquity, realProfit, lossCostFunctional, deltaEquity }] }`

### Cierre de caja (dispara foto)

```http
POST /api/v1/cash-sessions/:id/close
→ 200 caja cerrada
→ side-effect: upsert StoreCapitalSnapshot(storeId, date=hoy Caracas)
```

Varios cierres el mismo día = **update** de la misma foto, no filas extra.

### Cierre / job manual

```http
POST /api/v1/kpis/capital-snapshots/run
Body: { "date": "2026-08-14" }  // opcional; default = ayer Caracas
```

### Merma

```http
POST /api/v1/inventory/losses
{ "productId", "quantity", "reason", "opId?" }
```

---

## 7. Orden de trabajo sugerido

1. Fase 1: merma + capital live + fotos + serie (crecimiento).  
2. Fase 2: métodos de pago + comisiones (doc POS listo).  
3. Fase 3: caja + disponible para sacar (`min(realProfit, cashAvailable)`).  
4. Extra: alertas (sin cron).

---

## 9. Qué más suele faltar (visión profesional)

Con **ganancia real + merma OUT_LOSS + patrimonio (inv − deuda) + compras crédito** ya cubres el núcleo.

### Prioridad acordada (producto)

```text
1. P0/P1  Patrimonio + merma + fotos StoreCapitalSnapshot
2.        Mejoras a ganancia real (comisiones banco/tarjeta, etc.)
          → realProfit cambia → serie/patrimonio que lean ese motor se alinean solos
3. ÚLTIMO Disponible para sacar (liquidez / “¿cuánto retiro?”)
```

**Modelo de dueño (Quick Market) — intención de producto:**

```text
DIARIO
  1) Miro ganancia real del día
  2) Puedo RETIRAR esa ganancia (plata personal) sin comer el capital
     del negocio (inventario − deuda debe mantenerse sano)
  3) El KPI debe avisarme si retirar “toda” la realProfit del día
     sí perjudicaría el capital / la caja operativa

SEMANA (acumulado de ganancia real)
  4) Veo cuánto gané en la semana (y/o cuánto ya me llevé)
  5) Decido si INYECTO parte de eso al capital del negocio
     (reposición, bajar deuda, dejar stock) o no
```

En otras palabras:  
- **Día** = cobrar tu utilidad sin descapitalizar.  
- **Semana** = ¿le devuelvo algo de esa utilidad al capital?  

Por eso conviven tres ideas:

| Idea | Rol |
|------|-----|
| `realProfit` diario | Tope / referencia de “qué me gané hoy” |
| Patrimonio (inv − deuda) + Δ | ¿El capital se mantuvo al retirarme la ganancia? |
| Disponible para sacar (después) | Freno de seguridad: a veces la caja no permite sacar toda la realProfit sin dejar el negocio corto |

Si cada día te llevas ≈ ganancia real y el patrimonio **no baja**, el modelo funciona.  
Si realProfit + pero patrimonio − → te estás llevando de más o hay merma/compras/deuda no cubiertas.



### A — Después del patrimonio (mejoras a ganancia real)

| Dato | Cómo | Efecto |
|------|------|--------|
| **Comisiones punto / transfer / tarjeta** | Deducir en `realProfit` | Al subir en el motor, capital-series que guarda/recomputa `realProfit` **se ajusta solo** |
| **Faltante de caja** al cierre | Ítem en deducciones realProfit | Igual |
| **Merma OUT_LOSS** | Ya en P0 | Baja real + baja inventario |

### B — Contexto en el snapshot (no KPI héroe)

| Dato | Uso |
|------|-----|
| Compras del día | Explica por qué subió inventario / deuda |
| Abonos a proveedores | Explica baja de deuda / salida de caja |
| Ventas / COGS | Ya en gross / real |
| Aging deuda | Riesgo, no “ganancia” |

No construyas una pantalla aparte “compras vs ventas” como decisión diaria. Bastan dos líneas en el detalle del día / de la semana.

### C — Último: disponible para sacar

Solo cuando patrimonio + realProfit (con comisiones/merma) estén estables.  
Responde “¿cuánto puedo retirar esta semana sin comer capital?” — encaja con tu idea de **acumular la semana y luego dejar o sacar**.

### D — Nice-to-have

Margen %, rotación, alertas 3 días Δ &lt; 0, aportes del dueño, etc.

### Scorecard (orden de lectura dueño)

```text
1. Ganancia real del día              ← “esto me puedo llevar hoy (referencia)”
2. Patrimonio neto + Δ                ← “¿al llevármela, el capital se mantuvo?”
3. Ganancia real acumulada 7 días     ← “qué junté en la semana”
4. Decisión semanal: ¿inyecto al capital?
5. (después) Disponible para sacar    ← tope seguro de caja si realProfit > liquidez
```

### Errores a evitar

1. Meter “disponible para sacar” dentro de ganancia real.  
2. Igualar realProfit del día a Δ patrimonio del mismo día.  
3. Tomar decisiones diarias de retiro sin mirar patrimonio semanal.  
4. No registrar merma (infla ganancia real).
