# Implementación Flutter (Android) + Android Studio + Gemini — Quick Market POS

Guía para crear la app desde cero, integrar el backend documentado y usar **IA (Gemini)** sin inventar endpoints: todo el flujo sale de `FRONTEND_INTEGRATION_CONTEXT.md` y los `.md` de `docs/api/` / `docs/domain/`.

---

## 1) Qué vas a construir (alcance por sprint)

| Sprint | Módulos | Backend hoy |
|--------|---------|-------------|
| **1** | Configuración empresa/tienda, inventario, “proveedores” (gestión local + UUID conocido) | `business-settings`, `exchange-rates`, `inventory`, `products` CRUD/listado |
| **2** | Punto de venta: carrito, QR/código/nombre, doble moneda en línea y totales, `POST /sales` + sync opcional | `sales`, `sync/push` `SALE`, `fxSnapshot` |
| **3+** | Compras, devoluciones, sync completo offline, auth usuarios (cuando exista en API) | `purchases`, `sale-returns`, `sync`, etc. |

**Importante — proveedores:** el backend **no expone** `GET /suppliers` ni CRUD de proveedores. El seed crea uno por defecto. En sprint 1 la pantalla “Proveedores” puede: (a) mostrar lista **local** (SQLite) de nombre + UUID que el usuario pega desde admin/Postman, (b) o un solo proveedor por defecto leído de configuración. Cuando exista API, sustituir la fuente de datos sin cambiar el diseño de pantalla.

**Multi-dispositivo:** sí está contemplado. Cada terminal debe usar un **`deviceId`** estable (UUID generado la primera vez y guardado en `SharedPreferences`). Se envía en ventas (`deviceId`) y en **`POST /sync/push`**. Varios móviles pueden usar la **misma tienda** (`X-Store-Id`); el servidor desambigua por `deviceId` en `POSDevice` y por `opId` en operaciones.

---

## 2) Android Studio + Flutter desde cero

### 2.1 Instalación

1. Instala **Android Studio** (última estable) con **Android SDK** y un **emulador** (API 34+ recomendado).
2. Instala **Flutter SDK** (canal stable): https://docs.flutter.dev/get-started/install/windows  
3. Ejecuta `flutter doctor` en terminal y resuelve lo que marque en rojo (licencias SDK: `flutter doctor --android-licenses`).
4. En Android Studio: **Plugins** → instala **Flutter** y **Dart**; reinicia el IDE.

### 2.2 Crear el proyecto

1. **File → New → New Flutter Project** → **Flutter** → Next.  
2. **Project name:** ej. `quick_market_pos`  
3. **Organization:** ej. `com.tuempresa.quickmarket`  
4. **Platforms:** al menos **Android** (iOS opcional).  
5. **Finish**. Espera a que termine `pub get`.

### 2.3 Configurar Android para red (desarrollo)

- **Emulador:** `http://10.0.2.2:3000` apunta al `localhost:3000` de tu PC si el backend corre ahí.  
- **Dispositivo físico:** usa la IP LAN de tu PC, ej. `http://192.168.1.10:3000`, y en `AndroidManifest.xml` añade si hace falta:

```xml
<application android:usesCleartextTraffic="true" ...>
```

solo en **debug**. En producción usa **HTTPS**.

### 2.4 Estructura sugerida en `lib/`

```
lib/
  main.dart
  app.dart
  core/
    api/           # cliente HTTP, interceptores (X-Store-Id, X-Request-Id)
    theme/         # ColorScheme, tipografía
    constants/
  features/
    settings/      # sprint 1 — empresa / tasas / tienda
    inventory/     # sprint 1 — stock, productos, ajustes
    suppliers/     # sprint 1 — lista local + UUID
    pos/           # sprint 2 — carrito, venta
```

### 2.5 Paquetes Flutter recomendados (añadir en `pubspec.yaml`)

- `http` o `dio` — REST.  
- `flutter_secure_storage` o `shared_preferences` — `deviceId`, `storeId` dev.  
- `mobile_scanner` o `google_mlkit_barcode_scanning` — QR/código en sprint 2.  
- `intl` — formatos de moneda y fechas.  
- Opcional: `decimal` / manejo de `String` para montos como indica el backend.

---

## 3) Cómo usar Gemini (o otro asistente) bien

1. **Adjunta o indexa** los `.md` de `docs/backend/` (los que copiaste desde este repo).  
2. **Prompt base:** “Implementa solo lo descrito en FRONTEND_INTEGRATION_CONTEXT.md; no inventes rutas; si falta un endpoint, dilo y deja TODO.”  
3. Pide **archivos concretos**: “Genera `lib/core/api/api_client.dart` con baseUrl por `--dart-define` y headers `X-Store-Id`, `Content-Type: application/json`, opcional `X-Request-Id` UUID v4.”  
4. **Sprint acotado:** “Solo sprint 1: pantallas A, B, C y llamadas GET/POST listadas en la guía.”

---

## 4) Seguridad y cabeceras (obligatorio para el cliente)

| Elemento | Uso |
|----------|-----|
| `X-Store-Id` | UUID tienda con `BusinessSettings`. Casi todas las rutas bajo `/api/v1/...` excepto `GET /` y `GET /api/v1/ops/metrics`. |
| `X-Request-Id` | Opcional; el servidor devuelve uno en respuesta. En errores el JSON incluye `requestId`. |
| `Content-Type` | `application/json` en POST/PATCH. |
| TLS | Producción: solo HTTPS. |
| Errores | Cuerpo `{ statusCode, error, message: string[], requestId }` — mostrar `message.join` al usuario. |
| `/ops/metrics` | No lo uses en la app POS normal; si algún día sí: `X-Ops-Api-Key` o `Authorization: Bearer` según `.env` del servidor. |

**Autenticación usuario/login:** aún no en API pública POS; la app se basa en **configurar `storeId`** (y más adelante token cuando exista).

---

## 5) Endpoints — flujo sprint 1 (orden sugerido)

1. **Arranque / configuración**  
   - Usuario introduce o escanea **UUID tienda** (o `dart-define`).  
   - `GET /api/v1/stores/{storeId}/business-settings` con `X-Store-Id: {storeId}` → moneda funcional, documento por defecto, nombre tienda.  
   - Si `404`: mensaje “Tienda sin configuración; ejecutar seed o admin”.

2. **Tasas (pantalla referencia dual USD/VES)**  
   - `GET /api/v1/exchange-rates/latest?baseCurrencyCode=USD&quoteCurrencyCode=VES` (+ `effectiveOn` opcional).  
   - Opcional admin: `POST /api/v1/exchange-rates` (misma forma que Postman).

3. **Catálogo / productos**  
   - `GET /api/v1/products?includeInactive=false` — listado.  
   - `GET /api/v1/products/{id}` — detalle.  
   - Alta/edición cómoda inventario: `POST /api/v1/products`, `PATCH /api/v1/products/{id}` (campos según DTO backend; precio `price` string, `currency`, etc.).

4. **Inventario**  
   - `GET /api/v1/inventory` — stock por línea.  
   - `GET /api/v1/inventory/{productId}` — detalle una línea.  
   - `GET /api/v1/inventory/movements?productId=&limit=` — historial.  
   - `POST /api/v1/inventory/adjustments` — entradas/salidas manuales (`IN_ADJUST` / `OUT_ADJUST`).

5. **Proveedores (sin API)**  
   - UI tipo Odoo/Square “Contacts”: lista local; campo “UUID proveedor” para pegar el del seed; nota “Compras usarán este UUID en sprint 2”.

---

## 6) Diseño UI — inspiración y paleta

**Referencias de UX (no copiar marca):**

- **Square POS:** flujo rápido, grid de categorías/productos, carrito claro, grandes targets táctiles.  
- **Odoo inventario:** listas con búsqueda, formularios de producto por secciones (general, precio, stock).

**Paleta (Material 3 + naranja de marca)**

Definición recomendada para `ColorScheme` (ajusta en `ThemeData`):

| Rol | Color | Notas |
|-----|-------|--------|
| **Primary (marca)** | `#FF6D00` | Naranja distintivo (Material “Deep Orange” afinado). |
| **On primary** | `#FFFFFF` | Texto/iconos sobre botones principales. |
| **Primary container** | `#FFCCAA` | Fondos suaves de acento. |
| **Secondary** | `#455A64` | Blue Grey 700 — neutro profesional (Google-ish). |
| **Surface / background** | `#F8F9FA` / `#FFFFFF` | Superficies claras tipo Google apps. |
| **Outline / divider** | `#E0E0E0` | |
| **Error** | `#B3261E` | Material 3 error típico. |
| **Tertiary (links/infos)** | `#00695C` | Teal 800 — segundo acento sin competir con el naranja. |

**Tipografía:** `GoogleFonts` opcional; por defecto `Roboto` en Android está bien.

**Componentes:** `NavigationBar` o `NavigationRail` para módulos; cards con elevación suave para productos; FAB naranja para “Añadir producto” o “Ajuste stock” según pantalla.

---

## 7) Pantallas sprint 1 — definición detallada

### Módulo A — Configuración empresa / tienda

| Pantalla | Contenido | Acciones API |
|----------|-----------|--------------|
| **A1 — Bienvenida / Enlazar tienda** | Campo UUID tienda (texto + pegar), botón “Conectar”. Guardar en preferencias. | Ninguna hasta validar: luego A2. |
| **A2 — Resumen tienda** | Nombre tienda, moneda funcional, moneda documento por defecto. | `GET .../stores/{id}/business-settings` |
| **A3 — Tasa del día** | Muestra par USD/VES (o el par que uses), `rateQuotePerBase`, `effectiveDate`, `convention`. Botón refrescar. | `GET .../exchange-rates/latest?...` |
| **A4 — (Opcional) Registrar tasa** | Formulario base, quote, rate string, fecha — para usuario admin en campo. | `POST .../exchange-rates` |

### Módulo B — Inventario + productos

| Pantalla | Contenido | Acciones API |
|----------|-----------|--------------|
| **B1 — Lista inventario** | Lista: producto (nombre, SKU), cantidad, moneda funcional si aplica. Pull-to-refresh. Búsqueda local por nombre/SKU sobre la lista cargada. | `GET .../inventory` (+ enriquecer con `GET .../products` si hace falta nombre) |
| **B2 — Detalle producto / stock** | Cantidad, reservado, mín/máx si existen, últimos movimientos. | `GET .../inventory/{productId}`, `GET .../inventory/movements?productId=` |
| **B3 — Ajuste stock** | Selector producto (desde lista), tipo IN/OUT, cantidad, motivo opcional. Confirmar. | `POST .../inventory/adjustments` |
| **B4 — Lista catálogo (CRUD)** | Productos activos; FAB “Nuevo”. | `GET .../products` |
| **B5 — Alta / edición producto** | Campos alineados al backend: `sku`, `name`, `price` (string), `currency`, `cost` (string), `barcode` opcional, `type`, etc. Validación cliente mínima. | `POST .../products`, `PATCH .../products/{id}` |
| **B6 — Desactivar producto** | Confirmación → soft delete. | `DELETE .../products/{id}` |

**Comodidad alta para alta de producto:** formulario en **pasos** (Odoo-style): (1) Identificación SKU/nombre/código barras, (2) Precio y moneda, (3) Costo y tipo. Guardar borrador local opcional.

### Módulo C — Proveedores

| Pantalla | Contenido | API |
|----------|-----------|-----|
| **C1 — Lista proveedores** | Lista **local** (SQLite/SharedPreferences JSON): nombre comercial + UUID. Acciones: añadir, editar nombre, eliminar de lista local. | Ninguna en sprint 1. |
| **C2 — Añadir proveedor** | Nombre + UUID (pegar desde Prisma Studio / Postman / admin). Texto de ayuda con el UUID del seed. | Ninguna. |

---

## 8) Pantallas sprint 2 (POS) — especificación para cuando implementes

**Objetivo:** carrito tipo Square; cada línea y totales en **moneda documento** + **VES** (o funcional + VES según `BusinessSettings`).

| Pantalla | Comportamiento |
|----------|----------------|
| **P1 — Catálogo venta** | Grid/lista productos; buscador por nombre/SKU; botón **Escanear** → cámara QR/barcode → resolver a `productId` (por `barcode` o SKU en cliente tras `GET products` cache). |
| **P2 — Línea en carrito** | Nombre, **precio en moneda documento** elegida, **al lado** equivalente en VES usando `GET .../latest` (solo referencia UI hasta confirmar). Stepper o teclado para **cantidad**. |
| **P3 — Carrito / ticket** | Lista líneas; subtotal y total en **documento**; segunda línea “Ref. VES” con misma tasa mostrada. Al confirmar: `POST /sales` con `documentCurrencyCode`, `fxSnapshot` (y `deviceId`). |
| **P4 — Selector moneda documento** | Coherente con `BusinessSettings.defaultSaleDocCurrency` y lista de monedas que tengan par en backend. |

**Offline (opcional en sprint 2+):** cola local + `POST /sync/push` con `SALE` y `fxSnapshot` con `POS_OFFLINE` según `SYNC_CONTRACTS.md`.

---

## 9) Lo que el backend aún no cubre (no asumir en la app)

- Login JWT / usuarios POS por tienda.  
- `GET /suppliers` listado.  
- Cross-rate automático (ej. EUR→VES sin par directo en `ExchangeRate`).  
- WebSockets push de catálogo en tiempo real (hoy: pull sync o refresco manual).

---

## 10) Checklist antes de dar por cerrado sprint 1

- [ ] `deviceId` UUID persistente generado una vez.  
- [ ] `storeId` configurable y validado con `business-settings`.  
- [ ] Manejo centralizado de errores API (`message[]`, `requestId`).  
- [ ] Montos como **string** en JSON hacia el servidor.  
- [ ] Tema claro con primary `#FF6D00` y secundarios definidos en §6.  
- [ ] Documentos `docs/backend/*.md` copiados y versionados con la app.

---

## 11) Referencias cruzadas

- Contrato completo API + multi-moneda: `FRONTEND_INTEGRATION_CONTEXT.md`  
- Qué archivos copiar: `DOCUMENTOS_A_COPIAR_AL_PROYECTO_FLUTTER.md`  
- Sync: `docs/api/SYNC_CONTRACTS.md`  
- Dominio FX: `docs/domain/MULTI_CURRENCY_ARCHITECTURE.md`
