# Política de costos — Quick Market

**Moneda funcional:** `Product.cost` y COGS/KPI operativos en **USD funcional** (`BusinessSettings.functionalCurrency`).

**Principio:** el costo de negocio es el **catálogo actual** (`Product.cost`). **No** usar `averageUnitCostFunctional` para COGS, capital live ni KPI (salvo auditoría kardex si se mantiene el campo).

---

## 1. Compras → `Product.cost`

Al recibir factura (`POST /purchases`, sync `PURCHASE_RECEIVE`), **por cada línea**:

| Regla | Detalle |
|-------|---------|
| Actualizar catálogo | `Product.cost = costo unitario funcional de **esa línea de factura**` (último costo del proveedor; **no** promedio ponderado). |
| Factura masiva | Igual que un solo producto: N líneas → N actualizaciones de `Product.cost`. |
| Costo menor | **Siempre** actualizar, aunque el nuevo costo sea menor que el actual. |
| Costo = 0 o vacío en factura | **No** cambiar `Product.cost`; conservar el costo actual del producto. |
| Mismo producto dos veces en una factura | **No permitido** (validación 400 al crear/recibir compra). |
| Precio de lista | Tras actualizar costo, **recalcular y persistir `price`** con margen de tienda (salvo productos `MANUAL_PRICE` si aplica la regla M7 existente). |
| Aviso POS | No (v1). |

**Anulación de factura proveedor (`VOID`):** revertir `Product.cost` al valor que tenía **antes** de esa recepción (requiere guardar costo previo por línea o historial).

---

## 2. Ventas — COGS

| Regla | Detalle |
|-------|---------|
| Base | `Product.cost` **al momento del cobro** (foto en movimiento/línea). |
| Online | Persistir en `StockMovement.costAtMoment` / costo en línea de venta al confirmar. |
| Offline / sync tardío | Usar **costo (y precio) enviados por el front** en el payload de la venta (`clientSoldAt` + costo funcional por línea si aplica). **No** usar el `Product.cost` del servidor al momento del sync. |
| Stock negativo | COGS = catálogo vigente al cobro (misma regla). |
| KPI histórico | Cada día del rango usa costos/precios **de ese día** (fotos/snapshots); no recalcular días pasados con catálogo de hoy. |

Fotos operativas: cierre de caja y/o cada sync — definido en front; el back debe aceptar y persistir el costo congelado de la operación.

---

## 3. Inventario y patrimonio

| Regla | Detalle |
|-------|---------|
| Valor live | `Σ quantity × Product.cost` (funcional). |
| Capital snapshot (fin de día) | Congelar totales **y** costos por SKU (`inventorySkuCosts`) de ese día al cierre de caja. |
| Promedio `averageUnitCostFunctional` | **Deprecado** para negocio; dejar de actualizar o solo kardex técnico. |

---

## 4. Ajustes manuales (`IN_ADJUST`, stock inicial)

| Caso | Regla |
|------|--------|
| IN con costo explícito | Actualiza stock **y** `Product.cost` si el costo enviado es > 0. |
| IN sin costo, stock previo ≤ 0 | **400** `UNIT_COST_REQUIRED_FOR_ZERO_STOCK` (front debe pedir costo). |
| IN sin costo, stock previo > 0 | Usar **`Product.cost` actual** (no promedio). |

Ver [api/INVENTORY.md](./api/INVENTORY.md).

---

## 5. Devoluciones y mermas

| Operación | Costo |
|-----------|--------|
| Devolución cliente (`IN_RETURN`) | **Costo de la venta original** (COGS revertido), no catálogo actual. |
| Merma (`OUT_LOSS`) | `Product.cost` del día de la merma. |

---

## 6. Catálogo manual

`PATCH /products` con `{ cost }`: **siempre permitido** (dueño corrige proveedor por encima de compras).

**Charcutería (KG):** compras por kg actualizan `Product.cost` como cualquier producto.

**Productos especiales KPI** (bolsas, platos, etc.): costo desde config KPI / constantes del día, no necesariamente `Product.cost` del SKU vendido.

---

## 7. Contrato front

### Venta offline (sync `SALE`)

El payload debe incluir, por línea, el **costo funcional congelado al cobro** (`lines[].unitCostFunctional`), para que el back no re-lea catálogo al sync. Online (`POST /sales`): opcional; si se omite, usa `Product.cost` del servidor al confirmar.

### Compras

- Una factura **no** puede repetir el mismo `productId` en dos líneas.
- Línea con costo 0: back ignora actualización de catálogo.

### Ajustes inventario

- Stock 0 + IN sin `unitCostFunctional`: UI obligatoria o `Product.cost` > 0 en catálogo.

---

## 8. Implementación back (checklist)

- [x] Compra: `Product.update({ cost })` + recalcular `price` por margen tienda.
- [x] Compra: validar producto duplicado en misma factura.
- [x] Compra void: revertir `Product.cost` (guardar `catalogCostBefore*` por línea).
- [x] IN_ADJUST: actualizar catálogo si mandan costo; IN sin costo → catálogo actual (sin promedio).
- [x] Movimientos de inventario: totales espejan `qty × Product.cost` (promedio deprecado).
- [x] Venta: persistir COGS en línea; sync offline usa costo del payload.
- [x] KPI COGS: desde `SaleLine.unitCostFunctional` (fallback catálogo en ventas viejas).
- [x] KPI / `StoreCapitalSnapshot`: COGS e inventario por día con costos congelados (`inventorySkuCosts`); rangos pasados no usan catálogo live si hay foto del día.
- [x] Docs API: KPIS, FRONTEND, SYNC_PUSH_SALE (COGS por línea).

---

## Resumen ejecutivo

| Sí | No |
|----|-----|
| Último costo de factura → `Product.cost` | Promedio ponderado como base del negocio |
| Precio lista recalculado con margen al comprar | Duplicar SKU en misma factura |
| COGS = costo al cobro (foto / payload offline) | Recalcular KPI de ayer con costo de hoy |
| Inventario live = qty × catálogo | |
| Devolución = costo venta original | |
