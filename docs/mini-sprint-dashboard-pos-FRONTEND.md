# Mini Sprint Dashboard POS — Implementación Frontend (Flutter)

> **Contrato API (entregar al equipo front):** [`FRONTEND_DASHBOARD_API.md`](./FRONTEND_DASHBOARD_API.md) — endpoints, headers, JSON de respuesta y flujos.  
> **Origen:** `docs/mini-sprint-dashboard-pos.md`  
> **Backend (ya implementado):** `docs/mini-sprint-dashboard-pos-BACKEND.md`  
> **Contexto app:** `docs/FRONTEND_INTEGRATION_CONTEXT.md`

---

## 1. Análisis para el cliente

### 1.1 Qué encaja bien con la app actual

- Arquitectura por **features** ya usada en Flutter.
- Convenciones conocidas: `X-Store-Id`, montos `String`, errores `{ statusCode, message[] }`.
- Pantalla de inicio tipo `StoreDashboardScreen` — el nuevo módulo puede convivir o reemplazar métricas “caseras” locales.
- `CONFIG_ADMIN_PIN` para acciones administrativas (activar modo dashboard en un dispositivo).

### 1.2 Riesgos / mejoras UX

| Tema | Mejora recomendada |
|------|-------------------|
| Duplicar lógica de fechas | **No** calcular KPIs en el cliente; solo presets → query params al backend. |
| Modo kiosk sin auth de usuario | Flujo de **onboarding único**: escanear/ingresar `deviceId` + token + guardar en secure storage. |
| Refresh cada 30–60s | Usar `Timer` + cancelar en `dispose`; mostrar `lastUpdatedAt` visible. |
| Sin red | Pantalla offline clara; opcional cache último summary (Hive/SharedPreferences). |
| Mezclar POS y dashboard | Rutas separadas; `deviceMode` del backend decide shell inicial (POS vs Dashboard). |

### 1.3 Dependencias del backend (orden)

1. `GET /reports/sales/summary` (+ timeseries, payments) con `X-Store-Id`
2. `GET /dashboard/device/:deviceId` + `X-Device-Token` para kiosk
3. `PATCH /pos-devices/:deviceId/dashboard-config` (admin) para activar dispositivo

El front **no** debe entrar en producción de kiosk hasta el endpoint consolidado y token estén probados.

---

## 2. Alcance frontend v1

### Incluido

- Feature `dashboard` desacoplada del flujo de cobro.
- `DashboardHomeScreen` — operador con filtros completos.
- `DeviceDashboardScreen` — TV/kiosk solo lectura.
- KPI cards, gráfico serie, desglose pagos.
- Presets: hoy, ayer, semana, mes, rango custom.
- Estados: loading, error, vacío, no autorizado.

### Excluido (v1)

- Margen / rentabilidad por producto.
- Comparativo semana anterior.
- Multi-sucursal en una sola pantalla.
- Edición de configuración de tienda dentro del dashboard.

---

## 3. Estructura de carpetas sugerida

```text
lib/features/dashboard/
  data/
    dashboard_api.dart
    dashboard_repository.dart
    dashboard_local_cache.dart      # opcional
  domain/
    dashboard_summary.dart
    dashboard_timeseries.dart
    payment_breakdown_item.dart
    dashboard_filters.dart
  presentation/
    screens/
      dashboard_home_screen.dart
      device_dashboard_screen.dart
      device_dashboard_setup_screen.dart   # primera vez: token
    controllers/
      dashboard_controller.dart
      device_dashboard_controller.dart
    widgets/
      kpi_card.dart
      kpi_row.dart
      sales_line_chart.dart              # fl_chart o similar
      payments_breakdown_list.dart
      date_range_selector.dart
      last_updated_banner.dart
```

Registrar rutas en el router principal (GoRouter / Navigator 2 — según el proyecto).

---

## 4. Capa de datos

### 4.1 API client

Extender el cliente HTTP existente (`lib/core/...`):

```dart
// Resumen operativo (requiere store configurado)
Future<DashboardSummary> getSalesSummary({
  required String storeId,
  String? dateFrom,
  String? dateTo,
  String? preset,       // today | yesterday | week | month
  String? deviceId,
});

Future<List<TimeSeriesPoint>> getSalesTimeSeries({...});

Future<List<PaymentBreakdownItem>> getSalesPayments({...});

// Kiosk — sin X-Store-Id; store resuelto en servidor
Future<DeviceDashboardPayload> getDeviceDashboard({
  required String deviceId,
  required String deviceToken,
  String? preset,
});
```

Headers:

| Pantalla | Headers |
|----------|---------|
| `DashboardHomeScreen` | `X-Store-Id` (como el resto del POS) |
| `DeviceDashboardScreen` | `X-Device-Token` |
| Setup admin (activar dashboard) | `X-Store-Id` + PIN admin |

### 4.2 Modelos

- Parsear montos como `String` → mostrar con formatter local (separador miles, 2 decimales).
- `tickets` como `int`.
- Guardar `currencyCode` del summary para etiquetar cards (“USD”, “VES”).

### 4.3 Cache opcional (kiosk)

Clave: `dashboard_last_payload_{deviceId}`  
TTL sugerido: 5 minutos. Si falla red, mostrar cache + banner “Sin conexión — datos de hace X min”.

---

## 5. Pantallas y flujos

### 5.1 `DashboardHomeScreen`

**Entrada:** menú lateral / botón desde home de tienda (solo si no es modo `DASHBOARD` puro).

**Layout:**

1. AppBar con título “Dashboard operativo” + ícono refresh manual.
2. `DateRangeSelector` (chips: Hoy, Ayer, Semana, Mes, Personalizado).
3. Fila de 4–6 `KpiCard`: brutas, devoluciones, netas, tickets, ticket promedio, tasa devolución (si API la envía).
4. `SalesLineChart` — serie `netSales` por día.
5. `PaymentsBreakdownList` — métodos y montos.

**Controller (`dashboard_controller.dart`):**

- Estado: `AsyncValue<DashboardState>` o equivalente (Riverpod/Bloc según proyecto).
- Al cambiar filtro → paralelizar 3 llamadas (`summary`, `timeseries`, `payments`) o una sola si backend añade endpoint “full” para home (opcional).
- Debounce 300ms en rango personalizado.

### 5.2 `DeviceDashboardScreen` (kiosk)

**Entrada:** 

- App detecta `deviceMode == DASHBOARD` al arranque → navegación directa.
- O deep link interno `/dashboard/kiosk`.

**Comportamiento:**

- Sin drawer ni acceso a POS cobro.
- Preset fijo `today` (configurable en v1.1).
- `Timer.periodic(Duration(seconds: 45))` → `getDeviceDashboard`.
- UI grande: 3 KPIs principales (netas, tickets, devoluciones) + mini gráfico + pagos.
- `last_updated_banner` tras cada refresh exitoso.

### 5.3 `DeviceDashboardSetupScreen` (admin, una vez)

Flujo para convertir tablet en kiosk:

1. Pedir PIN admin (`CONFIG_ADMIN_PIN`).
2. Mostrar `deviceId` de instalación (ya usado en sync).
3. Llamar `PATCH .../dashboard-config` con `dashboardEnabled: true`, `deviceMode: DASHBOARD`, `regenerateToken: true`.
4. Mostrar token **una vez** para copiar/guardar en secure storage del kiosk.
5. Reiniciar app en modo dashboard.

---

## 6. Selector de fechas (presets)

Mapeo UI → API (delegar cálculo de fechas al backend con `preset`):

| UI | Query |
|----|--------|
| Hoy | `preset=today` |
| Ayer | `preset=yesterday` |
| Esta semana | `preset=week` |
| Este mes | `preset=month` |
| Personalizado | `dateFrom` + `dateTo` (YYYY-MM-DD) |

Mostrar en UI el rango efectivo devuelto en `meta.from` / `meta.to` / `meta.timezone` si el backend lo incluye.

**Límite:** si el usuario elige más de 31 días, mostrar error del backend de forma amigable.

---

## 7. Widgets

### `KpiCard`

- Título, valor grande, subtítulo opcional (moneda).
- Color semántico: netas (verde), devoluciones (ámbar), brutas (neutral).

### `SalesLineChart`

- Eje X: `bucket` (fecha).
- Eje Y: `netSales` parseado a double solo para dibujo, etiquetas desde string original.
- Manejar 1 punto o vacío → placeholder “Sin ventas en el período”.

### `PaymentsBreakdownList`

- Lista o barras horizontales proporcionales al total.
- Mostrar `method` legible (mapear `USD_CASH` → “Efectivo USD” en capa UI).

---

## 8. Estados de error

| Código / situación | UX |
|--------------------|-----|
| 401 token kiosk inválido | Pantalla full “Dispositivo no autorizado” + botón “Reconfigurar” (solo con PIN) |
| 403 dashboard deshabilitado | Mensaje + contactar administrador |
| Sin datos (200, ceros) | Empty state “Sin movimientos en el período” |
| Timeout / sin red | Retry + cache si existe |
| 400 rango inválido | Snackbar con mensaje backend |

---

## 9. Integración con shell de la app

### Arranque condicional

```text
Al iniciar:
  leer deviceMode local (cache de última config o GET dashboard-config)
  si DASHBOARD → DeviceDashboardScreen
  si HYBRID → StoreDashboard con acceso a POS y Dashboard
  si POS → flujo actual
```

Sincronizar `deviceMode` tras cada `sync/push` exitoso si el backend devuelve config de dispositivo (fase 2); en v1 basta lectura al configurar.

### No romper offline POS

- El dashboard es **online-first** en v1.
- La cola de sync del POS sigue independiente; el dashboard no consume `sync/push`.

---

## 10. Orden de implementación (frontend)

### Fase A — Esqueleto (sin gráficos)

- [ ] Feature folder + rutas
- [ ] `dashboard_api` + modelos
- [ ] `DashboardHomeScreen` con KPIs estáticos desde API summary
- [ ] Loading / error / empty

### Fase B — Visualización

- [ ] DateRangeSelector + presets
- [ ] Gráfico timeseries
- [ ] Lista pagos

### Fase C — Kiosk

- [ ] Secure storage token + deviceId
- [ ] `DeviceDashboardScreen` + auto-refresh
- [ ] `DeviceDashboardSetupScreen` + PIN admin

### Fase D — Pulido

- [ ] Formatter moneda + métodos de pago
- [ ] Cache offline kiosk
- [ ] Pruebas manuales en tablet 24h

---

## 11. Pruebas manuales (checklist)

- [ ] Hoy con ventas reales → netas = brutas − devoluciones.
- [ ] Día sin ventas → ceros, sin crash en gráfico.
- [ ] Cambio ayer / semana → datos cambian.
- [ ] Devolución de ayer aparece en devoluciones de ayer, no en hoy.
- [ ] Kiosk: token incorrecto → pantalla no autorizado.
- [ ] Kiosk: refresh 45s sin memory leak (salir y entrar).
- [ ] Emulador Android `10.0.2.2` vs dispositivo real IP LAN.

---

## 12. Mejoras post-v1 (frontend)

- Comparativo “vs semana anterior” (badge % en KPI).
- Modo oscuro para TV.
- Export CSV desde summary (share sheet).
- Widget compacto en `StoreDashboardScreen` (“Hoy: X netas”).
- Pull-to-refresh en home dashboard.

---

## 13. Coordinación con backend

| Necesidad front | Endpoint backend |
|-----------------|------------------|
| Tablero completo | `summary`, `timeseries`, `payments` |
| TV dedicada | `GET /dashboard/device/:deviceId` |
| Activar tablet | `PATCH .../dashboard-config` |
| Probar sin UI | Postman collection (misma carpeta que el resto de la API) |

Cuando el backend cierre Fase 2, integrar URLs en `app_config.dart` / variables de entorno como el resto de módulos.

---

**Inicio recomendado en front:** Fase A en paralelo al backend Fase 2, usando mocks JSON locales hasta tener API real.
