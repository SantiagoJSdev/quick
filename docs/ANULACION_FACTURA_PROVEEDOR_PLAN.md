# Anulación de factura de proveedor — análisis + plan Front/Back

Documento de **análisis y plan de implementación** para anular una compra/factura de proveedor ya registrada, **incluso si parte (o toda) la mercancía ya se vendió**.

> Estado: **Backend P0 listo** (2026-08-13). Contrato en [`api/PURCHASES.md`](./api/PURCHASES.md). Front puede implementar preview → confirm + PIN.  
> Relacionado: [`FACTURA_PROVEEDOR_DEUDA_E_INVENTARIO_FRONTEND.md`](./FACTURA_PROVEEDOR_DEUDA_E_INVENTARIO_FRONTEND.md), hub Facturas (Flutter), [`CAPITAL_OPERATIVO_SQL_Y_ESTADISTICAS_DASHBOARD.md`](./CAPITAL_OPERATIVO_SQL_Y_ESTADISTICAS_DASHBOARD.md).

---

## 1. Problema de negocio

Hoy el operador puede:

1. Cargar una factura de proveedor (contado / crédito / parcial).
2. Subir stock por líneas (`IN_PURCHASE`).
3. Vender esa mercancía en el POS.
4. Abonar o pagar la deuda.

**No puede** corregir un error de carga (factura duplicada, proveedor equivocado, cantidades/costos mal digitados, factura que el proveedor anula) de forma controlada.

Casos reales:

| Caso | Qué necesita el negocio |
|------|-------------------------|
| A | Factura cargada por error, **aún no se vendió nada** | Anular → bajar stock → limpiar deuda/pagos |
| B | Ya se vendió **parte** del lote | No se puede “devolver” al inventario lo ya vendido; hay que decidir política |
| C | Ya se vendió **todo** | Anular solo el documento financiero / deuda, o bloquear y exigir nota de crédito |
| D | Hubo **abonos** a la factura | Revertir o dejar rastro de pagos vs. saldo |
| E | Impacto en **ganancia / capital** | COGS ya reconocido en ventas no debe “desaparecer” sin reglas claras |

---

## 2. Qué existe hoy (gap)

### Backend F2 (documentado)

- `POST /purchases`, `GET /purchases`, `GET /purchases/payables`, `GET /purchases/:id`, `POST /purchases/:id/payments`
- Sync `PURCHASE_RECEIVE`
- Stock: movimiento `IN_PURCHASE` al crear

**No hay:** anular / void / reverse purchase, nota de crédito de compra, ni sync `PURCHASE_VOID`.

### Front (hub Facturas)

- Crear, listar, detalle, deuda, abonos
- **No hay** botón ni flujo de anulación

---

## 3. Cómo lo resuelven otras aplicaciones (patrones)

Las apps POS / ERP serias **casi nunca** borran la compra. Usan **documento de anulación o nota de crédito** con auditoría.

### 3.1 Estrategias comunes

| Estrategia | Idea | Pros | Contras |
|------------|------|------|---------|
| **1. Bloqueo duro** | Solo anular si stock “aún disponible” ≥ qty de cada línea (FIFO/lote o qty actual ≥ recibida) | Simple, no rompe COGS | En retail sin lotes es ambiguo; si ya vendió, no puede anular |
| **2. Anulación parcial de stock** | Revierte solo `min(qty_factura, stock_actual)` por producto; el resto queda como “ya consumido” y exige confirmación + motivo | Flexible | Hay que documentar que el capital/deuda se ajusta distinto al stock |
| **3. Nota de crédito proveedor (NC)** | No “borra” la factura; crea documento que cancela saldo y opcionalmente genera salida de stock si hay devolución física | Estándar contable | Más modelos/UI |
| **4. Solo anulación financiera** | Marca factura `VOID` / saldo 0 sin tocar stock (si el error era solo de deuda) | Útil si el stock está bien | Peligroso si el error era de recepción |
| **5. Soft-delete + ajuste manual** | Anula documento y deja que el usuario ajuste stock a mano | Rápido de codear | Pierde trazabilidad; no recomendado como único camino |

### 3.2 Qué suelen hacer los POS de minimarket / retail

1. **No hard-delete** del historial.
2. Exigen **motivo** + usuario/PIN.
3. Si hay stock suficiente (heurística): generan movimiento inverso y cierran deuda.
4. Si **no** hay stock suficiente (porque se vendió):  
   - **bloquean** anulación completa, **o**  
   - permiten anulación **solo del saldo / documento** con warning, **o**  
   - ofrecen **anulación parcial** + “el faltante ya se vendió; no se descuenta del inventario”.
5. Los **abonos** no se borran en silencio: se revierten con movimiento de caja/pago inverso o quedan vinculados a la NC.
6. Las **ventas ya hechas** no se reescriben: el COGS de esas ventas permanece (la anulación no “deshace” tickets).

### 3.3 Recomendación para Quick POS

Adoptar un híbrido claro (**estrategia 2 + rastro tipo NC**):

```text
POST /purchases/:id/void  (o POST /purchase-voids)

1. Evaluar por línea cuánto se puede revertir de stock.
2. Revertir stock solo en lo reversible.
3. Cerrar / anular el documento de compra (deuda → 0; status VOID/CANCELLED).
4. Tratar abonos según política (ver §5).
5. Devolver al front un reporte: qué se revirtió, qué no (ya vendido / sin stock), warnings.
```

**No** reabrir ni editar ventas históricas.  
**No** borrar físicamente `Purchase` / `PurchaseLine`.

---

## 4. Análisis de inventario cuando “ya se vendió”

Sin trazabilidad lote→venta (Quick POS hoy parece **qty agregada** por producto), **no se puede saber** “estas 3 unidades vendidas salieron de esta factura”. Solo se puede inferir:

```text
qty_recibida_en_factura     = L.quantity
qty_stock_actual            = InventoryItem.quantity   // puede ser negativo (B1)
qty_potencialmente_vendida  ≈ max(0, qty_recibida - max(0, stock_actual))  // heurística débil
qty_reversible              = clamp( min(qty_recibida, max(0, stock_actual) ), 0, qty_recibida )
```

### 4.1 Reglas propuestas (v1)

Para cada línea de la factura a anular:

| Condición | Acción de stock |
|-----------|-----------------|
| `stock_actual >= qty_línea` | Revertir **toda** la qty (`OUT_PURCHASE_VOID` o `ADJUST` ligado a void) |
| `0 < stock_actual < qty_línea` | Revertir solo `stock_actual`; marcar resto como `notReversibleBecauseSoldOrConsumed` |
| `stock_actual <= 0` | **No** revertir stock en esa línea; aviso “sin unidades disponibles (posible venta o stock negativo)” |

### 4.2 Deuda / totales al anular

Independiente del stock:

- Factura pasa a `status = VOID` (o `paymentStatus` dedicado + flag `voidedAt`).
- `amountDueFunctional = 0`.
- No aparece en `payables`.
- Queda visible en listados con filtro “Anuladas” (auditoría).

### 4.3 Abonos ya registrados

Elegir **una** política (decisión abierta §9); recomendación v1:

**Política R1 — Reversión lógica de pagos (recomendada):**

- Al anular, el backend registra `PurchasePayment` inversos o marca pagos como `reversed`.
- Si hubo dinero real entregado al proveedor, eso es **operativo de caja** (el dueño lo gestiona); el sistema deja el rastro “abono revertido por anulación de factura”.
- Opcional v1.1: integrar con cash session / movimiento de caja.

**Política R2 — Bloquear anulación si hay abonos:**

- Obliga a “deshacer” abonos antes (más fricción, más seguro para caja).

### 4.4 Contado (PAID) vs crédito

- **Crédito / parcial:** anular elimina deuda pendiente; abonos según R1/R2.
- **Contado:** no hay deuda; anulación es sobre stock + documento. Si el pago contado se modeló como abono inicial, aplicar la misma política de pagos.

### 4.5 Impacto en capital / estadísticas

- Inventario valorizado baja solo por lo **realmente revertido**.
- Deuda baja a 0 para esa factura.
- Ganancia de ventas **ya hechas** no se recalcula (correcto).
- Si se anuló factura pero quedó mercadería “fantasma” contable porque ya se vendió: el warning del API debe quedar en UI para que el dueño entienda el desfase.

---

## 5. Solicitud a Backend — contrato necesario

### 5.1 Modelo / campos nuevos (sugeridos)

```text
Purchase
  + status: OPEN | VOID          // o voidedAt + voidReason (sin romper paymentStatus)
  + voidedAt: DateTime?
  + voidedByDeviceId / voidedByUserRef?
  + voidReason: string (1..240)
  + voidMode: FULL_STOCK | PARTIAL_STOCK | FINANCIAL_ONLY

PurchaseVoid / o eventos en StockMovement
  - purchaseId
  - lines: [{ productId, quantityRequested, quantityReversed, quantitySkipped, skipReason }]
  - paymentsReversed: [...]
  - opId (idempotencia)
```

`paymentStatus` histórico se conserva (`PAID`/`CREDIT`/`PARTIAL`) **más** `status=VOID` para no perder el significado original.

### 5.2 Endpoint de evaluación (recomendado antes de confirmar)

```http
POST /api/v1/purchases/:id/void-preview
Header: X-Store-Id
Body: { }
```

**Response (ejemplo):**

```json
{
  "purchaseId": "...",
  "canVoid": true,
  "blockers": [],
  "lines": [
    {
      "productId": "...",
      "productName": "Arroz 1kg",
      "quantityPurchased": "10",
      "quantityReversible": "4",
      "quantitySkipped": "6",
      "skipReason": "INSUFFICIENT_STOCK_LIKELY_SOLD",
      "stockOnHand": "4"
    }
  ],
  "payments": {
    "amountPaidFunctional": "50.00",
    "policy": "REVERSE_ON_VOID",
    "willReversePayments": true
  },
  "debt": {
    "amountDueFunctionalBefore": "150.00",
    "amountDueFunctionalAfter": "0"
  },
  "warnings": [
    "6 u. no se restarán del inventario (stock insuficiente / posible venta)."
  ]
}
```

Si `canVoid=false`, `blockers` explica (ej. ya void, tienda incorrecta).

### 5.3 Endpoint de confirmación

```http
POST /api/v1/purchases/:id/void
Header: X-Store-Id
Body: {
  "opId": "<uuid>",
  "reason": "Duplicada / error de carga",
  "confirmPartialStock": true,
  "mode": "AUTO"
}
```

- `confirmPartialStock: true` obligatorio si el preview tiene `quantitySkipped > 0`.
- Idempotente por `opId`.
- Transacción única: stock + status VOID + deuda 0 + reversión de pagos según política.

**Response:** mismo shape que preview + `voidedAt` + ids de movimientos.

### 5.4 Listados

- `GET /purchases` debe poder filtrar `status=VOID` o `includeVoided=true`.
- `GET /purchases/payables` **excluye** void.
- `GET /purchases/:id` incluye `voidedAt`, `voidReason`, detalle de void si existe.

### 5.5 Sync offline (fase 2)

```text
opType: PURCHASE_VOID
payload: { purchaseId, opId, reason, confirmPartialStock }
```

v1 front puede ser **online-only** (como abonos). Offline en fase 2.

### 5.6 Movimientos de stock

Crear tipo explícito, ej. `OUT_PURCHASE_VOID` (o `IN_PURCHASE` negativo documentado), referenciando `purchaseId` / `voidOpId`, para auditoría y merma ≠ anulación.

### 5.7 Lo que Backend **no** debe hacer

- Borrar ventas ni recalcular COGS de tickets viejos.
- Hard-delete de `Purchase`.
- Dejar stock inconsistente si falla a mitad (todo-o-nada).
- Permitir void duplicado sin idempotencia.

---

## 6. Plan Front (cuando Backend entregue)

### 6.1 UI

1. **Detalle factura** → acción “Anular factura” (PIN admin, misma clave de módulos).
2. Pantalla / sheet **Preview**:
   - Tabla por línea: comprado / reversible / no reversible + motivo.
   - Deuda antes/después.
   - Abonos a revertir.
   - Warnings en rojo/ámbar.
   - Checkbox: “Entiendo que parte ya no está en stock (posible venta)”.
3. Motivo obligatorio.
4. Confirmar → snackbar + refrescar detalle/lista/deuda.
5. Listado: chip **ANULADA**; no ofrecer Abonar / Pagar todo.

### 6.2 API client

- `previewVoid(storeId, purchaseId)`
- `voidPurchase(storeId, purchaseId, body)`
- Modelos de preview/result

### 6.3 Permisos

- Solo con módulo Proveedores habilitado + PIN admin al confirmar.
- Online-only en v1.

### 6.4 No hacer en Front

- Inventar qty reversible sin preview del server.
- Ajustar stock “a ojo” con `INVENTORY_ADJUST` como sustituto de void (rompe deuda/auditoría).

---

## 7. Plan de implementación por fases

| Fase | Quién | Entrega |
|------|-------|---------|
| **P0** | Back | Campos `status/voidedAt/reason`, preview + void, stock reversible, payables excluye void, idempotencia `opId` |
| **P0** | Front | Botón anular + preview + confirmación + PIN + UI anulada |
| **P1** | Back+Front | Política de abonos R1 con movimientos explícitos; filtro “Anuladas” |
| **P2** | Back+Front | Sync `PURCHASE_VOID` offline |
| **P3** | Opcional | Nota de crédito formal / devolución física parcial al proveedor; vínculo caja |

**Orden:** Backend P0 → contrato en `api/PURCHASES.md` (o doc void) → Front P0 → pruebas cruzadas.

---

## 8. Criterios de aceptación

- [ ] Factura crédito sin ventas → void → stock baja qty completa → no está en payables → status ANULADA.
- [ ] Factura con ventas parciales → preview muestra skipped → void con confirmación → stock baja solo reversible → deuda 0 → ventas viejas intactas.
- [ ] Factura sin stock (todo vendido) → preview `quantityReversible=0` → void financiero permitido **solo** con confirmación explícita (o bloqueado si se elige política estricta).
- [ ] Reintento mismo `opId` no duplica salida de stock.
- [ ] Abonos: comportamiento según política R1 o R2 documentada y testeada.
- [ ] Usuario sin PIN no puede anular.
- [ ] Offline v1: mensaje claro “requiere conexión”.

---

## 9. Decisiones (cerradas v1 / Backend P0)

- [x] **Stock insuficiente:** void financiero / parcial con `confirmPartialStock` + warning
- [x] **Abonos:** R1 — `reversedAt` / `reversalNote` (no borrar)
- [x] **Contado PAID:** mismo flujo que crédito
- [x] **Stock negativo / ≤0:** qty reversible = 0 en esa línea
- [x] Status documental: `VOID`
- [x] PIN: solo app (front)

### Selección v1 implementada

| Tema | v1 |
|------|-----|
| Stock parcial | Permitir con `confirmPartialStock` |
| Todo vendido | Permitir void financiero + warning |
| Abonos | R1 (revertir lógicamente) |
| Offline | No en v1 |
| PIN | Clave admin app |

---

## 10. Texto breve para pasar a Backend (copiar/pegar)

> Necesitamos anular facturas de proveedor ya creadas (`Purchase`), **sin borrar el historial**, incluso si parte de la mercadería **ya se vendió**.  
>  
> Pedimos:  
> 1) `POST /purchases/:id/void-preview` que diga por línea cuánto stock se puede revertir vs cuánto se omite (stock insuficiente / probable venta).  
> 2) `POST /purchases/:id/void` idempotente (`opId`) con `reason` y `confirmPartialStock`, que: marque la compra como `VOID`, ponga deuda en 0 (fuera de payables), genere movimientos de stock solo por lo reversible, y aplique política clara sobre abonos (preferimos reversión lógica).  
> 3) No modificar ventas ni COGS históricos.  
> 4) Documentar contrato + tests.  
>  
> Front mostrará preview + confirmación con PIN y dejará la factura visible como anulada. Detalle en `docs/ANULACION_FACTURA_PROVEEDOR_PLAN.md`.

---

## 11. Próximos pasos

1. ~~Validar §9~~ / ~~Backend P0 + doc API~~ — hecho.  
2. Front: UI preview → confirm + PIN; listado con badge anulada (`includeVoided` / `status=VOID`).  
3. Pruebas de aceptación §8 en emulador + tienda demo.  
4. (Opcional) sync `PURCHASE_VOID` offline.

---

*Backend P0 listo — anulación de factura proveedor.*
