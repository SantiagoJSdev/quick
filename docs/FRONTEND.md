# Quick Market — Documentación Flutter (única)

**Único documento front.** Backend: [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md). Índice repo: [README.md](./README.md).

Contratos HTTP detallados (sync, compras): carpeta [api/](./api/).

---

## 1. Base de integración

| Tema | Regla |
|------|--------|
| API | `{API_BASE_URL}/api/v1` |
| Header | `X-Store-Id: <uuid>` en casi todo |
| Errores | `{ statusCode, error, message[], requestId }` |
| Montos | `String` decimal en JSON (no `double`) |
| Offline | Cola local → `POST /sync/push`; catálogo → `GET /sync/pull`; `opId` UUID |

**Config:** `lib/core/config/app_config.dart` · Emulador `10.0.2.2` · Dispositivo real IP LAN · `CONFIG_ADMIN_PIN` = PIN admin tienda (= `DASHBOARD_ADMIN_PIN` en servidor para kiosk).

**Importante:** headers como `X-Store-Id` van en la pestaña **Headers** de Postman/cliente, **no** en la URL.

---

## 2. Flujos por módulo (resumen)

| Módulo | Online | Offline |
|--------|--------|---------|
| Inicio | business-settings + exchange-rates | Cache local |
| Catálogo | CRUD products; `products-with-stock` + `Idempotency-Key` | Cola catálogo + cache |
| Inventario | GET + `POST /inventory/adjustments` + `opId` | Cola adjust |
| Venta | `POST /sales` | Op `SALE` en push |
| Compras | `POST /purchases` | Op `PURCHASE_RECEIVE` |
| Devoluciones | `POST /sale-returns` | Op `SALE_RETURN` |
| Proveedores | CRUD + sync `SUPPLIER_*` | Ver [api/SYNC_PUSH_SUPPLIERS.md](./api/SYNC_PUSH_SUPPLIERS.md) |
| Held tickets | Solo SQLite local | No sync hasta cobrar |
| Dashboard | §10 | Kiosk online-first |

---

## 3. Reglas transversales

### Multi-moneda
- Snapshot FX al confirmar venta/compra; no recalcular históricos.
- Pago en moneda ≠ documento → `fxSnapshot` en la línea de pago.

### Idempotencia
| Operación | Clave |
|-----------|--------|
| Sync / ajustes | `opId` |
| Ventas | `id` cliente opcional |
| Producto + stock | header `Idempotency-Key` |

### Sync
- Máx. 200 ops por push; **orden del array importa**.
- Líneas `SALE`: `quantity`, `price` como **strings** — [api/SYNC_PUSH_SALE.md](./api/SYNC_PUSH_SALE.md).
- `failed[]` con `details` → loguear; op fallida persistida necesita **nueva `opId`**.
- Pull invalida catálogo; refrescar proveedores si la UI los usa.

### Productos M7
- `suggestedPrice` lo calcula el servidor.
- Aplicar precio sugerido: `{ "cost": "12.50", "applySuggestedListPrice": true }` o query `syncListPriceFromMargin=1`.
- No combinar con `price` en el mismo body → 400.

---

## 4. Endpoints (lista)

**Config:** `GET/PATCH /stores/:id/business-settings`, `GET/POST /exchange-rates`  
**Catálogo:** `GET/POST/PATCH/DELETE /products`, `POST /products-with-stock`  
**Inventario:** `GET /inventory`, `POST /inventory/adjustments`  
**Operaciones:** `POST/GET /sales`, `POST/GET /purchases/:id`, `POST/GET /sale-returns/:id`, CRUD `/suppliers`  
**Sync:** `POST /sync/push`, `GET /sync/pull`  
**Fotos:** §8  
**Dashboard:** §10  

---

## 5. Offline-first

### Objetivo
Inicio, Inventario, Catálogo, POS, Compras y Devoluciones operativos sin red; auto-sync ~90s + al reconectar; badge online/offline.

### Núcleo (Flutter)
- `ConnectivityService`, cola SQLite, `SyncEngine` con lock, scheduler + pull incremental (`since`).
- Compras offline: op `PURCHASE_RECEIVE` con `fxSnapshot` completo.
- Catálogo offline: cache + cola `pending_catalog_mutations_v1`.
- Config URL desde Ajustes: `http://ip:puerto/api/v1`, probar conexión, perfiles LAN/Local/Prod, persistir y mostrar badge entorno.

### Estados de cola sugeridos
- `retryable`: red/timeout/5xx  
- `manual`: 400 validación, 404 producto, 409 negocio  
- `success`: aplicado en servidor  

### QA offline (mínimo)
1. Backend caído → POS/Inventario con cache, sin loading infinito.  
2. Operación offline → cola → sync al reconectar.  
3. Mismo `opId` + mismo payload → `skipped`, sin duplicar stock/venta.  
4. Cambiar URL en ajustes → todas las llamadas usan la nueva base.

---

## 6. Cobro mixto USD / VES

Backend **listo**. `POST /sales` y sync `SALE` aceptan `payments[]` opcional.

### UX en pantalla de cobro
- Mostrar total documento (VES) y referencia USD.
- Inputs: pago USD, pago VES (opcional).
- Tiempo real: equivalente VES del USD, resto por cobrar, vuelto.
- **Usar siempre el `fxSnapshot` del ticket**, nunca tasa nueva al cobrar.

### Fórmulas (decimal string)
- `pagoUsdEnVes = pagoUsd * rateQuotePerBase`
- `pagoTotalVes = pagoUsdEnVes + pagoVes`
- `restoVes = totalDocument - pagoTotalVes`
- `restoVes > 0` → bloquear cobro; `<= 0` → permitir (vuelto si sobra)

### Payload ejemplo

```json
{
  "documentCurrencyCode": "VES",
  "lines": [{ "productId": "uuid", "quantity": "2", "price": "91.25" }],
  "fxSnapshot": {
    "baseCurrencyCode": "USD",
    "quoteCurrencyCode": "VES",
    "rateQuotePerBase": "41.00",
    "effectiveDate": "2026-04-08"
  },
  "payments": [
    {
      "method": "CASH_USD",
      "amount": "12.00",
      "currencyCode": "USD",
      "fxSnapshot": {
        "baseCurrencyCode": "USD",
        "quoteCurrencyCode": "VES",
        "rateQuotePerBase": "41.00",
        "effectiveDate": "2026-04-08"
      }
    },
    { "method": "CASH_VES", "amount": "20.50", "currencyCode": "VES" }
  ]
}
```

### Errores
`PAYMENTS_INVALID_AMOUNT`, `PAYMENTS_MISSING_FX_SNAPSHOT`, `PAYMENTS_FX_PAIR_MISMATCH`, `PAYMENTS_TOTAL_MISMATCH` (tolerancia suma ±0.01 documento).

### Respuesta venta
`GET /sales/:id` incluye `payments`, `paymentsCount`, `paidDocumentTotal`, `changeDocument`.

### Offline
Incluir `payments` en `payload.sale` del op `SALE`; mismo `opId` en reintentos.

---

## 7. Charcutería por gramaje

Sin endpoint nuevo. Criterio: `Product.unit == "KG"`.

### Modal “Agregar por peso”
Tres modos (gramos, monto VES, monto USD); conversiones con `fxSnapshot` del ticket; mostrar kg, g, USD, VES en tiempo real.

Al confirmar, línea al backend:
- `quantity` = **kg** como string (350 g → `"0.35"`)
- `price` = precio **por kg** en moneda documento

```json
{ "productId": "uuid", "quantity": "0.35", "price": "292.00", "discount": "0" }
```

Guardar en UI local para ticket/impresión: `displayGrams`, precio/kg, importes. Compatible con cobro mixto (§6).

---

## 8. Fotos de producto

| Paso | Método | Notas |
|------|--------|--------|
| Upload | `POST /uploads/products-image` | multipart campo `file`, máx 5MB, `image/*` |
| Asociar | `PATCH /products/:id/image` | `{ "imageUrl": "/api/v1/uploads/products-image/<storeId>/<file>" }` |
| Quitar | `DELETE /products/:id/image` | |
| Ver | `GET /uploads/products-image/:storeId/:fileName` | |

Respuesta upload: `{ fileId, url, mimeType, bytes }`.

**Flujo UX:** preview local inmediato → cola background upload → PATCH image → no bloquear guardado del producto si upload pendiente; reintentos con backoff; comprimir (webp/jpeg ~720px) antes de enviar.

Cola: `retryable` (red/5xx), `manual` (400, 404, 409), `success`.

---

## 9. Compras proveedor (UX)

Backend listo: `POST /purchases` crea compra + `IN_PURCHASE` + stock.

Pantalla recomendada: proveedor, fecha, moneda, tasa; grid de líneas; total fijo abajo; borrador local offline → `PURCHASE_RECEIVE` al sync. Campo opcional `supplierInvoiceReference`. Detalle: [api/PURCHASES.md](./api/PURCHASES.md).

---

## 10. Dashboard operativo

KPIs en **moneda funcional** (`currencyCode`); no recalcular `netSales` ni `avgTicket` en cliente.

### Endpoints

| Uso | Método | Headers |
|-----|--------|---------|
| KPIs operador | `GET /reports/sales/summary`, `timeseries`, `payments` | `X-Store-Id` |
| TV kiosk | `GET /dashboard/device/:deviceId?preset=today` | `X-Device-Token` (sin Store-Id) |
| Ver modo | `GET /pos-devices/:deviceId/dashboard-config` | `X-Store-Id` |
| Activar TV | `PATCH .../dashboard-config` | `X-Store-Id` + `X-Dashboard-Admin-Pin` |

`:deviceId` = ID instalación (sync/ventas), **no** UUID fila `POSDevice.id`.

### Query común
`preset`: `today` | `yesterday` | `week` | `month` — o `dateFrom` + `dateTo` (`YYYY-MM-DD`, máx 31 días). Opcional `deviceId`.

### Summary (ejemplo)

```json
{
  "currencyCode": "USD",
  "grossSales": "1250.50",
  "returns": "45.00",
  "netSales": "1205.50",
  "tickets": 32,
  "avgTicket": "37.67",
  "returnRate": "0.036"
}
```

### Activar kiosk (una vez, admin)

```http
PATCH /api/v1/pos-devices/{deviceId}/dashboard-config
X-Store-Id: {store-uuid}
X-Dashboard-Admin-Pin: {pin}
Content-Type: application/json

{ "dashboardEnabled": true, "deviceMode": "DASHBOARD", "regenerateToken": true }
```

Guardar `dashboardAccessToken` de la respuesta (solo se muestra una vez) en secure storage.

### Registro vs dashboard
1. **Registrar dispositivo** = usar `deviceId` en ventas/sync (automático).  
2. **Habilitar dashboard** = PATCH anterior (Postman o pantalla admin en app).  
3. **Uso diario kiosk** = `GET /dashboard/device/{deviceId}` + token cada ~45s.

### Errores kiosk
401 token inválido · 403 dashboard deshabilitado · 400 header Store-Id mal puesto

---

## 11. Componentes Flutter

- Core: `app_config`, `api`, `local_prefs`, `sync`, `catalog_invalidation_bus`
- Features: `inventory`, `sale`, `suppliers`, `shell`, `dashboard`

---

## 12. Checklist nueva feature

1. Flujo UX + validaciones  
2. Contrato en Swagger o `docs/api/`  
3. Montos string + idempotencia  
4. Online/offline  
5. Invalidación UI / pull  
6. `flutter analyze`  
7. Actualizar **este archivo** (y [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) si cambia backend)

---

## 13. Mantenimiento

- **Un solo doc Flutter:** este archivo. No crear `FRONT_*`, `quickmarket_*` ni duplicados.
- Detalle HTTP sync/compras → `docs/api/`.
- Cambios dashboard/reportes → §10 + [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) § Dashboard.
