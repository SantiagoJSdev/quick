# Sugerencia de implementación frontend (Flutter) — venta offline + stock configurable

**Estado:** decisiones cerradas (alineado a backend)  
**Depende de:** [`POS_NEGATIVE_STOCK_BACKEND_IMPLEMENTATION.md`](./POS_NEGATIVE_STOCK_BACKEND_IMPLEMENTATION.md)  
**Base actual:** [`FRONTEND.md`](./FRONTEND.md) (cola, auto-sync ~90s, cache catálogo/FX, `opId`)

Este documento **no reemplaza** `FRONTEND.md`; lo complementa para el epic de stock negativo / cierre.

---

## 0. Decisiones cerradas (2026-07-25)

| # | Decisión |
|---|---------|
| 1 | Política tienda: permitir negativo **para todas** (cache FE default true) |
| 2 | `blockSaleWithoutStock` en producto — respetar en UI |
| 3 | Stock local puede quedar **&lt; 0** (como Square) |
| 4 | Mostrar warnings de sync **y** flag en venta local |
| 5 | **Cierre de caja** en este mismo epic |
| 6 | **Precio congelado al agregar al carrito** (ver §4.4) |
| 7 | Producto desactivado: **sí cobrar** si ya estaba en el carrito; offline OK + sync/cierre al final |
| 8 | PIN supervisor: **solo app** |
| 9 | Cierre de caja **obligatorio** al fin de turno (aunque haya sync continuo; offline total → transmitir al final/reconectar) |
| 10 | Inventario: mostrar **`-2`** real |

---

## 1. Objetivo UX

- Cobrar **siempre** en caja para productos normales (online u offline).
- El backend **no es gate** del cobro.
- Stock insuficiente = **advertencia + incidencia**, no freno (salvo restringidos).
- Precio/FX del ticket = **snapshot** al cobrar (o al agregar línea — ver §5).
- Sync **continuo** + **cierre de caja** como control de turno (no como único push).

---

## 2. Dependencias del backend (B1)

Antes o en paralelo al FE “completo”, el POS necesita:

| Dato | Uso FE |
|------|--------|
| `BusinessSettings.allowNegativeStockAtPos` | Decidir si mostrar “puede quedar negativo” vs bloquear |
| `BusinessSettings.warnOnNegativeStock` | Intensidad del modal |
| `BusinessSettings.blockRestrictedProductsWithoutStock` | Flujo PIN / bloqueo |
| `Product.blockSaleWithoutStock` (o equivalente) | Línea restringida |
| `warnings[]` en venta / `acked` | Mostrar resultado post-sync |
| `Sale.stockConflictDetected` | Historial / cierre |

**Hasta que B1 esté en prod:** el FE puede implementar cobro offline optimista, pero las ops seguirán fallando en sync por `Insufficient stock` (comportamiento actual). Coordinar release.

---

## 3. Modelo local sugerido (SQLite / Drift / Hive)

### 3.1 Ya alineado (mantener)

- Catálogo + precios + `unit` + `active`.
- Settings + FX cache.
- Cola sync: `opId`, `opType`, payload, status local (`pending` / `synced` / `failed`).
- Auto-sync ~90s + al reconectar; pull tras push OK.

### 3.2 Añadir / extender

| Entidad local | Campos nuevos |
|---------------|---------------|
| `settings_cache` | `allowNegativeStockAtPos`, `warnOnNegativeStock`, `blockRestricted...` |
| `products_cache` | `blockSaleWithoutStock`, `stockQty`, `stockVerifiedAt`, `stockStatus` |
| `sale_draft` / ticket | líneas con `unitPriceSnapshot`, `addedAt` |
| `sale_local` | confirmada localmente: totales, payments, FX snapshot, `deviceId`, `storeId`, `opId` |
| `sale_line_local` | `productId`, qty, price snapshot, flags UI |
| `sync_queue` | mapear `acked.warnings` → nota en venta local |
| `cash_session` (B2) | abierto/cerrado, conteo efectivo, summary |

### 3.3 Estados de stock en UI (por producto)

| `stockStatus` | Criterio sugerido |
|---------------|-------------------|
| `exact` | Online reciente + pull &lt; N min |
| `estimated` | Offline o pull viejo, qty local |
| `unverified` | Sin qty local / nunca pulled |
| `may_go_negative` | qty local &lt; pedida y política permite |

---

## 4. Flujos

### 4.1 Cobro (happy path)

```text
1. Operador cobra
2. Validar pagos = total ticket (local)
3. Persistir sale_local CONFIRMED + encolar SALE (nuevo opId)
4. Actualizar stock local: qty -= sold (puede quedar < 0)
5. Imprimir / mostrar éxito (no esperar server)
6. Background: sync push → pull
```

### 4.2 Stock insuficiente al agregar o al cobrar

```text
si available_local >= qty → OK
si no:
  si product.blockSaleWithoutStock || (!settings.allowNegativeStock):
    bloquear + (opcional) pedir PIN supervisor local
  si no:
    si warnOnNegativeStock:
      modal "Continuar y registrar incidencia"
    else:
      warning soft en línea
    permitir
```

### 4.3 Sync

- Intervalo 90s + reconnect (ya documentado).
- Tras `acked`: marcar cola synced; si `warnings` → badge “incidencia stock” en venta.
- Tras `failed`:
  - Si reason stock y backend aún viejo: mostrar “pendiente de política server”.
  - Si `failed` definitivo (validación): **nuevo opId** tras corregir (nunca reenviar mismo opId fallido).
  - `already_applied` / skipped → limpiar cola (evitar “fantasma en cola”).

### 4.4 Precio del carrito (decisión #6) — explicación

Hay dos momentos posibles para fijar el precio:

| Momento | Qué pasa |
|---------|----------|
| **A — Al agregar al carrito** (elegido) | El cajero escanea “Gaseosa $2.00”. Ese `$2.00` queda en la línea. Si media hora después el admin sube el precio a `$2.50` y hay pull, **el carrito sigue a $2.00**. El cliente paga lo que le mostraste. |
| **B — Al cobrar** | La línea se reprecioa al catálogo actual al pulsar Cobrar. Puede sorprender al cliente si el precio cambió mientras esperaba. |

**Regla adoptada:** A — congelar al agregar.  
Tickets ya confirmados **nunca** se recalculan tras un pull.

### 4.5 Producto desactivado en pull

- No agregar productos inactivos nuevos al carrito.
- Si ya está en el carrito abierto: **permitir cobrar** (offline-first; la transmisión/cierre lo resuelven después).

### 4.6 Cierre de caja (mismo epic) — obligatorio · API lista

**Contrato:** [`api/CASH_SESSIONS.md`](./api/CASH_SESSIONS.md)

| Método | Ruta |
|--------|------|
| `POST` | `/api/v1/cash-sessions` |
| `GET` | `/api/v1/cash-sessions/current?deviceId=` |
| `GET` | `/api/v1/cash-sessions/:id` |
| `GET` | `/api/v1/cash-sessions/:id/summary` |
| `POST` | `/api/v1/cash-sessions/:id/close` |

Aunque haya sync continuo durante el día, **siempre** se hace cierre de turno.

Flujos válidos:

1. **Online / semi-online:** ventas se empujan en background; al cierre se fuerza push+pull, se cuenta efectivo y se congela el resumen.
2. **100% offline:** se vende y se cierra el turno en local; al reconectar se transmite la cola + se cierra/sincroniza la sesión en server.

Botón **Cerrar caja** (cajero/supervisor):

1. Contar efectivo (input monto físico).
2. Intentar sync push + pull (si hay red; si no, marcar “cierre offline pendiente de transmitir”).
3. Pantalla resumen:
   - ventas del turno (synced + pendientes),
   - ops failed,
   - productos con stock **negativo real** (ej. `-2`),
   - diferencia efectivo vs sistema,
   - conflictos stock post-sync.
4. Confirmar cierre → `cash_session` closed (local + API B2 cuando exista).

El cierre **no reemplaza** el sync continuo; es el control administrativo del turno.

### 4.7 PIN supervisor

Solo validación **local en la app** (no llamar al backend). Usar para productos `blockSaleWithoutStock` u otras acciones sensibles.

---

## 5. UI concreta

### 5.1 Barra global

- Online / Offline.
- Contador pendientes de cola.
- Última sync OK (hora VE).
- Indicador “catálogo desactualizado” si pull &gt; umbral.

### 5.2 Línea de producto (POS)

- Chip: Exacto | Estimado | Sin verificar | Puede quedar negativo.
- Restringido: icono candado.

### 5.3 Modal cobro con riesgo

- Título: “Stock insuficiente”
- Cuerpo: producto, pedido vs disponible local.
- Acciones: Cancelar | Continuar.
- Si restringido: campo PIN supervisor.

### 5.4 Bandeja de incidencias (simple)

Lista: ventas con warning stock / failed sync / negativo local.  
Entrada desde icono en shell.

---

## 6. Plan de sprints FE sugerido

### F1 — Desacoplar cobro del server (puede empezar ya)

- [ ] Confirmar venta 100% local antes de push.
- [ ] Quitar cualquier `await` de verificación stock online en cobro.
- [ ] Stock local decrementado al confirmar.
- [ ] Limpiar cola en `skipped` / `already_applied`.
- [ ] Tests: offline cobro → cola → sync.

### F2 — Política + warnings (tras B1 backend)

- [ ] Cache settings/product flags.
- [ ] Chips de estado stock.
- [ ] Modal negativo / PIN restringidos.
- [ ] Persistir y mostrar `warnings` post-sync.
- [ ] QA: dos emuladores último ítem → ambas ventas OK tras B1.

### F3 — Cierre de caja

- [ ] UI cierre + resumen local.
- [ ] Integrar API `cash-sessions` cuando B2 exista.
- [ ] Checklist obligatorio de pendientes (según `requireSuccessfulSyncAtClose`).

### F4 — Pulido

- [ ] TTL precio carrito.
- [ ] Política producto desactivado en carrito.
- [ ] Reportes locales de negativos del turno.

---

## 7. Contratos que el FE debe respetar

1. Montos y qty en JSON del sync = **strings**.
2. Nuevo `opId` si la op quedó `failed` en server.
3. `deviceId` estable + `X-Store-Id` correcto.
4. Snapshot FX en venta offline (`fxSnapshot` completo o omitir).
5. No recalcular `Sale` confirmada tras pull.
6. Ignorar campos extra en `acked` (`warnings`) para forward-compat.

Detalle sync: [`api/SYNC_PUSH_SALE.md`](./api/SYNC_PUSH_SALE.md).

---

## 8. Criterios de aceptación FE

- [ ] Offline: cobrar producto sin stock local → ticket OK, cola pending, UI no bloquea (si política local lo permite).
- [ ] Online con B1: sync aplica y no deja failed por stock insuficiente en productos normales.
- [ ] Restringido sin stock: no cobra sin PIN / bloqueo.
- [ ] Precio del ticket no cambia tras pull de precios.
- [ ] Cierre muestra pendientes y negativos (aunque B2 server aún mock local).
- [ ] Cola no se queda “fantasma” tras `already_applied`.

---

## 9. Riesgos FE

| Riesgo | Mitigación |
|--------|------------|
| Release FE antes que B1 | Ops fallan por stock; comunicar o feature-flag “optimistic stock” off |
| Stock local diverge | Pull frecuente + ajuste inventario; cierre concilia |
| Doble cobro UX | Idempotencia local por ticket id + opId |
| PIN solo local | Suficiente B1; server PIN en B3 |

---

## 11. Idempotencia y cola (resumen FE)

### Nunca duplicar una venta

1. Al confirmar cobro local: generar **`sale.id` (UUID)** y **`opId` (UUID)** una sola vez.
2. Encolar `SALE` con `payload.sale.id = sale.id`.
3. Reintentos por red: **mismos** `sale.id` y `opId`.
4. Solo si el server respondió `failed` y corriges el payload: **nuevo `opId`**, **mismo `sale.id`**.
5. Tras `acked` / `skipped` / `already_applied` / `sale_already_exists` → sacar de cola activa.

### No borrar pendientes del dispositivo sin ACK

Aunque el cierre declare pendientes al server, la cola local **sigue** hasta confirmación. Si se borra antes, se puede perder la venta si nunca llegó.

### Cierre con pendientes

- Intentar sync.
- Si quedan: cerrar igual (modo offline/parcial), mostrar lista, marcar “pendiente crítica”.
- Al reconectar: seguir empujando sin bloquear nuevas ventas del siguiente turno.

### Fallos ≠ solo internet

Validación, stock restringido, etc. → bandeja de revisión; **POS sigue cobrando**. Solo productos restringidos / PIN bloquean ese ticket, no el dispositivo entero.
