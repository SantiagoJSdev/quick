# Contrato front — política de costos (4 fases)

Documento para **Flutter / POS offline-first**. Backend implementado en Quick Market (NestJS + Prisma).

**Moneda funcional:** USD (`BusinessSettings.functionalCurrency`). Costos de negocio = **`Product.cost`** (catálogo). **No** usar `averageUnitCostFunctional` en UI, COGS ni valorización (campo deprecado / solo kardex técnico).

**Header habitual:** `X-Store-Id: <uuid tienda>` en todas las rutas de tienda.

**Decimales en JSON (sync):** cantidades, precios y costos van como **strings** (`"2"`, `"15.50"`). Números JSON → `validation_error`.

---

## Resumen por fase

| Fase | Área | Qué debe hacer el front |
|------|------|-------------------------|
| **1** | Compras | Una línea por `productId`; costo de factura actualiza catálogo |
| **2** | Inventario | `IN_ADJUST` sin promedio; pedir costo si stock 0 y catálogo 0 |
| **3** | Ventas | `lines[].unitCostFunctional` al cobro (obligatorio offline) |
| **4** | KPI / patrimonio | Solo lectura; fotos al cerrar caja; COGS histórico congelado |

---

## Fase 1 — Compras → `Product.cost`

### Endpoints

| Modo | Ruta / op |
|------|-----------|
| Online | `POST /api/v1/purchases` |
| Offline | `sync/push` → `opType: PURCHASE_RECEIVE` |

### Reglas de negocio

| Regla | Comportamiento back | Acción front |
|-------|---------------------|--------------|
| Costo por línea | `Product.cost` = costo unitario **funcional** de esa línea (último proveedor; **no** promedio) | Mostrar/editar costo por línea; al guardar local, persistir costo que irá en la factura |
| Costo menor | Siempre actualiza aunque baje | Sin bloqueo en UI |
| Costo = 0 en línea | **No** cambia `Product.cost` | Permitir línea con costo 0; no esperar cambio de catálogo |
| **Producto duplicado** | **400** `DUPLICATE_PRODUCT_IN_PURCHASE` | **Un solo `productId` por factura.** Si el usuario agrega el mismo SKU dos veces → fusionar cantidades en una línea **antes** de enviar, o mostrar error claro |
| Precio lista | Tras compra con costo > 0, recalcula `price` con margen tienda | Refrescar catálogo tras sync (`PRODUCT_UPDATED` en pull) |
| `MANUAL_PRICE` | No recalcula precio automático | Respetar precio manual en UI |
| VOID compra | Revierte `Product.cost` y `price` al valor previo a esa recepción | Tras void, refrescar catálogo |

### Payload línea (REST)

```json
{
  "productId": "uuid",
  "quantity": "10",
  "unitCost": "5.00"
}
```

`unitCost` = moneda del **documento** de la factura (ej. VES). El back convierte a funcional con `fxSnapshot`.

### Errores a manejar

| `code` | HTTP | Cuándo |
|--------|------|--------|
| `DUPLICATE_PRODUCT_IN_PURCHASE` | 400 | Mismo `productId` en dos líneas del mismo body |

### Sync offline

- Enviar `fxSnapshot` **completo** (4 strings obligatorios) si la compra no es en moneda funcional pura.
- `opId` estable por operación; reintentos = mismo `opId` + mismo payload.
- Tras aplicar: pull incremental para `PRODUCT_UPDATED` y stock.

---

## Fase 2 — Inventario (sin promedio ponderado)

### Endpoints

| Operación | Ruta / op |
|-----------|-----------|
| Ajuste IN/OUT | `POST /api/v1/inventory/adjustments` |
| Ajuste offline | `sync/push` → `INVENTORY_ADJUST` |
| Merma | `POST /api/v1/inventory/losses` |
| Alta producto + stock | `POST /api/v1/products-with-stock` |

### `IN_ADJUST` — resolución de costo

| Caso | Back | Front |
|------|------|-------|
| Con `unitCostFunctional` > 0 | Usa ese costo; **actualiza `Product.cost`**; no recalcula `price` (solo compras recalculan precio) | Campo costo opcional en UI de entrada |
| Sin costo, `Product.cost` > 0 | Usa catálogo | Puede omitir costo |
| Sin costo, stock previo **> 0**, catálogo = 0 | **400** `INVALID_UNIT_COST_FOR_IN_ADJUST` | Pedir costo o actualizar catálogo antes |
| Sin costo, stock previo **≤ 0**, catálogo = 0 | **400** `UNIT_COST_REQUIRED_FOR_ZERO_STOCK` | **Modal obligatorio** de costo unitario |

### `OUT_ADJUST` / venta / merma

| Operación | Costo del movimiento |
|-----------|----------------------|
| `OUT_ADJUST` | `Product.cost` actual (no mandar costo) |
| Venta (`OUT_SALE`) | COGS de la línea (fase 3) o catálogo al cobrar |
| Merma (`POST /inventory/losses`) | `Product.cost` del día de la merma |

### Body ajuste

```json
{
  "productId": "uuid",
  "type": "IN_ADJUST",
  "quantity": "4",
  "unitCostFunctional": "8.50",
  "reason": "Reposición",
  "opId": "uuid-opcional"
}
```

### `POST /products-with-stock`

`initialStock.unitCostFunctional` opcional. Mismas reglas que `IN_ADJUST` si falta costo y stock/catálogo en 0.

### Errores a manejar

| `code` | Cuándo |
|--------|--------|
| `UNIT_COST_REQUIRED_FOR_ZERO_STOCK` | IN sin costo, stock 0, catálogo 0 |
| `INVALID_UNIT_COST_FOR_IN_ADJUST` | IN sin costo, catálogo 0 pero había stock |

### Qué **no** hacer

- No mostrar ni editar “costo promedio” como costo de negocio.
- No enviar `averageUnitCostFunctional` desde el cliente (el back lo ignora para operaciones).

---

## Fase 3 — Ventas y COGS congelado

### Endpoints

| Modo | Ruta / op |
|------|-----------|
| Online | `POST /api/v1/sales` |
| Offline | `sync/push` → `opType: SALE` |

### Campo clave: `lines[].unitCostFunctional`

| Contexto | Obligatorio | Valor |
|----------|-------------|-------|
| **Sync offline `SALE`** | **Sí** (recomendado fuerte) | `Product.cost` del **catálogo local al cobrar** (USD funcional) |
| `POST /sales` online | No | Si falta → `Product.cost` del servidor al confirmar |

**Nombre oficial:** `unitCostFunctional` (igual que compras, ajustes e inventario). **No** inventar otro nombre.

### Ejemplo línea (offline)

```json
{
  "productId": "uuid",
  "quantity": "2",
  "price": "15.50",
  "discount": "0",
  "unitCostFunctional": "1.25"
}
```

### Payload sync `SALE` (mínimo)

```json
{
  "deviceId": "uuid-dispositivo",
  "ops": [{
    "opId": "uuid-v4",
    "opType": "SALE",
    "timestamp": "2026-04-13T18:00:00.000Z",
    "payload": {
      "sale": {
        "id": "uuid-ticket-estable",
        "storeId": "uuid-tienda",
        "lines": [ /* ver arriba */ ],
        "payments": [ /* opcional */ ],
        "fxSnapshot": { /* opcional, completo o omitir */ }
      }
    }
  }]
}
```

### Reglas críticas venta

| Regla | Detalle |
|-------|---------|
| `sale.id` | **Obligatorio** UUID estable del ticket local |
| Idempotencia | Mismo `sale.id` → no duplica venta (`skipped: sale_already_exists`) |
| Reintento red | Mismo `sale.id` + mismo `opId` |
| Payload corregido tras `failed` | **Nuevo `opId`**, mismo `sale.id` |
| `quantity`, `price` | **Strings** en JSON |
| Stock negativo | Si `allowNegativeStockAtPos=true` → venta aplica; warning `STOCK_NEGATIVE` |
| Producto inactivo | Venta permitida (carrito abierto); warning `PRODUCT_INACTIVE` |

### `clientSoldAt` — **pendiente en back**

- Documentado en política; **aún no** cambia `Sale.createdAt`.
- Hoy KPIs y listados usan hora del **servidor** al sync.
- **Recomendación front:** guardar localmente `soldAt` ISO UTC al cobrar; enviar cuando el back lo soporte (mismo patrón que `clientOpenedAt` en caja).
- Mientras tanto: `ops[].timestamp` queda en `SyncOperation` pero **no** mueve la venta de día en KPI.

### Devoluciones (`POST /sale-returns` / `SALE_RETURN`)

| Regla | Front |
|-------|-------|
| COGS reingresado | Back usa `SaleLine.unitCostFunctional` de la venta original | No mandar costo en devolución; ligar a `saleLineId` |
| Sin COGS en línea original | Back infiere de movimientos / catálogo | Normal en ventas viejas |

### Catálogo manual

`PATCH /products` con `{ "cost": "..." }` siempre permitido (dueño corrige por encima de compras). Actualizar cache local del POS.

---

## Fase 4 — KPI y patrimonio (lectura + disparadores)

El front **no envía** fotos de capital; las **dispara** el back.

### Disparo de foto diaria

| Evento | Efecto |
|--------|--------|
| `POST /cash-sessions/:id/close` OK | Upsert `StoreCapitalSnapshot` del **día Caracas** (`source=CASH_CLOSE`) |
| Primera vez que piden serie sin foto de ayer | Lazy (`source=LAZY`) — no pisa `CASH_CLOSE` |
| `POST /kpis/capital-snapshots/run` | Manual / backfill |

Varios cierres el mismo día = **misma fila**, se actualiza.

### Endpoints lectura

| Endpoint | Uso UI |
|----------|--------|
| `GET /kpis/snapshot?preset=today\|week\|month` | Dashboard ganancia + capital live |
| `GET /kpis/capital-series?preset=week\|month` | Gráfica patrimonio |

### Cómo calcula el back (para interpretar números)

| Métrica | Fuente |
|---------|--------|
| **Capital live** (`capital` en snapshot) | `Σ qty × Product.cost` ahora − deuda abierta |
| **COGS / grossProfit** | `SaleLine.unitCostFunctional` → si falta, costo del **snapshot del día** → último fallback catálogo live |
| **Foto inventario** | Totales + `inventorySkuCosts` (costo por SKU al cierre) |
| **realProfit** | Se puede recomputar al leer serie; inventario/deuda de la foto no se reescribe |

### Implicaciones front

1. **Cerrar caja** cuando sea posible → foto oficial del día.
2. Tras compras que cambian costos, KPI de **días pasados** no debe “moverse” si hay foto + `unitCostFunctional` en ventas.
3. Ventas offline **sin** `unitCostFunctional` distorsionan COGS al sync tardío → **siempre enviar costo al cobrar**.
4. `missingDates` en `capital-series` = días sin foto; no inventar puntos en la gráfica.

---

## Tabla de códigos de error (cost policy)

| `code` | Operación | Acción UI sugerida |
|--------|-----------|-------------------|
| `DUPLICATE_PRODUCT_IN_PURCHASE` | Compra | Fusionar líneas o quitar duplicado |
| `UNIT_COST_REQUIRED_FOR_ZERO_STOCK` | IN_ADJUST / stock inicial | Modal costo unitario |
| `INVALID_UNIT_COST_FOR_IN_ADJUST` | IN_ADJUST | Pedir costo o editar catálogo |
| `validation_error` (sync) | Cualquier op | Leer `failed[].details`; corregir tipos/strings |
| `sale_already_exists` (skipped) | SALE sync | Marcar ticket sincronizado; no reenviar |
| `STOCK_NEGATIVE` (warning) | SALE | Aviso no bloqueante si política lo permite |

Respuestas 400 incluyen `code` en JSON (filtro de excepciones).

---

## Checklist implementación Flutter

### Catálogo local (SQLite)

- [ ] Mantener `Product.cost` sincronizado (pull `PRODUCT_UPDATED`).
- [ ] No usar promedio inventario para mostrar margen ni COGS.

### Compras

- [ ] Validar **un `productId` por factura** antes de encolar.
- [ ] Permitir costo 0 en línea (sin esperar cambio de catálogo).
- [ ] Refrescar productos tras recepción.

### Inventario

- [ ] IN con stock 0: si `cost == 0` → pedir `unitCostFunctional`.
- [ ] IN con costo explícito → enviar `unitCostFunctional`.
- [ ] Merma: solo `productId`, `quantity`, `reason` (costo = catálogo).

### POS / ventas

- [ ] Al cobrar offline: guardar `unitCostFunctional = product.cost` local en cada línea.
- [ ] Serializar cantidades/precios/costos como **String** en sync.
- [ ] `sale.id` estable + `opId` por intento de push.
- [ ] Guardar `soldAt` local (futuro `clientSoldAt`).

### KPI / caja

- [ ] Cerrar sesión de caja al fin del turno.
- [ ] Tab Capital: `GET /kpis/capital-series`.
- [ ] Dashboard: `GET /kpis/snapshot`.

---

## Referencias API

- [COST_POLICY.md](./COST_POLICY.md) — política completa
- [api/PURCHASES.md](./api/PURCHASES.md)
- [api/INVENTORY.md](./api/INVENTORY.md)
- [api/SYNC_PUSH_SALE.md](./api/SYNC_PUSH_SALE.md)
- [api/KPIS.md](./api/KPIS.md)
- [api/CASH_SESSIONS.md](./api/CASH_SESSIONS.md)
- [FRONTEND.md](./FRONTEND.md)
