# Implementación Flutter (Android) + Android Studio + Gemini — Quick Market POS

Guía para crear la app desde cero, integrar el backend documentado y usar **IA (Gemini)** sin inventar endpoints: todo el flujo sale de `FRONTEND_INTEGRATION_CONTEXT.md` y los `.md` de `docs/api/` / `docs/domain/`.

---

## 0) Primera vez en Android Studio: qué pantalla usar (y qué **no** usar)

### 0.1 “New Project” + “Phone and Tablet” + “Create with AI”

Eso es para una app **nativa Android** (Kotlin / Jetpack Compose) con asistente de Google. **No es tu caso** si vas a hacer la app en **Flutter**.

- **No elijas “Create with AI”** para este proyecto POS si tu stack es Flutter: generaría código Android nativo, no Dart/Flutter, y no coincidiría con esta guía.
- Lo que necesitas es un **proyecto Flutter**, que se crea por otro menú.

### 0.2 Crear el proyecto Flutter (orden correcto)

1. Abre **Android Studio**.
2. Si ves la bienvenida con varios botones, mira si aparece **“New Flutter Project”**.  
   - Si **no** aparece, o en **Settings → Languages & Frameworks** **no** ves la entrada **Flutter** (solo Android SDK, Kotlin, JVM…): el **plugin Flutter** no está instalado en este Android Studio. **File → Settings → Plugins → Marketplace** → busca **Flutter** → **Install** (+ **Dart**) → **Restart IDE**. Después debería aparecer **Languages & Frameworks → Flutter** para poner el SDK (ej. `C:\flutter`).
3. **File → New → New Flutter Project** (o en la bienvenida **New Flutter Project**).

**Si en vez de eso abriste “New Project” (genérico):** verás lenguajes **Java / Kotlin / Groovy** y sistema de build **IntelliJ / Gradle**. Eso es proyecto **Android nativo**, no Flutter. Pulsa **Cancel**, vuelve al menú y elige explícitamente **New Flutter Project** (no “New Project”).

4. En el asistente **Flutter** deberías ver algo como: ruta del **Flutter SDK**, tipo **Application**, nombre del proyecto, **Organization**, y a veces **Platforms** (Android / iOS / Web / …) en el mismo paso o en el siguiente.  
   - Si **no** aparece “Platforms”: en versiones recientes solo se genera **Android** por defecto en Windows; es normal. Puedes añadir otras plataformas después con `flutter create . --platforms=android` en la carpeta del proyecto.
5. **Location:** carpeta donde quieras el repo, ej. `C:\dev\quick_market_pos`.
6. **Project name:** `quick_market_pos` (sin espacios).
7. **Organization:** `com.tuempresa.quickmarket` (package id de Android).
8. **Finish** (o **Next** hasta el final). Espera a `pub get` y análisis.

**Flutter SDK no configurado / error “Flutter SDK is not found in the specified location”:**

1. La ruta debe ser la **carpeta raíz del SDK** (contiene la carpeta `bin` y dentro `flutter.bat` en Windows). **No** uses `...\bin` como SDK path.
2. En terminal: `where flutter` o `flutter doctor -v` para ver dónde está instalado.
3. **File → Settings → Languages & Frameworks → Flutter → Flutter SDK path** → elige esa carpeta raíz → **Apply** → **OK**.
4. Si **Dart SDK path** falla, pon `<flutter_sdk>\bin\cache\dart-sdk`.
5. Si aún no tienes SDK: descargar stable desde https://docs.flutter.dev/get-started/install/windows , descomprimir ej. `C:\src\flutter`, configurar esa ruta en el IDE y ejecutar `flutter doctor`.

Luego reintenta **New Flutter Project** (o **Generators → Flutter**).

**Alternativa por terminal** (mismo resultado):

```bash
cd C:\dev
flutter create quick_market_pos --org com.tuempresa.quickmarket
```

Luego en Android Studio: **File → Open** → selecciona la carpeta `quick_market_pos`.

### 0.3 Carpeta `docs/backend/` y copiar los Markdown

1. En el **explorador de archivos de Windows**, entra a la raíz de tu proyecto Flutter (donde está `pubspec.yaml`).
2. Crea: `docs\backend\` (si no existe).
3. Desde el repo del **backend** Quick Market, copia los archivos listados en **`docs/flutter/DOCUMENTOS_A_COPIAR_AL_PROYECTO_FLUTTER.md`** dentro de `docs\backend\` (mismos nombres o los sugeridos en esa tabla).

**No “pegas” los `.md` dentro de Android Studio en un cuadro mágico al crear el proyecto.** Los pegas como **archivos en el disco** dentro del proyecto; después la IA los **lee** desde ahí o tú los **adjuntas** al chat.

### 0.4 Comprobar que Flutter corre

1. En Android Studio, arriba elige un **dispositivo** (emulador o teléfono USB con depuración USB).
2. Clic en el triángulo verde **Run** ▶.
3. Deberías ver la app de demostración en el dispositivo. Si falla, revisa la pestaña **Run** / **Build** para el error concreto.

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

## 2) Android Studio + Flutter (referencia; creación detallada en §0)

### 2.1 Instalación (ya la tienes si `flutter doctor` está bien)

1. **Android Studio** + **Android SDK** + emulador o dispositivo físico.
2. **Flutter SDK** (stable): https://docs.flutter.dev/get-started/install/windows  
3. `flutter doctor` sin errores críticos; `flutter doctor --android-licenses` si pide licencias.
4. Plugin **Flutter** + **Dart** en Android Studio (§0.2).

### 2.2 Crear el proyecto

Resumido en **§0.2** — siempre **New Flutter Project**, no “New Project” nativo ni “Create with AI” para este POS.

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

## 3) Cómo usar Gemini paso a paso (dónde “pegar” y cómo chatear)

Los documentos **no** van en la pantalla “Create with AI” de un proyecto Android nativo. Van en tu **carpeta del proyecto Flutter** y/o en el **chat de Gemini** (o del asistente que uses).

### 3.1 Dónde viven los documentos (recomendado)

| Ubicación | Qué haces |
|-----------|-----------|
| `tu_proyecto_flutter/docs/backend/FRONTEND_INTEGRATION_CONTEXT.md` | Copias desde el repo del backend (tabla en `DOCUMENTOS_A_COPIAR_AL_PROYECTO_FLUTTER.md`). |
| `tu_proyecto_flutter/docs/backend/IMPLEMENTACION_FLUTTER_ANDROID_GEMINI.md` | Opcional pero útil: misma guía que estás leyendo. |
| Otros `.md` (`SYNC_CONTRACTS.md`, `MULTI_CURRENCY_ARCHITECTURE.md`, …) | Misma carpeta `docs/backend/` si quieres que la IA tenga el contrato completo. |

Así el proyecto es **autodescriptivo**: cualquier herramienta que indexe el repo (Cursor, GitHub Copilot, etc.) puede verlos. Para **Gemini en el navegador**, los subes o los pegas en cada conversación (ver §3.3).

### 3.2 Gemini / IA **dentro** de Android Studio

Según tu versión y región puede llamarse **Gemini in Android Studio**, **Studio Bot**, **Codey** u otro nombre.

1. Abre el panel del asistente (icono de chat / menú **View → Tool Windows** si aplica).
2. Si permite **@archivos** o **Add context**: añade `docs/backend/FRONTEND_INTEGRATION_CONTEXT.md` y, si cabe, esta guía.
3. Si **no** deja adjuntar `.md`, abre el archivo en el editor, **selecciona todo el texto**, copia, y en el primer mensaje pega: *“Esta es la API del backend; obedece solo esto”* + el pegado (o pide “lee el archivo abierto” si el asistente tiene acceso al archivo actual).

**Importante:** el asistente del IDE genera código en el archivo que tengas abierto; pide siempre **archivos Dart concretos** (`lib/core/api/...`) para no mezclar con Kotlin.

### 3.3 Gemini en el **navegador** (Google AI Studio / gemini.google.com)

1. Entra a [Google AI Studio](https://aistudio.google.com/) o a la app **Gemini**.
2. **Nueva conversación** → si hay opción **Upload file** o **Insertar archivo**, sube `FRONTEND_INTEGRATION_CONTEXT.md` (y si cabe `IMPLEMENTACION_FLUTTER_ANDROID_GEMINI.md`).
3. Si no hay subida de archivo: abre el `.md` en el Bloc de notas, copia el contenido y pégalo en el primer mensaje (puede ser largo; Gemini suele aceptar textos grandes).
4. Segundo mensaje (ejemplo):  
   *“Con esa API, genera solo el código Dart para `lib/core/api/api_client.dart`: baseUrl por variable de entorno o constante, headers `X-Store-Id` y `Content-Type: application/json`, parseo de errores `{ statusCode, message, requestId }`. No inventes rutas que no estén en el documento.”*
5. Copia la respuesta al archivo correspondiente en Android Studio y **revísalo** (imports, null-safety, `pubspec`).

### 3.4 Prompt base (cópialo y reutiliza)

```text
Eres un asistente para una app Flutter POS. Fuente de verdad: el archivo FRONTEND_INTEGRATION_CONTEXT.md (API /api/v1, headers X-Store-Id, multi-moneda, strings para decimales).
Reglas: no inventes endpoints; si algo no está documentado, di “no existe en API” y deja un TODO.
Stack: Flutter 3.x, Dart null-safety. Solo archivos bajo lib/.
```

### 3.5 Orden de trabajo recomendado (primer día)

1. Proyecto Flutter creado (§0) y **Run** ▶ funciona.  
2. Carpeta `docs/backend/` con al menos **`FRONTEND_INTEGRATION_CONTEXT.md`**.  
3. Añade en `pubspec.yaml` `http` o `dio` + `shared_preferences`.  
4. Pide a Gemini el **cliente HTTP mínimo** + **modelo** de respuesta de `GET .../business-settings`.  
5. Pide una **pantalla** simple: campo UUID tienda + botón “Conectar” que llame a `business-settings` y muestre nombre de tienda y monedas.

### 3.6 Qué no hacer

- No uses **Create with AI** del asistente de **proyecto Android nativo** para este repo Flutter.  
- No pegues documentación solo en un chat y luego borres el mensaje: **guarda los `.md` en el proyecto** para la siguiente sesión.  
- No mezcles “inventar” `GET /suppliers`: el contexto dice que **no existe**; la UI de proveedores es local hasta que el backend lo exponga.

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
