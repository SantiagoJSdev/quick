# Quick POS - Contexto Unico de Proyecto

Documento unico para trabajar en este repo. Reemplaza y consolida el resto de archivos de `docs/`.

## 1) Objetivo y alcance

Este documento sirve para:

- Entender rapido el flujo funcional de la app.
- Tener el contrato minimo de integracion con backend.
- Recordar reglas clave (offline, idempotencia, multi-moneda, POS).
- Facilitar que nuevas funcionalidades se agreguen sin perder contexto.

## 2) Arquitectura resumida

- **App:** Flutter.
- **API base:** `/api/v1`.
- **Header principal:** `X-Store-Id` en casi todas las llamadas.
- **Errores API:** `{ statusCode, error, message[], requestId }`.
- **Monetario:** montos como `String` decimal.
- **Offline:** cola local + `sync/push`; `opId` idempotente.

## 3) Configuracion local importante

- Archivo: `lib/core/config/app_config.dart`.
- `API_BASE_URL` se toma de `--dart-define` o del `defaultValue`.
- **Emulador Android:** usar `10.0.2.2`.
- **Dispositivo real:** usar IP LAN de la PC (`192.168.x.x`), no `10.0.2.2`.
- `CONFIG_ADMIN_PIN`: clave para configuracion de tienda.

## 4) Flujos funcionales actuales

### 4.1 Inicio / tienda / tasa

1. Guardar o crear `storeId`.
2. Cargar `business-settings`.
3. Mostrar moneda funcional + moneda documento por defecto.
4. Consultar tasa (`exchange-rates/latest`) cuando aplica.

### 4.2 Inventario

1. Listar inventario (`GET /inventory`).
2. Ver detalle + movimientos por producto.
3. Ajustar stock (`POST /inventory/adjustments`) con `opId`.
4. Si no hay red, encolar y sincronizar luego.

### 4.3 Catalogo de productos

1. Listar productos activos (`GET /products`).
2. Crear/editar/desactivar producto.
3. Alta opcional con stock inicial (`POST /products-with-stock`) con `Idempotency-Key`.
4. Soporta SKU/barcode, proveedor, pricingMode y margenes.

### 4.4 Proveedores

1. CRUD de proveedores por tienda.
2. Usar proveedor activo en compras.

### 4.5 POS venta

1. Buscar producto (nombre, SKU, barcode) y agregar al carrito.
2. Manejo de moneda documento + conversion a funcional.
3. Cobro: `POST /sales`.
4. Cobro mixto: `payments[]` opcional (ej. USD + VES) con validacion de restante antes de confirmar.
5. Si un pago viene en moneda distinta a la moneda documento, se envia `fxSnapshot` en la linea de pago.
4. Si no hay red, venta a cola local y luego `sync/push`.

### 4.6 Tickets en espera (held)

1. Guardar carrito localmente (no crea venta).
2. Recuperar/renombrar/eliminar ticket guardado.
3. Solo al cobrar se crea la venta real.
4. Al cobrar, si venia de held, ese held se elimina.

### 4.7 Historial y devoluciones

- Historial de ventas (`GET /sales`, `GET /sales/:id`).
- Devoluciones (`POST /sale-returns`).

## 5) Reglas criticas de negocio

### 5.1 Multi-moneda

- Cada tienda tiene moneda funcional.
- Venta/compra puede ir en moneda documento.
- Al confirmar documento, persistir snapshot FX usado.
- No recalcular historicos con tasa nueva.

### 5.2 Idempotencia

- Ajustes/cola: `opId` UUID.
- Ventas: `id` cliente para evitar duplicados por reintento.
- Alta producto+stock: `Idempotency-Key` HTTP obligatorio.

### 5.3 Offline y sync

- Operaciones definitivas van por `sync/push`.
- `held tickets` no son `SALE` ni van a `sync/push` hasta cobrar.
- Pull invalida catalogo (incluye deltas de proveedor vía `SUPPLIER_*` en pull) y refresca pantallas; conviene también refrescar lista local de proveedores con `GET /suppliers` tras push/pull si la UI depende de ese catálogo.

## 6) Endpoints clave (minimo operativo)

### Configuracion

- `GET /stores/:storeId/business-settings`
- `PATCH /stores/:storeId/business-settings`
- `GET /exchange-rates/latest`
- `POST /exchange-rates`

### Catalogo e inventario

- `GET /products`
- `POST /products`
- `PATCH /products/:id`
- `DELETE /products/:id`
- `POST /products-with-stock`
- `GET /inventory`
- `GET /inventory/:productId`
- `GET /inventory/movements`
- `POST /inventory/adjustments`

### Venta, compras, devoluciones, sync

- `POST /sales`
- `GET /sales`
- `GET /sales/:id`
- `GET /suppliers`
- `POST /suppliers`
- `PATCH /suppliers/:id`
- `DELETE /suppliers/:id`
- `POST /purchases`
- `GET /purchases/:id`
- `POST /sale-returns`
- `GET /sale-returns/:id`
- `POST /sync/push`
- `GET /sync/pull`

Notas de contrato vigentes para ventas:

- `POST /sales` acepta `payments[]` opcional.
- `GET /sales/:id` devuelve `payments` + resumen (`paymentsCount`, `paidDocumentTotal`, `changeDocument`).
- `sync/push` (`opType: SALE`) acepta `payload.sale.payments`.
- Codigos de error esperados para cobro mixto:
  - `PAYMENTS_INVALID_AMOUNT`
  - `PAYMENTS_MISSING_FX_SNAPSHOT`
  - `PAYMENTS_FX_PAIR_MISMATCH`
  - `PAYMENTS_TOTAL_MISMATCH`

### Productos `PATCH /api/v1/products/:id` — costo, precio y sugerido (M7)

- **`suggestedPrice` no es un campo que invente el cliente**: es valor **derivado** que el **servidor** incluye en la respuesta de `GET` / `PATCH` del producto (junto con `effectiveMarginPercent`, `marginComputedPercent`, etc.), calculado con las reglas M7 (costo × (1 + margen efectivo/100) cuando no es `MANUAL_PRICE` y hay margen efectivo y costo &gt; 0). Tras un `PATCH`, **`suggestedPrice` refleja el estado ya persistido** (costo / `pricingMode` / overrides resultantes del request).
- **Solo `{ "cost": "<string>" }`:** el servidor **actualiza costo** y **devuelve** `suggestedPrice` recalculado, pero **no cambia** `price` en BD hasta que el cliente envíe `price` o use el flag / query de abajo.
- **Un solo round-trip (implementado en backend):**
  1. Body: `{ "cost": "12.50", "applySuggestedListPrice": true }` (lista blanca; boolean JSON).  
     - Si el resultado M7 **no** tiene sugerido (`MANUAL_PRICE`, costo 0, o sin margen efectivo en tienda/override), el flag se **ignora** (solo se aplican el resto de campos del body; `price` no se toca).  
     - Si hay `suggestedPrice` computable, el servidor **persiste `price`** con ese mismo valor (misma fórmula que el derivado en respuesta).
  2. **Alternativa equivalente:** `PATCH .../products/:id?syncListPriceFromMargin=1` o `=true` (misma semántica que el flag; tampoco combinar con `price` en el body).
- **Conflicto:** si vienen **`price`** en el body y además **`applySuggestedListPrice: true`** o **`syncListPriceFromMargin`**, el API responde **400** (mensaje claro).
- **OpenAPI / Swagger:** el DTO documenta `applySuggestedListPrice`; el query param está descrito en el controlador.

### Compras `POST /purchases` y sync `PURCHASE_RECEIVE`

- Lista blanca estricta: no enviar propiedades no definidas (p. ej. `reference` en REST → 400).
- Factura / guia / nota del proveedor: campo **`supplierInvoiceReference`** (string opcional, max **120** en REST; sync puede truncar).
- **`id`** opcional en body: idempotencia (UUID cliente).
- **`documentCurrencyCode`** opcional; si falta, el servidor usa reglas de settings.
- **`fxSnapshot`** opcional; misma forma que en sync (puede incluir `fxSource`).
- **`GET /purchases/:id`**: respuesta incluye `supplierInvoiceReference` opcional.
- Sync `payload.purchase`: mismos conceptos; preferido **`supplierInvoiceReference`**; alias **`reference`** solo en sync (si vienen ambos, gana `supplierInvoiceReference`). Alias **`fx`** = mismo contenido que `fxSnapshot`.
- En **`PURCHASE_RECEIVE`**, `purchase.supplierId` puede ser el **UUID provisional** (`clientSupplierId`) definido en un **`SUPPLIER_CREATE` anterior dentro del mismo batch**; el servidor lo resuelve al id real antes de aplicar la compra. Entre batches distintos el cliente debe usar ya el **`supplierId` del servidor** (viene en `acked[].supplier` del create) o reescribir la cola local tras ese ack.

### Sync `POST /sync/push` — proveedores (`SUPPLIER_*`)

**Contrato JSON completo (request/response, pull, ejemplos):** [`docs/api/SYNC_PUSH_SUPPLIERS.md`](./api/SYNC_PUSH_SUPPLIERS.md).

Contrato resumido para alta / edición / baja soft offline, mismo batch que ventas y compras.

**`opType` (strings exactas):** `SUPPLIER_CREATE`, `SUPPLIER_UPDATE`, `SUPPLIER_DEACTIVATE`.

**Cada op:** `opId` (UUID v4), `opType`, `timestamp` (ISO-8601), `payload` objeto.

**Payloads (todos usan `payload.supplier` como objeto):**

| `opType` | Campos obligatorios | Opcionales (mismos límites que REST `POST/PATCH /suppliers`) |
|----------|---------------------|---------------------------------------------------------------|
| `SUPPLIER_CREATE` | `clientSupplierId` (UUID v4, id provisional del dispositivo), `name` (1–200 tras trim) | `phone` (≤80), `email` (válido, ≤200), `address` (≤500), `taxId` (≤80), `notes` (≤2000) |
| `SUPPLIER_UPDATE` | `supplierId` (UUID v4; puede ser provisional si ya hubo `SUPPLIER_CREATE` **antes** en el mismo batch) | Al menos uno de: `name`, `phone`, `email`, `address`, `taxId`, `notes`, `boolean` `active` |
| `SUPPLIER_DEACTIVATE` | `supplierId` (UUID v4; resolución provisional igual que arriba) | — |

**Respuesta `acked[]`:** además de `opId` y `serverVersion`, si aplica **`supplier`**: `{ "supplierId": "<uuid servidor>" }`; en **`SUPPLIER_CREATE`** también **`clientSupplierId`** (el provisional enviado) para mapeo en el cliente.

**Errores por operación (HTTP 200 en el batch):** entradas en **`failed[]`** con `reason` y `details` (texto). Validación de payload / negocio: típicamente **`reason`: `validation_error`**. Misma línea que `SALE` / `PURCHASE_RECEIVE`: **`validation_error`** → revisar payload o datos; reintentar con el mismo `opId` solo si el fallo fue transitorio y **no** quedó registrado como failed en servidor; si quedó **failed** persistido, nueva **`opId`**.

**Idempotencia (`opId`):** igual que el resto del sync: misma `opId` + mismo `payload` → `skipped` `already_applied`; misma `opId` + **distinto** `payload` → **`failed`** `payload_mismatch` (no se aplica la segunda versión). `opId` duplicado en **otra tienda** → **409** en todo el request (transacción abortada).

**Orden:** el servidor aplica **`ops[]` en el orden del array** (transacción serializable). El campo **`timestamp` no reordena** el batch; debe servir solo para auditoría / depuración. Depende del cliente enviar el orden correcto (ej. `SUPPLIER_CREATE` antes de `PURCHASE_RECEIVE` que use el provisional).

**Límite:** máximo **200** operaciones por request (`ops.length`); sin cambio.

**Dependencias:** `PURCHASE_RECEIVE` con `supplierId` desconocido en BD falla salvo que ese valor sea un **provisional ya mapeado** por un `SUPPLIER_CREATE` previo **en el mismo batch**. Dos `SUPPLIER_CREATE` con el mismo `clientSupplierId` en un batch → `validation_error`.

**Coherencia con REST:** mismas reglas de negocio que `POST /suppliers`, `PATCH /suppliers/:id`, `DELETE /suppliers/:id` (baja soft). No hay unicidad global de `taxId` en esquema actual. Compra con proveedor inactivo → error de negocio (mismo mensaje vía sync que en REST). Si otro dispositivo desactivó al proveedor, un `SUPPLIER_UPDATE` con `active: true` puede reactivarlo; un `PURCHASE_RECEIVE` contra proveedor inactivo sigue fallando hasta reactivar o cambiar proveedor.

**Pull (`GET /sync/pull`):** tras mutaciones de proveedor, el servidor emite entradas con **`opType`** `SUPPLIER_CREATED`, `SUPPLIER_UPDATED`, `SUPPLIER_DEACTIVATED` (nombres en pasado, alineados a `PRODUCT_*`). Payload: `{ "supplierId", "fields": { ... } }` con strings ISO para fechas y demás campos alineados al modelo proveedor. Alcance **`storeScopeId`** = tienda: solo los dispositivos de esa tienda reciben esos deltas en pull.

### Sync `POST /sync/push` — ventas `SALE`

- **`GET /ops/metrics`** es solo diagnóstico operativo; el POS **no** necesita `OPS_API_KEY` para sincronizar. Sync usa **`POST /api/v1/sync/push`** con `X-Store-Id` y body `deviceId` + `ops[]`.
- En `payload.sale.lines[]`, **`productId`**, **`quantity`** y **`price`** deben ir como **strings** en el JSON (ej. `"quantity": "2"`). Si Dart serializa números nativos, el backend puede rechazar la validación.
- Si hay **`payments[]`**: `method`, `amount`, `currencyCode` como strings; `fxSnapshot` anidado con campos requeridos también como strings.
- Respuesta puede incluir **`failed[]`** con **`details`** por operación: conviene loguear/mostrar para depuración.
- Si una **`opId`** ya quedó registrada como fallida en servidor, no se re-ejecuta con el mismo id: hace falta **nueva `opId`** (UUID v4) para reenviar la venta corregida.

## 7) Componentes Flutter relevantes

### Core

- `lib/core/config/app_config.dart`
- `lib/core/api/*`
- `lib/core/storage/local_prefs.dart`
- `lib/core/catalog/catalog_invalidation_bus.dart`
- `lib/core/sync/*`
- `lib/core/models/*`

### Features

- `lib/features/inventory/*`
- `lib/features/sale/*`
- `lib/features/suppliers/*`
- `lib/features/shell/*`

## 8) Checklist para nuevas funcionalidades

Cuando se agregue o cambie una funcionalidad:

1. Definir flujo UX (entrada, validaciones, salida).
2. Confirmar contrato API real (sin inventar campos/endpoints).
3. Aplicar reglas de dinero en string + idempotencia.
4. Definir comportamiento online/offline.
5. Actualizar invalidaciones/refresco de UI.
6. Agregar o ajustar pruebas y correr `flutter analyze`.
7. Actualizar esta seccion con cambios relevantes.

## 9) Convencion de mantenimiento documental

- Mantener **solo este archivo** como fuente de verdad en `docs/`.
- Evitar crear docs paralelos; todo nuevo contexto va aqui.
- Si se necesita detalle tecnico temporal, incorporarlo y resumirlo aqui antes de cerrar la tarea.
- Excepcion operativa: las pruebas manuales se registran en `docs/MANUAL_TESTS.md`.
- Regla: cada nueva prueba manual o ajuste de QA manual debe cargarse en `docs/MANUAL_TESTS.md`.

## 10) Estado Offline (decision vigente)

- Objetivo: app operativa offline en Inicio, Inventario, Catalogo, POS, Compras y Devoluciones.
- Compras: habilitadas offline via cola y `PURCHASE_RECEIVE`.
- Devoluciones: habilitadas offline via cola y `SALE_RETURN`.
- Catalogo: full offline para crear/editar/borrar con sincronizacion posterior.
- Frecuencia de auto-sync: cada 90 segundos + disparo inmediato al reconectar.
- UX de conectividad: indicador visible verde (online) / rojo (offline).
- Regla UX: sync en segundo plano, sin bloquear navegacion ni uso normal.

## 11) Plan V2 integrado (offline + compras + fotos + config URL)

Se integra como referencia ejecutiva el plan `FRONT_OFFLINE_EXECUTION_PLAN_V2.md` recibido desde backend.

### 11.1 Alcance alineado

- Compras proveedor con entrada de stock: usar `POST /purchases` online y `PURCHASE_RECEIVE` offline.
- Offline-first transversal: cola local, `sync/push`, `sync/pull`, lock anti-concurrencia y scheduler.
- Fotos de producto: propuesta en dos fases (preview local + upload background) sujeta a endpoints backend.
- Configuracion dinamica de URL backend: implementada en frontend (Ajustes + perfiles + prueba de conexion).

### 11.2 Estado de ejecucion consolidado

Fuente de seguimiento operativo: `docs/FRONT_OFFLINE_IMPLEMENTATION_CHECKLIST.md`.
Fuente unica de pruebas manuales: `docs/MANUAL_TESTS.md`.

- Estado global actual: **en progreso avanzado**.
- Ya implementado: base offline en POS/Inventario/Catalogo, scheduler 90s + reconexion, fallback de read models, tickets en espera, devoluciones/compras offline en cola.
- Ya implementado tambien: configuracion dinamica de URL/IP desde Ajustes, prueba de conexion, selector de perfil (Produccion/LAN/Local), y badge de entorno activo (LOCAL/LAN/PROD).
- Ya implementado tambien: clasificacion base de errores de sync (retryable/manual) y vista de operaciones pendientes en Ventas.
- Fotos implementadas end-to-end:
  - `POST /uploads/products-image` (multipart, campo `file`),
  - `PATCH /products/:id/image` para asociar `imageUrl`,
  - cola local con reintentos automáticos y clasificación manual/retryable.
- Cobro mixto implementado end-to-end en frontend:
  - UI de `Pago en funcional` + `Pago en documento`,
  - validacion de faltante en documento antes de cobrar,
  - envio de `payments[]` en REST y en `sync/push` offline,
  - manejo de errores de contrato `PAYMENTS_*` en mensajes de caja.
- Pendiente principal: ejecutar QA manual formal y cerrar evidencia.

## 12) QA rapido de validacion offline (movil)

Ejecutar este bloque en Android fisico para validar comportamiento base:

1. Abrir `Inicio -> Configuracion (clave)`.
2. En `Conexion backend`, elegir perfil `LAN`, cargar IP LAN real y tocar `Probar conexion`.
3. Guardar URL y verificar badge global de entorno (`LAN`).
4. Apagar backend y entrar a `POS`, `Buscar precio`, `Inventario`, `Historial`: no debe haber loading infinito.
5. Con backend caido, crear una operacion offline (venta o devolucion) y confirmar que queda en cola.
6. Encender backend, esperar reconexion (o tocar `Sincronizar`) y validar que pendientes bajan.
7. Cambiar a `Produccion` o `Local` desde perfiles y confirmar que badge cambia (`PROD` o `LOCAL`).
8. Registrar evidencia minima (captura + resultado) por escenario para cerrar Fase F.

## 13) Bitacora de cambios recientes

- 2026-04-14:
  - `sync/push`: nuevos `opType` `SUPPLIER_CREATE`, `SUPPLIER_UPDATE`, `SUPPLIER_DEACTIVATE` con `payload.supplier`, id provisional `clientSupplierId`, ack `supplier` con id servidor; resolución de provisional en el mismo batch para `PURCHASE_RECEIVE` y updates/deactivate; pull emite `SUPPLIER_CREATED` / `UPDATED` / `DEACTIVATED` por tienda.
- 2026-04-13:
  - `PATCH /products/:id`: opcional `applySuggestedListPrice` y query `syncListPriceFromMargin` para persistir `price` desde el cálculo M7 en un solo request (ver seccion M7 arriba).
- 2026-04-07:
  - Main shell ajustado a auto-sync cada 90s.
  - Trigger de sync por reconexion mantenido.
  - Lock en auto-sync para evitar ejecuciones concurrentes.
  - Indicador de estado de red agregado en barra inferior (online/offline).
  - Catalogo offline inicial implementado:
    - cache local de productos en `LocalPrefs`,
    - cola local `pending_catalog_mutations_v1` (create/update/deactivate),
    - flush automatico en segundo plano desde `MainShell`,
    - fallback de lectura a cache cuando falla red/API en lista de catalogo.
  - POS offline reforzado:
    - `PosSaleScreen` ahora usa cache local de catalogo si falla `GET /products`,
    - carga `business-settings` desde cache local si falla red,
    - usa cache local de par FX para seguir cobrando en modo offline,
    - al volver red, sync y pull mantienen consistencia.
  - `products-with-stock` offline:
    - en `ProductInitialStockBottomSheet`, si no hay red se encola mutacion local
      tipo `CREATE_PRODUCT_WITH_STOCK` con `Idempotency-Key` persistido,
    - se crea placeholder local en cache de catalogo,
    - `flushPendingCatalogMutations` reintenta esa mutacion al reconectar y
      reemplaza placeholder por producto real del servidor.
  - Read models locales (Inicio/Inventario/Historial):
    - Inicio (`StoreDashboardScreen`) usa cache de `business-settings` si falla red,
    - Inventario (`InventoryStockTab`) guarda y usa cache local de líneas (`inventory_cache_v1`),
    - Historial General (`TicketHistoryScreen`) guarda última consulta y la muestra sin red
      (`sales_general_cache_v1`) cuando no hay respuesta del API.
  - Refuerzo de visibilidad de cache/offline:
    - Tasa del día (`ExchangeRateTodayScreen`) con cache local por par/fecha
      (`latest_rate_cache_v1_*`) y fallback sin red,
    - badge de “mostrando datos cacheados” en Inicio, Inventario y Historial General
      cuando los datos vienen de fallback offline.
