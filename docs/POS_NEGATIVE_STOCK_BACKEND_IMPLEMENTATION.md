# Plan de implementación backend — venta con stock negativo (POS offline-first)

**Estado:** B1 **implementado en código** (migración aplicada en Neon local/dev). B2 cierre de caja pendiente.  
**Contexto:** minimarket multi-caja, cola local, `sync/push` + `sync/pull`, cobro no debe depender del server.  
**Relacionado:** [`FRONTEND.md`](./FRONTEND.md), [`POS_NEGATIVE_STOCK_FRONTEND_IMPLEMENTATION.md`](./POS_NEGATIVE_STOCK_FRONTEND_IMPLEMENTATION.md), [`api/SYNC_PUSH_SALE.md`](./api/SYNC_PUSH_SALE.md)

### B1 entregado (código)

- Migración `20260725120000_pos_negative_stock_policy`
- `applyOutSaleLineTx` con negativo + `blockSaleWithoutStock`
- `createSaleTx`: flags, warnings, producto inactivo permitido
- Sync SALE: `sale.id` obligatorio; `sale_already_exists`; `acked.warnings`
- PATCH business-settings + product DTOs / pull `blockSaleWithoutStock`

---

## 0. Decisiones cerradas (2026-07-25)

| # | Tema | Decisión |
|---|------|---------|
| 1 | Default tiendas existentes | `allowNegativeStockAtPos = **true**` para **todas** |
| 2 | Restringidos en B1 | Sí: `Product.blockSaleWithoutStock` (boolean, default `false`) |
| 3 | Stock negativo | **Cantidad real negativa** en `InventoryItem.quantity` (estilo Square / POS maduro) |
| 4 | Warnings | **Ambos:** `Sale.stockConflictDetected` + `warnings[]` en REST y en `acked[]` del sync |
| 5 | Cierre de caja | **Mismo epic** (B2 en este plan, no epic aparte) |
| 6 | Precio carrito | Congelar al **agregar línea** (precio que vio el cliente); no recalcular al cobrar ni tras pull |
| 7 | Producto desactivado en carrito | **Permitir cobrar** el carrito abierto; no agregar nuevos inactivos. Offline: cobrar + sync/cierre al final |
| 8 | PIN supervisor | **Solo en la app** (local); no validación server en B1/B2 |
| 9 | Cierre de caja | **Obligatorio por turno**: sync continuo OK, pero al final siempre hay cierre. Puede ser **100% offline** y transmitir al reconectar |
| 10 | UI inventario negativo | Mostrar cantidad real (`-2`), no clamp a 0 |

---

## 1. Situación actual (código)

| Pieza | Comportamiento hoy |
|-------|--------------------|
| `InventoryService.applyOutSaleLineTx` | Si `quantity - reserved < qty` → **`BadRequestException('Insufficient stock...')`** |
| `POST /sales` y `sync/push` `SALE` | Usan ese método → **rechazan** la venta entera |
| `BusinessSettings` | Solo monedas + `defaultMarginPercent` — **sin política de stock** |
| `Sale` / `SaleLine` | Snapshot de precio/totales/FX; **sin flags** de conflicto de inventario |
| `Product` | `active`, `unit`; **sin** flag “restringido / no permitir negativo” |
| Cierre de caja | **No existe** en backend |

Consecuencia: dos cajas, stock 1, ambas venden → una falla en sync y queda en cola/`failed` aunque el cobro local ya ocurrió. Eso choca con “facturación y monto deben cuadrar”.

---

## 2. Decisión de producto (política objetivo)

**Regla principal:** aceptar la venta y dejar stock central negativo (o en cero con reserva) **cuando la política de tienda lo permita**, con **advertencia + trazabilidad**, no con rechazo por defecto.

| Escenario | Comportamiento backend |
|-----------|------------------------|
| Producto normal + política `allowNegativeStockAtPos=true` | Aplicar `OUT_SALE`, stock puede quedar **&lt; 0**, venta `CONFIRMED` |
| Producto restringido + sin stock | **Rechazar** (o exigir autorización — ver §8) |
| Producto inactivo | En **SALE** (REST/sync): **aceptar** aunque `active=false` (cobro de carrito ya abierto / offline). No permitir crear líneas nuevas en FE si inactivo. |
| Mismo `opId` + mismo payload | Idempotencia: `skipped` / reutilizar movimiento |
| Mismo `opId` + payload distinto | `payload_mismatch` (sin cambios) |
| `opId` ya `failed` | No reaplicar; cliente debe **nuevo `opId`** |

La sincronización continua sigue siendo responsabilidad del cliente; el backend solo garantiza **aceptar ventas válidas** y **exponer incidentes**.

---

## 3. Alcance por fases

### Fase B1 — P0 (debe ir primero)

1. Política en `BusinessSettings` (o tabla dedicada).
2. `applyOutSaleLineTx` respeta política (permitir negativo + flag).
3. Metadatos mínimos en `Sale` (conflicto / modo validación).
4. Respuesta de venta / sync con advertencias (`warnings[]`), **sin** fallar.
5. Flag opcional en `Product` para restringidos.
6. Tests unitarios + integración.
7. Documentar contrato en `docs/api/`.

### Fase B2 — P1 (cierre / ops) — **mismo epic**

1. Modelo `CashSession` (turno / cierre de caja).
2. Endpoint resumen de cierre: pendientes sync, stock negativo, totales venta del turno.
3. Tabla o log de incidentes operativos (`StockIncident`) si no basta con flags en `Sale`.
4. Métricas ops: conteo ventas con `stockConflictDetected`.
5. FE: botón Cerrar caja **obligatorio** al fin de turno; soportar cierre offline + transmisión diferida.
6. Inventario / reports: exponer `quantity` negativa tal cual (sin `max(0, …)` en API de admin).

### Fase B3 — P2 (refinar)

1. Autorización supervisor en server (PIN hash por tienda).
2. Política por categoría / tipo de unidad (pesados) si hace falta.
3. Snapshot opcional de `catalogVersion` / `priceSource` en línea.

**Orden de entrega:** B1 primero (desbloquea sync), B2 en el mismo epic justo después.

---

## 4. Modelo de datos (B1)

### 4.1 `BusinessSettings` — nuevos campos

| Campo | Tipo | Default | Significado |
|-------|------|---------|-------------|
| `allowNegativeStockAtPos` | `Boolean` | `true` | Permite `OUT_SALE` aunque `available < qty` (migración: true en tiendas existentes) |
| `warnOnNegativeStock` | `Boolean` | `true` | Si hubo conflicto, marcar venta y devolver warning |
| `blockRestrictedProductsWithoutStock` | `Boolean` | `true` | Productos restringidos: sin stock → rechazo |
| `requireSuccessfulSyncAtClose` | `Boolean` | `false` | Solo relevante en B2 (cierre) |

Migración Prisma + seed: defaults explícitos por tienda existente.

### 4.2 `Product` — restricción

| Campo | Tipo | Default | Significado |
|-------|------|---------|-------------|
| `blockSaleWithoutStock` | `Boolean` | `false` | Si true: sin stock suficiente → **rechazo** aunque la tienda permita negativo |

Quién lo marca: admin / catálogo (PATCH producto). No hace falta enum en B1.

### 4.3 `Sale` — trazabilidad inventario

| Campo | Tipo | Significado |
|-------|------|-------------|
| `inventoryValidationMode` | enum/string | `STRICT` \| `ALLOW_NEGATIVE` \| `SKIPPED_OFFLINE_CLIENT` *(opcional)* |
| `stockConflictDetected` | `Boolean` default false | Alguna línea quedó con stock &lt; 0 o available insuficiente al aplicar |
| `saleOrigin` | string? | `POS_SYNC` \| `POS_REST` \| `API` |

Opcional P1 en línea (`SaleLine`):

| Campo | Significado |
|-------|-------------|
| `stockBefore` / `stockAfter` | Snapshot al aplicar (auditoría) |
| `priceSource` | `CART_SNAPSHOT` \| `CATALOG` *(más FE)* |

### 4.4 Incidentes (B2, opcional B1 ligero)

Si no se quiere tabla nueva en B1: basta `stockConflictDetected` + query ops.

Tabla B2 sugerida `StockIncident`:

- `id`, `storeId`, `saleId`, `productId`, `deviceId?`
- `requestedQty`, `availableBefore`, `quantityAfter`
- `createdAt`, `resolvedAt?`, `resolvedBy?`

---

## 5. Cambios de lógica

### 5.1 `applyOutSaleLineTx` (núcleo)

Hoy:

```text
available = quantity - reserved
if available < qty → throw Insufficient stock
newQty = quantity - qty
```

Objetivo:

```text
1. Cargar BusinessSettings + Product policy
2. effectiveAllowNegative = store.allowNegativeStockAtPos
   && !product.blockSaleWithoutStock
   (o product.posStockPolicy)
3. available = quantity - reserved
4. conflict = available < qty
5. if conflict && !effectiveAllowNegative → throw (como hoy)
6. if conflict && effectiveAllowNegative → newQty = quantity - qty (puede ser < 0)
   return { movementId, stockConflict: true, availableBefore, quantityAfter }
7. else → comportamiento actual, stockConflict: false
```

**Kardex:** seguir creando `OUT_SALE` con la cantidad vendida. El costo medio: si `quantity <= 0` antes de salir, definir regla (usar último `averageUnitCostFunctional` sin dividir por cero — ya hay ramas similares en ajustes).

### 5.2 `SalesService.createSaleTx`

- Acumular `anyConflict` de cada línea.
- Persistir `stockConflictDetected`, `inventoryValidationMode`.
- No abortar la transacción por conflicto permitido.
- Devolver en REST (y en ack de sync si se extiende):

```json
{
  "sale": { "...": "..." },
  "warnings": [
    {
      "code": "STOCK_NEGATIVE",
      "productId": "...",
      "message": "Sale applied; inventory went negative",
      "availableBefore": "0",
      "quantityAfter": "-1"
    }
  ]
}
```

### 5.3 `sync/push` `SALE`

- Misma ruta `createSaleTx`.
- Si hoy un insufficient stock mete la op en `failed` con `validation_error` / details: **dejar de fallar** cuando la política permita negativo.
- Opcional: persistir en `SyncOperation` un campo o dejar el warning solo en respuesta `acked[]` extendido:

```json
{ "opId": "...", "serverVersion": 123, "warnings": [ ... ] }
```

Contrato: documentar en `SYNC_PUSH_SALE.md` — **breaking suave** (campo nuevo opcional).

### 5.4 Producto inactivo

**Decisión #7:** en `createSaleTx` / SALE sync, **no rechazar** por `product.active === false` (el cobro del carrito abierto debe poder sincronizar).  
Catálogo y altas nuevas siguen filtrando inactivos en FE. Opcional: warning `PRODUCT_INACTIVE`.

### 5.5 Idempotencia

Sin cambios de semántica: `opId` en movimiento `${opId}:${productId}`; venta con `id` cliente; `SyncOperation` applied/failed.

---

## 6. API / contratos

### 6.1 Settings

- Extender `GET/PUT/PATCH` business-settings (onboarding o endpoint existente) con los nuevos booleanos.
- Incluir en **pull** / payload de settings que el POS cachea (crítico offline).

### 6.2 Productos

- CRUD + pull: exponer `blockSaleWithoutStock` (o enum).
- Catálogo local FE usa ese flag para UX (PIN / bloqueo).

### 6.3 Ventas

- `POST /sales`: body sin cambios obligatorios; respuesta con `warnings[]`.
- Query ops/reportes: filtrar `stockConflictDetected=true` (B2).

### 6.4 Cierre de caja (B2 — contrato preliminar)

No implementar en B1, pero FE puede diseñar pantallas contra este esqueleto:

```http
POST /api/v1/cash-sessions          # abrir turno
POST /api/v1/cash-sessions/:id/close
GET  /api/v1/cash-sessions/:id/summary
```

Summary sugerido: totales venta del rango, conteo ops `failed`/`pending` del device (si el cliente reporta), productos con `quantity < 0`, ventas con conflicto.

---

## 7. Plan de trabajo backend (checklist)

### B1.1 Migración

- [ ] Prisma: campos en `BusinessSettings`, `Product`, `Sale`
- [ ] `migrate deploy` + defaults en tiendas existentes
- [ ] Actualizar seed

### B1.2 Inventario

- [ ] Refactor `applyOutSaleLineTx` con política + return `stockConflict`
- [ ] Costo medio con stock 0 / negativo (tests)
- [ ] No romper `OUT_ADJUST` strict (ajustes manuales pueden seguir strict)

### B1.3 Ventas + sync

- [ ] `createSaleTx` persiste flags y agrega warnings
- [ ] Sync SALE: no `failed` por stock si política lo permite
- [ ] Extender `acked` con `warnings` (obligatorio en B1)
- [ ] SALE acepta producto `active=false` (carrito abierto / offline)

### B1.4 Settings / productos API

- [ ] DTOs + swagger
- [ ] Exponer en responses de settings y product pull/payload

### B1.5 Tests

- [ ] Unit: allow negative → quantity -1, sale confirmed
- [ ] Unit: restricted product → still throws
- [ ] Unit: store policy false → throws (compat)
- [ ] Integration: dos ventas concurrentes último ítem → ambas applied, stock -1
- [ ] Sync: op SALE insufficient + allow → applied, no failed

### B1.6 Docs

- [ ] `SYNC_PUSH_SALE.md`, `FRONTEND.md` § stock, `DATABASE_SCHEMA_GUIDE.md`
- [ ] Entrada en `docs/README.md`

### B2 (implementado)

- [x] `CashSession` + open/close/summary — ver [`api/CASH_SESSIONS.md`](./api/CASH_SESSIONS.md)
- [x] `requireSuccessfulSyncAtClose`: soft warning en summary/close (no bloquea)
- [ ] `StockIncident` tabla dedicada (opcional; flags en Sale bastan por ahora)

---

## 8. Puntos menores — cerrados

| Tema | Decisión |
|------|---------|
| PIN supervisor | Solo FE local |
| Cierre | Obligatorio al fin de turno; compatible con sync continuo y con jornada 100% offline + transmisión al final |
| Inventario UI | Mostrar qty negativa real (`-2`) |
| Pesados (kg) | Misma política de negativo que unidades |

---

## 9. Criterios de aceptación (B1)

- [ ] Con política ON (default), venta con stock 0 se confirma y `InventoryItem.quantity` puede ser negativo.
- [ ] Con política OFF, comportamiento idéntico al actual (reject).
- [ ] Producto `blockSaleWithoutStock=true` rechaza sin stock aunque la tienda permita negativo.
- [ ] `Sale.stockConflictDetected=true` cuando hubo conflicto permitido.
- [ ] Sync: `acked` con `warnings[]` opcionales; **no** `failed` por stock insuficiente cuando la política permite.
- [ ] Idempotencia intacta (`opId` / sale id).
- [ ] Settings de política disponibles para cache FE (REST o pull).
- [ ] Migración deja `allowNegativeStockAtPos=true` en tiendas existentes.

---

## 10. Fuera de alcance inmediato

- Rediseño completo de FX / pagos.
- Imágenes / S3.
- Soft-delete de barcode / catálogo (otro tema).
- Recalcular precio de tickets ya emitidos.
- PIN supervisor en server (B3).

---

## 11. Precio de carrito (decisión #6) — nota para backend

El backend **no recalcula** precios de líneas: usa los `price` / totales del payload.  
La regla “congelar al agregar” es **100% FE**; el server solo persiste el snapshot recibido.

---

## 12. Idempotencia, cola pendiente y cierre — análisis

### 12.1 Problema real

Puede fallar el sync por: red, cold start Render, validación, stock (hoy), producto inactivo, payload mal tipado, timeout, ACK perdido.

Si el POS **reintenta mal**, el riesgo es **duplicar la venta/factura**.

### 12.2 Qué hay hoy en backend

| Mecanismo | Comportamiento |
|-----------|----------------|
| `SyncOperation.opId` | Único. Mismo `opId` + mismo payload → `skipped` / `already_applied`. Mismo `opId` + payload distinto → `payload_mismatch`. `failed` → **no reaplicar** (hace falta **nuevo `opId`**) |
| `Sale.id` en `createSaleTx` | Si viene `dto.id` y ya existe en la tienda → **devuelve la venta** sin volver a descontar stock |
| `sale.id` en sync payload | **Opcional** hoy (`typeof s.id === 'string' ? s.id : undefined`) |

**Hueco peligroso:** si el FE **no manda `sale.id` estable** y genera un **nuevo `opId`** tras un fallo o ACK perdido, el server crea **otra venta** (duplicado).

**Parcialmente seguro:** si el FE siempre manda el mismo `sale.id` UUID del ticket local, incluso con `opId` nuevo, `createSaleTx` no duplica líneas/stock. El sync igual puede crear otro `SyncOperation` “applied” — OK como auditoría, no como segunda factura.

### 12.3 Objetivo (ideal) — B1.5 / refuerzo B1

1. **`sale.id` obligatorio** en `sync/push` SALE (y recomendado en `POST /sales` desde POS).
2. Idempotencia en dos capas:
   - por **`opId`** (como ahora),
   - por **`sale.id`**: si la venta ya existe → tratar como éxito idempotente (`acked` o `skipped` con reason `sale_already_exists`), **sin** fallar ni descontar de nuevo.
3. Contrato FE:
   - 1 ticket local = 1 `sale.id` para siempre.
   - Reintento con mismo payload → preferir **mismo `opId`**.
   - Solo **nuevo `opId`** si el anterior quedó `failed` y el payload se **corrigió**; el `sale.id` **no cambia**.

### 12.4 ¿Tabla “cola pendiente” en el server?

**No** como reemplazo de la cola del dispositivo.

| Enfoque | Veredicto |
|---------|-----------|
| Borrar del dispositivo y dejar solo tabla server de pendientes | **No.** Si nunca llegó el push, el server no tiene el ticket → se pierde la venta |
| Cola local hasta ACK + espejo opcional en cierre | **Sí** |
| `SyncOperation` failed/applied como historial server | **Ya existe** — usarlo |

**Modelo recomendado:**

```text
Dispositivo (fuente hasta ACK)
  sale_local + sync_queue
       │ push
       ▼
Server
  Sale (idempotente por id) + SyncOperation (por opId)
       │ ack
       ▼
Dispositivo marca synced y SOLO ENTONCES puede archivar/quitar de “pendientes activos”
```

En el **cierre de caja**:

1. Intentar vaciar cola (push + pull).
2. Lo que **siga pendiente** permanece en el dispositivo (bandeja “pendiente crítica”), **no se borra**.
3. Al cerrar, el device envía un resumen al server, p. ej. en `CashSession.close`:

```json
{
  "pendingSales": [
    { "saleId": "...", "opId": "...", "total": "12.50", "createdAt": "..." }
  ],
  "pendingCount": 3,
  "closeMode": "OFFLINE" | "ONLINE"
}
```

Eso es una **declaración de pendientes del turno** (ops/admin), no la cola ejecutable. La cola ejecutable sigue en el POS hasta ACK.

Opcional B2: tabla `CashSessionPendingSale` (saleId, opId, payload snapshot, sessionId) **solo como auditoría del cierre**, sin borrar el local.

### 12.5 Fallos que no son “sin internet”

| Tipo | Qué hacer (FE) | Qué hacer (BE) |
|------|----------------|----------------|
| Red / timeout / 5xx | Reintentar mismo `opId` + mismo `sale.id`; no bloquear caja | Idempotencia sale.id + opId |
| Validación corregible (tipos, FX) | Nuevo `opId`, **mismo `sale.id`**, payload fijo | `failed` en SyncOperation; no duplicar Sale |
| Stock (post B1) | No debería fallar productos normales | Allow negative + warnings |
| Producto restringido | PIN local / quitar línea | Reject solo restricted |
| ACK perdido tras éxito | Reintento → `already_applied` o `sale_already_exists` → limpiar cola | Ya casi; reforzar por sale.id |
| Failed permanente ilegible | Bandeja “requiere revisión”; caja sigue vendiendo | Ops metrics |

**Regla de producto:** un pendiente en cola **nunca interrumpe** nuevas ventas. Solo el **cierre** exige revisar/intentar sync (y puede cerrar offline con pendientes declarados).

### 12.6 Checklist extra (añadir a B1)

- [ ] Exigir `sale.id` UUID en parse SALE sync
- [ ] Antes de `createSaleTx`, si `Sale` existe por id+store → `acked`/`skipped` `sale_already_exists` (sin side effects)
- [ ] Tests: dos pushes distinto `opId`, mismo `sale.id` → una sola `Sale`, stock una vez
- [ ] Tests: ACK perdido + reintento mismo `opId` → skipped, sin duplicar
- [ ] Doc FE: ticket.id = sale.id estable; nunca regenerar sale.id al reintentar
- [ ] B2 cierre: payload `pendingSales[]` en close session; FE no borra cola sin ACK

### 12.7 Respuesta corta a tu pregunta

- **¿Duplicar factura?** Se evita con **`sale.id` estable + obligatorio** y tratarlo como clave de idempotencia además del `opId`.
- **¿Tabla cola en server y quitar del dispositivo?** No quitar del dispositivo hasta ACK. Sí: resumen de pendientes en cierre + historial `SyncOperation`.
- **¿Fallos que no son red?** Clasificar, reintentar o dead-letter en bandeja; **la caja sigue operando**; el cierre intenta transmitir y deja constancia de lo pendiente.


