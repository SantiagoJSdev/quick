# POS — Tickets en espera (held / parked)

Documento alineado con el análisis *pos_tickets_en_espera_frontend_backend* y con el API real de Quick Market. **Copiar al repo Flutter** (ver `docs/flutter/DOCUMENTOS_A_COPIAR_AL_PROYECTO_FLUTTER.md`).

---

## 1. Objetivo

Permitir que el cajero **guarde un carrito sin cobrar** (cliente va por efectivo/tarjeta), **recuperarlo** después y **cobrar** en ese momento. Hasta el cobro **no** debe haber venta confirmada ni movimiento de inventario.

---

## 2. Decisión de arquitectura (obligatoria)

| Enfoque | ¿Correcto? |
|---------|------------|
| Tratar el ticket en espera como `Sale` ya confirmada en backend | **No** |
| Enviar ticket en espera como `SALE` en `sync/push` | **No** |
| Modelar **borrador local** (`ON_HOLD`) separado de venta confirmada y de `localops` definitivos | **Sí (fase 1)** |

**Motivos:**

1. **Inventario:** el backend descuenta stock al **confirmar** venta (`POST /sales` o `sync/push` con `SALE`), no al armar carrito.
2. **Historial:** no mezclar tickets no cobrados con ventas reales.
3. **Sync:** `localops` / `sync/push` son para operaciones **ya decididas** (con `opId` e idempotencia sobre efectos reales), no para carritos temporales.

Referencias en este repo:

- Ventas REST: `docs/FRONTEND_INTEGRATION_CONTEXT.md` (sección ventas).
- Sync `SALE`: `docs/api/SYNC_CONTRACTS.md`.

---

## 3. Estados del POS (conceptual)

| Estado | Significado | Persistencia | ¿Descuenta stock? |
|--------|-------------|--------------|-------------------|
| **ACTIVE_CART** | Carrito abierto en pantalla | Memoria + opcional borrador | No |
| **ON_HOLD** | Ticket guardado / en espera | **SQLite** (fase 1); opcional servidor (fase 2) | No |
| **SYNC_PENDING** | Venta ya cobrada offline, pendiente de enviar | `localops` | Sí (decisión local ya tomada) |
| **CONFIRMED** | Venta aceptada por servidor | PostgreSQL `Sale` | Sí |
| **VOIDED_HOLD** | Ticket en espera descartado | Borrar local o marcar | No |

La clave: **ON_HOLD** no es `Sale`, no es `SyncOperation`, no genera `StockMovement`.

---

## 4. Fase 1 recomendada (solo app — sin endpoints nuevos)

### Backend (este repo)

- **Sin** migraciones ni módulos nuevos.
- **Sin** `POST` de “ticket en espera” al servidor.
- Contrato existente **solo al cobrar**:
  - Online: **`POST /api/v1/sales`** con `X-Store-Id`, `documentCurrencyCode`, `fxSnapshot`, `lines[]`, opcional `deviceId`, `id` (idempotencia), etc.
  - Offline: operación **`SALE`** en **`POST /api/v1/sync/push`** según `SYNC_CONTRACTS.md`.

### Frontend (Flutter)

1. Entidad local **`HeldTicket`** persistida en **SQLite** (no solo en memoria).
2. Tablas sugeridas: **`held_tickets`**, **`held_ticket_lines`**.
3. Separación estricta:
   - **`localops`** = cola de sync para ops **definitivas** (venta cobrada offline, ajustes, etc.).
   - **`held_tickets`** = borradores recuperables; **no** duplicar como fila en `localops` hasta el cobro.

---

## 5. Modelo de datos local sugerido (`HeldTicket`)

Valores string para decimales donde el API también usa string.

```json
{
  "id": "uuid-v4",
  "storeId": "uuid-tienda",
  "deviceId": "uuid-estable-por-instalacion",
  "status": "ON_HOLD",
  "alias": "Cliente camisa azul",
  "customerName": null,
  "documentCurrencyCode": "VES",
  "fxSnapshot": {
    "baseCurrencyCode": "USD",
    "quoteCurrencyCode": "VES",
    "rateQuotePerBase": "36.50",
    "effectiveDate": "2026-04-06",
    "fxSource": "POS_PREVIEW"
  },
  "lines": [
    {
      "productId": "prod-uuid-1",
      "name": "Arroz 1kg",
      "quantity": "2",
      "price": "91.25",
      "discount": "0",
      "currency": "VES"
    }
  ],
  "totals": {
    "subtotal": "182.50",
    "discount": "0",
    "total": "182.50",
    "totalFunctional": "5.00"
  },
  "createdAt": "2026-04-06T20:10:00-04:00",
  "updatedAt": "2026-04-06T20:12:00-04:00",
  "heldByUserId": null
}
```

- **`deviceId`:** estable por instalación (ya lo usa el backend en ventas; coherente con `POST /sales`).
- **`fxSnapshot`:** referencia visual al guardar; al **cobrar**, el cliente puede **mantener** esa tasa o **refrescar** con `GET /exchange-rates/latest` y mostrar aviso si cambió (alineado a snapshots históricos en venta confirmada).
- **`name` en línea:** snapshot para lista offline; al cobrar se valida `productId` contra catálogo/servidor.

---

## 6. Esquema SQLite (borrador)

**`held_tickets`**

- `id` TEXT PK  
- `store_id` TEXT NOT NULL  
- `device_id` TEXT NOT NULL  
- `status` TEXT NOT NULL  
- `alias` TEXT  
- `customer_name` TEXT  
- `document_currency_code` TEXT NOT NULL  
- `fx_snapshot_json` TEXT NOT NULL  
- `totals_json` TEXT NOT NULL  
- `created_at` TEXT NOT NULL  
- `updated_at` TEXT NOT NULL  
- `held_by_user_id` TEXT  

**`held_ticket_lines`**

- `id` TEXT PK  
- `held_ticket_id` TEXT NOT NULL FK → `held_tickets.id` ON DELETE CASCADE  
- `product_id` TEXT NOT NULL  
- `name_snapshot` TEXT  
- `quantity` TEXT NOT NULL  
- `price` TEXT NOT NULL  
- `discount` TEXT  
- `currency` TEXT  

Índices: `(store_id, device_id)`, `(updated_at DESC)` para listar.

---

## 7. UX (resumen implementable)

### 7.1 POS principal

- Barra inferior del ticket: **`En espera`** · **`Cobrar`** · **`Cancelar`**  
  - *En espera* = acción secundaria, no destructiva (icono pausa / reloj / bandeja).
- Badge: **`Guardados (N)`** visible si `N > 0`.

### 7.2 Modal “Guardar ticket”

- Campos: **alias** (opcional), nota opcional.
- Texto guía: *“Guarda este ticket para retomarlo luego sin cobrarlo ahora.”*
- Al confirmar: persistir `HeldTicket`, limpiar carrito activo, incrementar badge.

### 7.3 Lista “Tickets en espera”

Por tarjeta: alias, hora, cantidad de ítems, total documento (+ funcional si aplica), estado **En espera**.  
Acciones: **Recuperar**, **Renombrar**, **Eliminar**; opcional **Duplicar**.

### 7.4 Regla: un solo carrito activo editable

Al **Recuperar**:

- Si carrito vacío → cargar ticket en carrito activo.
- Si carrito con ítems → diálogo: **Reemplazar** / **Guardar actual y abrir este** / **Cancelar**.

### 7.5 Tras recuperar

- Banner: *“Ticket recuperado desde guardados”*.

### 7.6 Al cobrar con éxito

- Eliminar fila local `held_tickets` (y líneas) **o** marcar estado local `CONVERTED` si en el futuro hay servidor.
- No dejar el ticket en lista de guardados.

---

## 8. Mapeo al cobro (contrato backend actual)

### Online — `POST /api/v1/sales`

Construir el body a partir del carrito recuperado (mismos campos que una venta normal):

- `lines[]`: `productId`, `quantity`, `price`, `discount` opcional.  
- `documentCurrencyCode`, `fxSnapshot` (el que elijas al confirmar: guardado o actualizado).  
- `deviceId` recomendado (mismo criterio que hoy).  
- `id` UUID cliente recomendado para idempotencia ante reintentos de red.

Detalle y ejemplos: **`docs/FRONTEND_INTEGRATION_CONTEXT.md`** § ventas / JSON pantalla.

### Offline — `sync/push` con `opType: SALE`

Solo cuando la venta **ya está cobrada** en lógica de negocio local; payload según **`docs/api/SYNC_CONTRACTS.md`**.

---

## 9. Casos borde

| Caso | Comportamiento sugerido |
|------|-------------------------|
| App cerrada con tickets en espera | Rehidratar desde SQLite al abrir. |
| Cancelar ticket en espera | Eliminar localmente (`VOIDED_HOLD`); sin llamadas API. |
| Precio de producto cambió en servidor | Al cobrar: advertir; permitir mantener precios del ticket o recalcular desde catálogo. |
| Stock insuficiente al cobrar | Error de negocio **en el checkout** (REST o respuesta sync); no al poner en espera. |
| Tasa FX cambió desde que se guardó | Aviso UI: *Mantener tasa guardada* / *Actualizar a tasa actual*. |
| Tickets muy viejos | Solo UI al inicio (ej. “hace 10 min”); limpieza local opcional (ej. > 7 días). |

**MVP:** no reservar stock al poner en espera (el campo `reserved` en inventario existe en modelo pero no hay flujo completo de reservas en API para esto).

---

## 10. Fase 2 opcional (backend — no implementada hoy)

Si necesitás **varias cajas/tablets** viendo los mismos tickets:

- Módulo **`parked-sales`** (nombre tentativo): CRUD por `storeId` / `deviceId`, estados `ON_HOLD | RESUMED | CANCELLED | EXPIRED | CONVERTED`.
- Endpoint útil: **`POST /parked-sales/:id/checkout`** — valida `ON_HOLD`, ejecuta la misma transacción que `POST /sales`, marca `CONVERTED`.

Hasta entonces, la fase 1 **no requiere** estos endpoints.

---

## 11. Checklist Flutter (fase 1)

- [ ] Modelo `HeldTicket` + repositorio SQLite (`held_tickets` / `held_ticket_lines`).  
- [ ] Botón **En espera** + modal alias + persistencia + limpiar carrito.  
- [ ] Pantalla / bottom sheet **Tickets en espera** + badge con contador.  
- [ ] **Recuperar** con regla de carrito ocupado.  
- [ ] **Cobrar** → `POST /sales` (online) o encolar `SALE` (offline) según conectividad.  
- [ ] Tras 200 / ack: borrar ticket local.  
- [ ] Documentar en README Flutter que **held ≠ Sale ≠ sync op**.

---

## 12. Checklist backend (fase 1)

- [x] Política explícita: ticket en espera **no** es venta ni sync (este documento + enlaces).  
- [ ] (Opcional) Una línea en `IMPLEMENTATION_TRACKER.md` o README si querés trackear “held tickets = solo cliente”.

---

*Última alineación con backend Quick Market: ventas M4 + sync `SALE` documentados; sin `parked-sales` en código hasta fase 2.*
