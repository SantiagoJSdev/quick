# Proyección de pedidos por proveedor y distribución diaria de caja (ganancia, insumos, reposición y abono a facturas)

## 1. Problema (enunciado claro)

El minimarket necesita **dos proyecciones operativas** que hoy se hacen “a ojo” y conviene sistematizar:

### A) Proyección de compra / pedido por proveedor

A partir de lo vendido en una ventana (típicamente la última semana), por producto y por proveedor, saber:

- cuántas **unidades** se vendieron;
- cuántos **kilos** se vendieron (charcutería, carne, pollo, etc.);
- cuánto **conviene pedir** para la próxima semana (o para el próximo ciclo de pago), con un **colchón** (+X% o −X%) como hacen muchas tiendas retail/minimarket;
- ordenado por **proveedor**, porque el pedido y el pago se negocian por proveedor, no por producto suelto.

### B) Distribución diaria del dinero de la venta

El local vende **todos los días** (orden de magnitud ~USD 600–750/día). De lunes a viernes se pagan proveedores y, en la práctica, también se cubren nómina/obligaciones.

Cada día se quiere partir la venta en “bolsillos” controlados, por ejemplo:

| Concepto | Ejemplo del usuario (lunes) |
|---|---|
| Venta del día | $580 |
| Ganancia bruta estimada | $85 |
| Merma + plásticos/bolsas/emboplas charcutería | $10 |
| Ganancia neta operativa del día | $75 |
| Reserva insumos (bolsas/plásticos) | $10 |
| Queda de la venta para destinar | $495 |
| → Reposición de mercancía (contado / rotación rápida) | $200 |
| → Abono a facturas a crédito / cuentas por pagar | $295 |

Además hay **variables distintas por tipo de compra**:

| Categoría | Ejemplo | Forma de pago |
|---|---|---|
| Huevos / charcutería | 2 proveedores distintos | Uno a **crédito**, otro de **contado** |
| Verduras (papa, cebolla, etc.) | Frescos | **Contado** |
| Carne y pollo | Frescos | **Contado** |
| Resto de abarrotes | Mixto | Crédito o contado según proveedor |

El objetivo no es solo “ver reportes”, sino **llegar al día de pago con dinero ya separado** (reposición + abonos + insumos) y sin mezclar ganancia operativa con caja de proveedores.

---

## 2. ¿Hay que meter IA, o alcanza con SQL / reglas?

**Respuesta corta:** para el 80–90% de este problema **no hace falta IA**. Con SQL + parámetros configurables (porcentajes, categorías, modo de pago del proveedor) se resuelve bien y es auditable.

| Enfoque | Qué resuelve bien | Qué no resuelve solo | Cuándo usarlo |
|---|---|---|---|
| **Solo SQL / reportes** | Ventas por proveedor/unidad/kg; stock; margen del día; ranking de rotación | No “decide” sola el % de colchón ni distingue crédito/contado si no hay datos | Fase 1 (ya) |
| **SQL + reglas de negocio** | Pedido sugerido = vendido × (1 + buffer%); distribución de caja por % fijos o por buckets | No detecta estacionalidad rara ni eventos especiales | Fase 2 (recomendado) |
| **IA (opcional, después)** | Ajustar buffer por día/feriado/clima; sugerir mix si hay muchas excepciones; explicar anomalías | Costo, opacidad, riesgo de overfit con poca historia | Fase 3, solo si las reglas no bastan |

### Recomendación

1. **Fase 1 — Solo SQL:** queries de venta semanal por proveedor (unidades vs kg) + ganancia del día.
2. **Fase 2 — Reglas parametrizadas en backend** (sin IA): `pedido_sugerido`, `buckets` de caja, flags `paymentMode` del proveedor / categoría de producto.
3. **Fase 3 — IA ligera (opcional):** solo para afinar el buffer o alertar “esta semana se vendió atípico vs 8 semanas”.

No bloquear el negocio esperando un modelo: el ejemplo del usuario ($580 → $85 → $10 → $75 / $10 / $200 / $295) es **aritmética + política de %**, no machine learning.

---

## 3. Proyección A — Pedido sugerido por proveedor

### 3.0 Fases de entrega (A)

| Fase | Qué es | Estado |
|---|---|---|
| **A1 — SQL Neon** | Query manual con reglas fijas (este documento) | **Activa — lista para correr** |
| **A2 — API para el front** | Mismo cálculo expuesto como endpoint (ej. `GET /reports/suggested-orders`) para listar por proveedor en la app | Pendiente (después de validar A1) |
| **A3 — IA (futuro)** | Ajustar buffer o demanda atípica; no reemplaza la fórmula base | Más adelante |

### 3.1 Decisiones cerradas (respuestas del negocio)

| # | Tema | Decisión |
|---|---|---|
| 1 | Ventana | **Semana completa** (lunes 00:00 → domingo 24:00 / lunes siguiente exclusive) |
| 2 | Qué semana | **Semana anterior** a la fecha del cálculo (`now()` en Caracas) |
| 3 | Zona horaria | `America/Caracas` |
| 4–5 | Fórmula | `cobertura_cruda = qty_neta × 1.10`; **restar stock actual** |
| — | Unidades enteras | En **UNIDAD**: `cobertura_deseada = CEIL(cobertura_cruda)` (ej. 2 × 1.10 = 2.2 → **3**). En **PESO** se mantienen decimales |
| — | Pedido vs reposición | `pedido_sugerido` = brecha vs stock (puede ser 0). `reposicion_vendido` = vendido×1.10 **sin restar stock** (ej. Huevo: vendió 3, stock 8 → pedido 0, reposición **4**) |
| — | Pedido en unidades | `pedido_sugerido` también en enteros (`CEIL`) para UNIDAD; nadie pide 0.2 botellas |
| — | Stock final | `stock_final = stock_disponible + pedido_sugerido` |
| 6 | Si ya hay cobertura | `pedido_sugerido = 0` |
| 7 | Kilos vs unidades | Por `Product.unit`: si contiene `kg` / `kilo` → **PESO**; si no → **UNIDAD** (default schema: `unidad`) |
| 8 | Filas | **Una fila por producto**; la columna `tipo_medida` identifica kilo o unidad |
| 9 | Tienda | `0b54c944-28ba-4542-991a-4840c4801906` |
| 10 | Productos | Solo `active = true` |
| 11 | Devoluciones | Se **restan** del mismo período (`SaleReturn` / `SaleReturnLine`, status `CONFIRMED`) |
| 12 | Sin ventas | Incluir si stock bajo: **&lt; 5** (unidad) o **&lt; 3** (kg). En ese caso el pedido mínimo lleva el stock hasta el umbral |
| 13 | Status venta | Solo `Sale.status = 'CONFIRMED'` (valor que escribe el backend) |
| 14 | Salida | Una fila por producto, **ordenada / agrupada por proveedor** |
| 15 | Sin proveedor | Al **final** |
| 16 | Costos | Incluir `costo_unitario`, cantidades y `costo_pedido_sugerido` |
| 17 | Buffer | **+10% para todos**; en unidades el % se **redondea hacia arriba** a la siguiente unidad completa |

### 3.2 Fórmula (A1)

```text
qty_vendida           = Σ SaleLine.quantity          (ventas CONFIRMED, semana anterior)
qty_devuelta          = Σ SaleReturnLine.quantity    (devoluciones CONFIRMED, misma semana)
qty_neta              = qty_vendida - qty_devuelta

es_peso               = unit ILIKE '%kg%' OR unit ILIKE '%kilo%'
stock_disponible      = InventoryItem.quantity - reserved   (0 si no hay fila)

cobertura_cruda       = qty_neta × 1.10

-- UNIDAD: el 10% que no complete una unidad se redondea HACIA ARRIBA (CEIL)
--   ej. 2 × 1.10 = 2.2 → cobertura_deseada = 3
--   ej. 10 × 1.10 = 11.0 → cobertura_deseada = 11
-- PESO: se dejan decimales (kg)
cobertura_deseada     = si es_peso entonces cobertura_cruda
                        sino si qty_neta <= 0 entonces 0
                        sino CEIL(cobertura_cruda)

pedido_por_venta      = max(0, cobertura_deseada - stock_disponible)
                        si UNIDAD → CEIL(pedido_por_venta)   -- pedido en enteros
                        si PESO   → pedido_por_venta         -- puede ser decimal

umbral_stock_bajo     = 3 si es_peso else 5
pedido_stock_bajo     = si qty_neta = 0 y stock_disponible < umbral
                          entonces max(0, umbral - stock_disponible)
                          (si UNIDAD → CEIL)
                        sino 0

pedido_sugerido       = max(pedido_por_venta, pedido_stock_bajo)
                        -- "¿cuánto me falta para cubrir la semana?" (resta stock)

reposicion_vendido    = cobertura_deseada
                        -- "¿cuánto reponer de lo vendido +10%?" (NO resta stock)
                        -- Catón Huevo: vendió 3, stock 8 → pedido_sugerido=0, reposicion_vendido=4

stock_final           = stock_disponible + pedido_sugerido
costo_pedido_sugerido = pedido_sugerido × Product.cost
costo_reposicion      = reposicion_vendido × Product.cost
```

Ejemplos UNIDAD:

| qty_neta | cobertura / reposición | stock | pedido_sugerido | reposicion_vendido |
|---:|---:|---:|---:|---:|
| 2 | 3 | 0 | 3 | 3 |
| 2 | 3 | 2 | 1 | 3 |
| 2 | 3 | 3 | 0 | 3 |
| 3 | 4 | 8 | **0** | **4** |
| 10 | 11 | 5 | 6 | 11 |

### 3.3 Query Neon (Fase A1) — lista para pegar

Calcula sola la **semana calendario anterior** (lun–dom) en `America/Caracas`. No hace falta poner fechas a mano.

```sql
-- Proyección A1: pedido sugerido por producto / proveedor
-- Tienda: 0b54c944-28ba-4542-991a-4840c4801906
-- Semana: anterior completa (lun 00:00 → lun siguiente 00:00) America/Caracas
-- Buffer: +10%  |  UNIDAD: CEIL a unidad completa  |  PESO: decimales OK
-- Sale.status = CONFIRMED  |  active = true

WITH params AS (
  SELECT
    -- IDs son text en Postgres (Prisma String), NO usar ::uuid (rompe el JOIN → stock 0 / error)
    '0b54c944-28ba-4542-991a-4840c4801906'::text AS store_id,
    1.10::numeric AS buffer_factor,
    5::numeric AS umbral_unidades,
    3::numeric AS umbral_kg
),
bounds AS (
  SELECT
    (
      date_trunc(
        'week',
        (NOW() AT TIME ZONE 'America/Caracas')
      ) - INTERVAL '7 days'
    ) AT TIME ZONE 'America/Caracas' AS start_at,
    (
      date_trunc(
        'week',
        (NOW() AT TIME ZONE 'America/Caracas')
      )
    ) AT TIME ZONE 'America/Caracas' AS end_at
),
sold AS (
  SELECT
    sl."productId",
    SUM(sl.quantity) AS qty_vendida
  FROM "SaleLine" sl
  JOIN "Sale" sa ON sa.id = sl."saleId"
  CROSS JOIN params p
  CROSS JOIN bounds b
  WHERE sa."storeId" = p.store_id
    AND sa.status = 'CONFIRMED'
    AND sa."createdAt" >= b.start_at
    AND sa."createdAt" <  b.end_at
  GROUP BY sl."productId"
),
returned AS (
  SELECT
    srl."productId",
    SUM(srl.quantity) AS qty_devuelta
  FROM "SaleReturnLine" srl
  JOIN "SaleReturn" sr ON sr.id = srl."saleReturnId"
  CROSS JOIN params p
  CROSS JOIN bounds b
  WHERE sr."storeId" = p.store_id
    AND sr.status = 'CONFIRMED'
    AND sr."createdAt" >= b.start_at
    AND sr."createdAt" <  b.end_at
  GROUP BY srl."productId"
),
demand AS (
  SELECT
    COALESCE(s."productId", r."productId") AS product_id,
    COALESCE(s.qty_vendida, 0) AS qty_vendida,
    COALESCE(r.qty_devuelta, 0) AS qty_devuelta,
    COALESCE(s.qty_vendida, 0) - COALESCE(r.qty_devuelta, 0) AS qty_neta
  FROM sold s
  FULL OUTER JOIN returned r ON r."productId" = s."productId"
),
inventory AS (
  SELECT
    i."productId",
    i.quantity,
    i.reserved,
    (COALESCE(i.quantity, 0) - COALESCE(i.reserved, 0)) AS stock_disponible
  FROM "InventoryItem" i
  CROSS JOIN params p
  WHERE i."storeId" = p.store_id
),
candidates AS (
  SELECT d.product_id
  FROM demand d
  UNION
  SELECT i."productId"
  FROM inventory i
  JOIN "Product" pr ON pr.id = i."productId"
  CROSS JOIN params p
  WHERE pr.active = true
    AND (
      CASE
        WHEN pr.unit ILIKE '%kg%' OR pr.unit ILIKE '%kilo%'
          THEN i.stock_disponible < p.umbral_kg
        ELSE i.stock_disponible < p.umbral_unidades
      END
    )
),
base AS (
  SELECT
    pr.id AS product_id,
    pr."supplierId",
    pr.sku,
    pr.barcode,
    pr.name AS producto,
    pr.unit AS unidad,
    pr.cost AS costo_unitario,
    CASE
      WHEN pr.unit ILIKE '%kg%' OR pr.unit ILIKE '%kilo%' THEN 'PESO'
      ELSE 'UNIDAD'
    END AS tipo_medida,
    CASE
      WHEN pr.unit ILIKE '%kg%' OR pr.unit ILIKE '%kilo%' THEN p.umbral_kg
      ELSE p.umbral_unidades
    END AS umbral,
    COALESCE(d.qty_vendida, 0) AS qty_vendida,
    COALESCE(d.qty_devuelta, 0) AS qty_devuelta,
    COALESCE(d.qty_neta, 0) AS qty_neta,
    (inv."productId" IS NOT NULL) AS tiene_fila_inventario,
    inv.quantity AS stock_quantity,
    inv.reserved AS stock_reserved,
    COALESCE(inv.stock_disponible, 0) AS stock_disponible,
    COALESCE(d.qty_neta, 0) * p.buffer_factor AS cobertura_cruda,
    CASE
      WHEN pr.unit ILIKE '%kg%' OR pr.unit ILIKE '%kilo%'
        THEN COALESCE(d.qty_neta, 0) * p.buffer_factor
      WHEN COALESCE(d.qty_neta, 0) <= 0
        THEN 0
      ELSE CEIL(COALESCE(d.qty_neta, 0) * p.buffer_factor)
    END AS cobertura_deseada
  FROM candidates c
  JOIN "Product" pr ON pr.id = c.product_id
  CROSS JOIN params p
  LEFT JOIN demand d ON d.product_id = pr.id
  LEFT JOIN inventory inv ON inv."productId" = pr.id
  WHERE pr.active = true
),
calc AS (
  SELECT
    b.*,
    CASE
      WHEN b.tipo_medida = 'UNIDAD' THEN
        CEIL(
          GREATEST(
            GREATEST(0, b.cobertura_deseada - b.stock_disponible),
            CASE
              WHEN b.qty_neta = 0 AND b.stock_disponible < b.umbral
                THEN GREATEST(0, b.umbral - b.stock_disponible)
              ELSE 0
            END
          )
        )
      ELSE
        GREATEST(
          GREATEST(0, b.cobertura_deseada - b.stock_disponible),
          CASE
            WHEN b.qty_neta = 0 AND b.stock_disponible < b.umbral
              THEN GREATEST(0, b.umbral - b.stock_disponible)
            ELSE 0
          END
        )
    END AS pedido_sugerido
  FROM base b
)
SELECT
  (SELECT start_at FROM bounds) AS periodo_inicio,
  (SELECT end_at   FROM bounds) AS periodo_fin,
  COALESCE(sup.name, '(Sin proveedor)') AS proveedor,
  c.product_id,
  c.sku,
  c.barcode,
  c.producto,
  c.unidad,
  c.tipo_medida,
  ROUND(c.qty_vendida::numeric, 3) AS qty_vendida,
  ROUND(c.qty_devuelta::numeric, 3) AS qty_devuelta,
  ROUND(c.qty_neta::numeric, 3) AS qty_neta,
  c.tiene_fila_inventario,
  ROUND(COALESCE(c.stock_quantity, 0)::numeric, 3) AS stock_quantity,
  ROUND(COALESCE(c.stock_reserved, 0)::numeric, 3) AS stock_reserved,
  ROUND(c.stock_disponible::numeric, 3) AS stock_disponible,
  ROUND(c.cobertura_cruda::numeric, 3) AS cobertura_cruda,
  CASE
    WHEN c.tipo_medida = 'UNIDAD' THEN ROUND(c.cobertura_deseada::numeric, 0)
    ELSE ROUND(c.cobertura_deseada::numeric, 3)
  END AS cobertura_deseada,
  CASE
    WHEN c.tipo_medida = 'UNIDAD' THEN ROUND(c.pedido_sugerido::numeric, 0)
    ELSE ROUND(c.pedido_sugerido::numeric, 3)
  END AS pedido_sugerido,
  -- Reposición de lo vendido (+10%): NO resta stock (ej. Huevo 3 vendidos → 4)
  CASE
    WHEN c.tipo_medida = 'UNIDAD' THEN ROUND(c.cobertura_deseada::numeric, 0)
    ELSE ROUND(c.cobertura_deseada::numeric, 3)
  END AS reposicion_vendido,
  CASE
    WHEN c.tipo_medida = 'UNIDAD'
      THEN ROUND((c.stock_disponible + c.pedido_sugerido)::numeric, 0)
    ELSE ROUND((c.stock_disponible + c.pedido_sugerido)::numeric, 3)
  END AS stock_final,
  ROUND(c.costo_unitario::numeric, 4) AS costo_unitario,
  ROUND((c.pedido_sugerido * c.costo_unitario)::numeric, 4) AS costo_pedido_sugerido,
  ROUND((c.cobertura_deseada * c.costo_unitario)::numeric, 4) AS costo_reposicion_vendido,
  (c.qty_neta = 0) AS sin_venta_en_semana,
  (c.stock_disponible < c.umbral) AS stock_bajo
FROM calc c
LEFT JOIN "Supplier" sup ON sup.id = c."supplierId"
ORDER BY
  CASE WHEN c."supplierId" IS NULL THEN 1 ELSE 0 END,
  COALESCE(sup.name, '(Sin proveedor)'),
  c.pedido_sugerido DESC,
  c.producto;
```

### 3.3.1 Diagnóstico — Aceite Aurora 828ml (resuelto en validación)

Datos reales (`a0419c30-67fa-4df5-b8a3-076405136173`, tienda `0b54c944-...`):

| Campo | Valor |
|---|---|
| Producto | 1 solo, `active`, `unit = unidad`, `catalogStoreId` correcto |
| `InventoryItem` | `quantity = 19`, `reserved = 0` → disponible **19** |
| Semana anterior | vendido **1**, devuelto **1** → `qty_neta = 0` → `cobertura_deseada = 0` |
| Pedido sugerido esperado | **0** (ya hay stock; la venta neta de la semana fue 0) |

**Causa del falso “stock 0”:** si `store_id` se declara como `::uuid` y las columnas son `text`, Postgres falla (`operator does not exist: text = uuid`) o el JOIN de inventario no cuadra. La query A1 debe usar `::text`.

Con `store_id::text` el JOIN trae `stock_disponible = 19` correctamente.

Si vuelves a ver stock 0 en otro producto, revisa `tiene_fila_inventario` / `stock_quantity` / `stock_reserved` en el SELECT de A1.

### 3.4 Totales por proveedor (opcional, misma lógica)

Corre después de validar la query detalle, o envuélvela así:

```sql
-- Envolver la SELECT final de 3.3 como subquery "detalle"
SELECT
  proveedor,
  COUNT(*) AS productos,
  SUM(CASE WHEN tipo_medida = 'UNIDAD' THEN qty_neta ELSE 0 END) AS total_unidades_netas,
  SUM(CASE WHEN tipo_medida = 'PESO'   THEN qty_neta ELSE 0 END) AS total_kg_netos,
  SUM(pedido_sugerido) AS total_pedido_sugerido,
  SUM(costo_pedido_sugerido) AS total_costo_pedido
FROM (
  -- pegar aquí el SELECT final de la query 3.3 (sin el ORDER BY externo si molesta)
  ...
) detalle
GROUP BY proveedor
ORDER BY
  CASE WHEN proveedor = '(Sin proveedor)' THEN 1 ELSE 0 END,
  proveedor;
```

### 3.5 Fase A2 (pendiente) — consumo por el front

Cuando A1 esté validada en Neon:

- Endpoint sugerido: `GET /reports/suggested-orders?storeId=...` (buffer y umbrales como query params opcionales, default 10% / 5 ud / 3 kg).
- Respuesta: lista por producto + totales por proveedor (mismas columnas que la query).
- UI: pantalla “Pedido sugerido” agrupada por proveedor, con `pedido_sugerido`, `stock_final` y `costo_pedido_sugerido`.

### 3.6 Fase A3 (futuro) — IA

Solo después de A2 estable: afinar buffer por categoría/estacionalidad o alertar semanas atípicas. La fórmula base de A1/A2 se mantiene como fuente de verdad auditable.

---

## 4. Proyección B — Distribución diaria de caja

### 4.1 Modelo mental (el ejemplo del usuario)

```text
venta_dia                = 580
costo_mercancia_vendida  ≈ venta - ganancia_bruta
ganancia_bruta           = 85
gastos_operativos_dia    = 10   (merma estimada + bolsas + plásticos + emboplas)
ganancia_neta_dia        = 75   (= 85 - 10)
reserva_insumos          = 10   (reposicion de bolsas/plásticos; puede igualar el gasto estimado)

caja_a_repartir          = venta_dia - ganancia_neta_dia - reserva_insumos
                         = 580 - 75 - 10 = 495

de esos 495:
  reposicion_contado     = 200   (huevos contado, verdura, carne, pollo, etc.)
  abono_facturas_credito = 295   (proveedores a crédito / cuentas por pagar)
```

Interpretación útil:

- La **ganancia neta** ($75) es lo que el dueño puede sacar o acumular como utilidad del día (política del negocio).
- La **reserva de insumos** ($10) evita que “mañana no haya bolsas”.
- Lo demás **no es ganancia**: es capital de trabajo (reponer anaquel + pagar deudas de mercancía).

### 4.2 Cómo calcular la ganancia del día (con lo que ya hay)

Ya se han usado queries de margen a partir de líneas de venta y costo. En resumen:

```text
ganancia_bruta ≈ Σ (lineTotalFunctional − qty × costo_unitario_efectivo) − devoluciones
```

El costo puede salir de `Product.cost` o de `InventoryItem.averageUnitCostFunctional` (preferible si está mantenido).

### 4.3 Variables / parámetros que conviene modelar

Estos son los “diales” que el usuario quiere manejar; no requieren IA:

| Parámetro | Ejemplo | Uso |
|---|---|---|
| `%` o monto fijo de **insumos/empaque** | $8–15/día o 1.5% de venta | Bolsas, plásticos, emboplas |
| `%` o monto de **merma estimada** | 0.5–2% de venta (o por categoría fresca) | Charcutería / verdura / carne |
| `%` **buffer de pedido** | 10–20% | Proyección A |
| Split de caja residual | 40% reposición contado / 60% abono crédito | O montos fijos |
| `Supplier.paymentMode` | `CASH` \| `CREDIT` | Separar buckets |
| `Product.replenishmentClass` (o tags) | `EGGS`, `CHARCUTERIE`, `PRODUCE`, `MEAT`, `GROCERY` | Reglas distintas |
| Día de pago proveedor | Lun–Vie | Alertas de “cuánto ya acumule para este proveedor” |

### 4.4 Opciones de diseño para la proyección B

| Opción | Cómo funciona | Cuándo conviene |
|---|---|---|
| **B1. Calculadora manual (SQL + hoja)** | Query de venta/ganancia del día + % escritos a mano | Validar el modelo 1–2 semanas |
| **B2. “Daily cash plan” en backend** | Al cierre de caja o al final del día: endpoint que devuelve los buckets | Cuando el POS ya cierra sesión (`CashSession`) |
| **B3. Cuentas internas / envelopes** | Tablas `CashBucket` / `CashAllocation` por día | Quieres historial auditable (“el lunes aboné $295”) |
| **B4. Cuentas por pagar (AP)** | Facturas de compra a crédito con saldo | Abonos reales contra factura, no solo “bolsillo” |
| **B5. IA de gasto/merma** | Predice merma e insumos | Solo si hay registro diario real de merma; hoy es estimado |

**Recomendado:** B1 para calibrar → B2 integrado al cierre de caja → B3/B4 cuando quieras control formal de facturas a crédito.

### 4.5 Ejemplo de política parametrizable (sin IA)

```text
insumos_pct          = 1.7% de venta   (o max(10, venta * 0.017))
merma_pct            = 0.5% de venta   (o por categoría)
ganancia_bruta       = margen real del día (SQL)
gastos_dia           = insumos_estimado + merma_estimada
ganancia_neta        = ganancia_bruta - gastos_dia
reserva_insumos      = insumos_estimado   // se aparta en efectivo/caja chica

residual             = venta - ganancia_neta - reserva_insumos

# Del residual, según necesidad de frescos del día siguiente:
reposicion_contado   = min(residual, demanda_contado_proyectada_valorizada)
abono_credito        = residual - reposicion_contado
```

Con el ejemplo numérico:

- Si quieres **siempre** $200 a contado cuando la venta ≥ $550, el resto a crédito: regla simple y operable.
- Si un día vendes poco ($400), la regla puede bajar reposición contado primero y **proteger** el abono mínimo a facturas críticas (huevos/charcutería a crédito).

---

## 5. Casos especiales que pediste (huevos, charcutería, verdura, carne)

### 5.1 Matriz operativa sugerida

| Grupo | Pago | Fuente de proyección | Destino del dinero diario |
|---|---|---|---|
| Huevos proveedor A | Crédito | Venta semanal unidades + buffer | Bucket **abono facturas** |
| Huevos / charcutería proveedor B | Contado | Venta + stock mínimo diario | Bucket **reposición contado** |
| Papa, cebolla, verdura | Contado | Venta corta (3–4 días) + merma alta | Contado; buffer más alto |
| Carne / pollo | Contado | Venta 2–3 días (perecedero) | Contado; no acumular stock largo |
| Abarrotes varios | Mixto | Venta 7 días + stock | Según `paymentMode` del proveedor |

### 5.2 Por qué separar “contado” vs “crédito” en el modelo

Si mezclas todo en “reposición de mercancía”, el día de pago a crédito te quedas corto aunque “había caja”.  
La separación del ejemplo ($200 contado + $295 abono) es exactamente la práctica correcta de **capital de trabajo**.

### 5.3 Datos mínimos a capturar (si aún no existen)

1. En `Supplier` (o metadata): `paymentMode = CASH | CREDIT`, `paymentWeekday`, `creditDays`.
2. En producto o categoría: tag de reposición (`PRODUCE`, `MEAT`, `CHARCUTERIE`, `EGGS`).
3. (Opcional) registro diario de **insumos reales** y **merma real** para calibrar los % (aunque al inicio sean estimados).

Sin eso, las queries agrupan por proveedor, pero el split de caja sigue siendo manual.

---

## 6. Arquitectura por fases (alineada a Quick Market)

### Fase 1 — Inmediata (solo SQL, 0–1 día)

- Query semanal por proveedor: unidades, kg, monto, pedido sugerido con buffer.
- Query diaria: venta, costo, ganancia bruta.
- Hoja o checklist: restar insumos/merma estimados y repartir residual (contado vs crédito).

### Fase 2 — Producto (backend + front, sin IA)

- Parámetros de tienda: `% buffer`, `% insumos`, `% merma`, split contado/crédito.
- `Supplier.paymentMode` (+ días de pago).
- Endpoint de **pedido sugerido** por proveedor.
- Endpoint o sección en **cierre de caja** (`CashSession`): “plan del día” con buckets.
- (Opcional) persistir `DailyCashAllocation` para historial.

### Fase 3 — Control financiero real

- Cuentas por pagar por factura de compra (`Purchase` + saldo).
- Abonos registrados contra factura.
- Alertas: “faltan $X para el pago del jueves al proveedor Y”.

### Fase 4 — IA opcional

- Solo si Fase 2 está estable y hay ≥2–3 meses de historia limpia.
- Casos de uso: buffer dinámico, detección de anomalías, sugerencia de merma por temporada.
- No usar IA para repartir los $495 del ejemplo: eso debe ser regla transparente.

---

## 7. Criterios para elegir entre opciones

| Pregunta | Si la respuesta es… | Elige |
|---|---|---|
| ¿Necesito el número esta semana? | Sí | SQL (Fase 1) |
| ¿El cajero/dueño debe verlo en la app? | Sí | Endpoints + cierre de caja (Fase 2) |
| ¿Quiero saber cuánto debo a cada factura? | Sí | AP / saldos (Fase 3) |
| ¿Las ventas cambian mucho por clima/feriados? | Sí, y ya tengo historia | IA de demanda (Fase 4) |
| ¿Puedo vivir con +15% fijo? | Sí | **No uses IA** |

---

## 8. Riesgos y cuidados

1. **Moneda:** ventas en VES vs proyección mental en USD → usar `totalFunctional` / tasa del día y documentar en qué moneda se reparten los buckets.
2. **Costo desactualizado:** si `Product.cost` no se mantiene, la “ganancia $85” miente; preferir costo promedio de inventario cuando exista.
3. **Devoluciones:** restarlas en demanda y en margen.
4. **Productos sin proveedor:** salen al final del ranking; no deben distorsionar pedidos.
5. **Perecederos:** ventana de 7 días es mala para verdura/carne; usar 2–4 días.
6. **Doble conteo:** no restar insumos del margen y además sacarlos otra vez del residual sin criterio claro (definir una sola política, como en el ejemplo).

---

## 9. Conclusión práctica

- **No necesitas IA** para arrancar. Necesitas:
  1. demanda semanal (y corta para frescos) por proveedor en unidades/kg;
  2. pedido sugerido = demanda × (1 + buffer) − stock;
  3. plan diario de caja: ganancia − merma/insumos → apartar insumos → residual → reposición contado vs abono crédito.
- El ejemplo del lunes ($580 / $85 / $10 / $75 / $10 / $200 / $295) es el **contrato de negocio** que el sistema debe reflejar con parámetros editables.
- La diferenciación huevos/charcutería (crédito vs contado), verdura y carne/pollo (contado) se modela con **atributos de proveedor/categoría**, no con un modelo predictivo.

### Siguiente paso sugerido

1. Calibrar 7 días reales con las queries de la sección 3 y 4.
2. Fijar % iniciales: buffer 15%, insumos ~1.5–2% venta, merma 0.5–1%.
3. Decidir si el split residual es **montos fijos** ($200 / resto) o **porcentajes**.
4. Cuando eso funcione a mano, bajarlo a endpoints + cierre de caja (Fase 2).

---

## 10. Glosario rápido

| Término | Significado aquí |
|---|---|
| Buffer / colchón | % extra sobre lo vendido para no quedarse corto |
| Pedido sugerido | Cantidad a comprar recomendada por producto/proveedor |
| Ganancia bruta | Venta − costo de mercancía vendida |
| Ganancia neta del día | Ganancia bruta − merma/insumos estimados |
| Reposición contado | Dinero para comprar hoy/mañana a proveedores de contado |
| Abono a facturas | Dinero apartado para pagar proveedores a crédito |
| Envelope / bucket | “Bolsillo” virtual de caja con un propósito |
