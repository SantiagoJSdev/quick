# Mini Sprint — Módulo Dashboard Operativo para POS

> **Documentos derivados (implementación dividida):**
>
> | Documento | Contenido |
> |-----------|-----------|
> | [mini-sprint-dashboard-pos-BACKEND.md](./mini-sprint-dashboard-pos-BACKEND.md) | Análisis validado, mejoras, API, Prisma, fases y checklist **backend** |
> | [**FRONTEND_DASHBOARD_API.md**](./FRONTEND_DASHBOARD_API.md) | **Handoff al front:** endpoints, headers, respuestas JSON y flujos |
> | [mini-sprint-dashboard-pos-FRONTEND.md](./mini-sprint-dashboard-pos-FRONTEND.md) | Flutter: pantallas, estructura, kiosk, UX y checklist |
>
> Para integrar el cliente Flutter, usar **`FRONTEND_DASHBOARD_API.md`**. Este archivo conserva la visión de producto.

## Objetivo

Implementar un módulo nuevo de **Dashboard Operativo / Reportes de Ventas** orientado a obtener una primera versión funcional, escalable y alineada con una arquitectura real de alto nivel. El módulo debe permitir visualizar ventas, devoluciones y métricas operativas por día, rango de fechas y semana, además de poder ejecutarse en un dispositivo dedicado solo a este módulo, incluso sin un sistema formal de usuarios y roles todavía.
## Contexto actual del sistema

El sistema ya cuenta con módulos de inventario, POS, compras, devoluciones, sincronización offline y soporte multi-moneda con snapshot de tasa de cambio por documento. El modelo de datos ya incluye entidades clave para este nuevo módulo, como `Sale`, `SalePayment`, `SaleReturn`, `POSDevice`, `Store` y metadatos de sincronización por `deviceId` y `opId`, lo que permite construir reportes útiles sin rehacer la base operativa.
La guía de esquema recomienda separar el modelo transaccional OLTP del analítico y sugiere usar vistas o vistas materializadas para reportes pesados, además de documentar con precisión semánticas monetarias, estados y fechas de negocio. Esa recomendación es la base de esta propuesta.

## Recomendación funcional

El siguiente módulo a desarrollar debe ser un **Dashboard Operativo** centrado primero en caja, ventas y devoluciones. Esta decisión ofrece un retorno temprano porque el sistema ya registra ventas por tienda, dispositivo, método de pago y período, y también posee devoluciones relacionadas a ventas originales.
La versión 1 debe enfocarse en preguntas operativas concretas:

- Cuánto se vendió hoy.
- Cuánto se devolvió hoy.
- Cuál fue la venta neta.
- Cuántos tickets se emitieron.
- Cuál fue el ticket promedio.
- Cómo se distribuyó el cobro por método de pago.
- Cómo se comportan las ventas por día, semana o rango personalizado.
## Alcance de la versión 1

### KPIs mínimos

La primera entrega debe incluir los siguientes indicadores:

- Ventas brutas.
- Devoluciones.
- Ventas netas.
- Cantidad de tickets.
- Ticket promedio.
- Total cobrado por método de pago.
### Filtros mínimos

- Hoy.
- Ayer.
- Esta semana.
- Este mes.
- Rango personalizado.
- Tienda.
- Dispositivo opcional.
### Vistas mínimas de frontend

- **Resumen Hoy** con cards KPI.
- **Resumen por Período** con selector de rango.
- Serie diaria de ventas netas.
- Tabla o lista de pagos por método.
- Modo TV/Kiosk para un dispositivo dedicado.
## Decisiones de diseño de producto

### Nombre del módulo

Se recomienda nombrar el módulo como:

- `Dashboard Operativo`, o
- `Operational Analytics / Sales Dashboard`.
### Qué no incluir en la v1

Para evitar sobrecargar el sprint, la primera iteración no debe incluir:

- Margen real contable.
- Cierre de caja por turno avanzado.
- Reportes complejos de inventario.
- Consolidado multi-sucursal avanzado.
- Rentabilidad por categoría o producto con lógica contable profunda.
Es mejor estabilizar primero métricas confiables de ventas y devoluciones antes de abrir frentes analíticos más complejos.
## Arquitectura propuesta

La implementación debe seguir una separación simple pero profesional entre operaciones y analítica.

| Capa | Responsabilidad | Implementación recomendada |
|---|---|---|
| Modelo transaccional | Registrar ventas, devoluciones, pagos, dispositivos | Reutilizar `Sale`, `SalePayment`, `SaleReturn`, `POSDevice` sin alterar su propósito principal. |
| Read model analítico | Agregar información por fecha, tienda y método de pago | Crear vistas SQL o materialized views orientadas al dashboard. |
| API de reportes | Exponer resúmenes, series y composición de pagos | Crear módulo backend `reports` o `dashboard` con endpoints agregados. |
| Frontend dashboard | Consumir endpoints y renderizar tablero | Nueva feature independiente del POS de cobro. |

## Estrategia técnica recomendada

La implementación debe evitar consultas pesadas directamente desde la UI hacia tablas transaccionales crudas. La guía del esquema recomienda crear vistas de hechos y una capa ligera de analítica para evitar presión innecesaria sobre el modelo OLTP.
### Opción recomendada para v1

Crear vistas SQL agregadas por día y usar esos resultados desde el servicio de reportes.

### Evolución opcional posterior

Si el dashboard se consulta con frecuencia alta o se muestra en una pantalla permanente, entonces conviene migrar esas vistas a **materialized views** con refresco programado.
## Modelo de datos propuesto

### Extensión mínima de POSDevice

Como aún no existe autenticación formal ni perfiles, el control del acceso a este módulo puede apoyarse en `POSDevice`, que ya existe para trazabilidad de operaciones offline por tienda y dispositivo.
Se recomienda extender `POSDevice` con estos campos:

- `dashboardEnabled: boolean`
- `deviceMode: 'POS' | 'DASHBOARD' | 'HYBRID'`
- `dashboardView: 'SALES_SUMMARY'`
- `dashboardAccessToken: string | null`
- `lastHeartbeatAt: DateTime | null` opcional

### Motivo de esta decisión

Usar solo un booleano suelto resuelve la urgencia, pero deja la implementación rígida. En cambio, modelar `deviceMode`, `dashboardView` y un token de acceso permite crecer después a más vistas, más tipos de dispositivo y controles de acceso más limpios sin rehacer la base.
## Read model analítico propuesto

### Vista 1 — `vw_dashboard_sales_daily`

Campos sugeridos:

- `store_id`
- `device_id`
- `business_day`
- `sales_count`
- `gross_sales_functional`
- `gross_sales_document` opcional

### Vista 2 — `vw_dashboard_returns_daily`

Campos sugeridos:

- `store_id`
- `device_id`
- `business_day`
- `returns_count`
- `returns_functional`

### Vista 3 — `vw_dashboard_payments_daily`

Campos sugeridos:

- `store_id`
- `device_id`
- `business_day`
- `payment_method`
- `amount_functional`

### Moneda a usar en dashboard

La primera versión debe presentar sus KPIs principalmente en **moneda funcional**, porque el sistema ya trabaja con multi-moneda y snapshot FX por documento, y la guía recomienda exponer montos en documento y funcional cuando existan ambos. Para la v1, mostrar funcional reduce complejidad en la lectura operativa.
## Reglas de negocio del módulo

### Estados válidos

Antes de programar el dashboard, se debe documentar qué estados de `Sale` y `SaleReturn` cuentan como válidos para reportes. La guía recomienda estandarizar estados string en enums o referencias consistentes para evitar reportes inconsistentes.
Recomendación práctica:

- Incluir ventas en estado final confirmado, por ejemplo `COMPLETED` o equivalente real del sistema.
- Incluir devoluciones en estado final confirmado.
- Excluir `DRAFT`, `VOIDED`, `CANCELLED`, `FAILED` o equivalentes si existen.
### Fórmulas oficiales

Las fórmulas de KPI deben quedar definidas desde el inicio.

- `grossSales`: suma de ventas válidas confirmadas.- `returns`: suma de devoluciones válidas confirmadas.- `netSales = grossSales - returns`.- `tickets`: cantidad de ventas válidas confirmadas.- `avgTicket`: preferiblemente `netSales / tickets`, pero debe elegirse una sola definición y dejarla documentada.- `returnRate = returns / grossSales` como KPI opcional listo para crecimiento.
### Fecha de negocio

La guía recomienda distinguir `createdAt` de fecha técnica y fecha de negocio para reportes. En la v1 puede usarse `Sale.createdAt` como base, pero conviene dejar preparado el concepto de `businessDate` para una fase posterior, especialmente si el negocio necesita cierres de caja que crucen medianoche.
## Contrato de API recomendado

### Configuración de dispositivo dashboard

#### `GET /api/v1/pos-devices/:id/dashboard-config`

Debe retornar la configuración actual del dispositivo para este módulo.

#### `PATCH /api/v1/pos-devices/:id/dashboard-config`

Debe permitir marcar o actualizar un dispositivo como dashboard.

Ejemplo de body:

```json
{
  "dashboardEnabled": true,
  "deviceMode": "DASHBOARD",
  "dashboardView": "SALES_SUMMARY"
}
```

### Endpoints del módulo de reportes

#### `GET /api/v1/reports/sales/summary?storeId=...&from=...&to=...`

Debe devolver:

- ventas brutas
- devoluciones
- ventas netas
- tickets
- ticket promedio
- moneda base usada

#### `GET /api/v1/reports/sales/timeseries?storeId=...&from=...&to=...&groupBy=day`

Debe devolver una serie agregada para pintar gráfica diaria o semanal.
#### `GET /api/v1/reports/sales/payments?storeId=...&from=...&to=...`

Debe devolver el desglose por método de pago, usando `SalePayment` como base.
#### `GET /api/v1/reports/sales/by-device?storeId=...&from=...&to=...`

Debe devolver métricas por dispositivo para trazabilidad o comparación entre cajas.
### Endpoint especial para dispositivo dedicado

#### `GET /api/v1/dashboard/device/:deviceId`

Este endpoint debe existir como respuesta simplificada para una pantalla dedicada. Debe validar que el dispositivo exista, pertenezca a una tienda, tenga dashboard habilitado y presente un token válido de acceso.
Ejemplo de respuesta:

```json
{
  "device": {
    "id": "uuid",
    "dashboardEnabled": true,
    "deviceMode": "DASHBOARD",
    "dashboardView": "SALES_SUMMARY"
  },
  "filters": {
    "preset": "today",
    "storeId": "uuid"
  },
  "summary": {
    "grossSales": "250.00",
    "returns": "10.00",
    "netSales": "240.00",
    "tickets": 18,
    "avgTicket": "13.33"
  },
  "payments": [
    { "method": "USD_CASH", "amount": "120.00" },
    { "method": "VES_CASH", "amount": "80.00" }
  ],
  "series": [
    { "bucket": "2026-06-04", "netSales": "240.00" }
  ]
}
```

## Seguridad mínima sin usuarios ni roles

Como todavía no hay autenticación ni perfiles, no conviene exponer el dashboard solo con `deviceId` como pseudo-secreto. Eso sería débil para una aplicación real.
La solución mínima recomendada es:

- `deviceId`
- `storeId`
- `dashboardEnabled = true`
- `dashboardAccessToken` o PIN técnico

### Recomendación práctica

Usar un header como:

```http
X-Device-Token: <token>
```

O un query param temporal solo si no hay otra opción. La opción por header es más limpia y más fácil de endurecer luego.
## Diseño de frontend recomendado

El frontend debe implementarse como una nueva feature separada del flujo de cobro. El documento de integración ya describe una app Flutter con módulos por feature y una arquitectura basada en API, storage local, sync y shell principal, por lo que este módulo puede entrar como una feature independiente sin romper el POS actual.
### Pantallas mínimas

#### 1. `DashboardHomeScreen`

Debe mostrar:

- cards KPI
- selector de rango
- gráfico de serie temporal
- desglose por método de pago
- estado de actualización

#### 2. `DeviceDashboardScreen`

Modo simplificado de solo lectura para pantallas fijas. Debe abrir directamente con el resumen del día, refresco automático y sin accesos al resto de módulos.### Estados UX que deben existir

- loading inicial
- error de carga
- sin datos
- token inválido o dispositivo no autorizado
- refresco automático visible con timestamp de última actualización

## Orden de implementación recomendado

El desarrollo debe seguir este orden para minimizar riesgo:

1. Definir fórmulas oficiales y estados válidos del dashboard.2. Extender `POSDevice` con los nuevos campos.3. Crear vistas SQL de agregación diaria.4. Implementar servicio backend `reports`.5. Exponer endpoints de summary, timeseries, payments y by-device.6. Exponer endpoint especial `dashboard/device/:deviceId`.7. Crear frontend del módulo dashboard.8. Activar modo dedicado por dispositivo.9. Agregar refresh automático, estados UX y pruebas.
## Mini sprint detallado

### Historia 1 — Extensión de dispositivo

**Objetivo:** permitir que un dispositivo pueda comportarse como POS, dashboard o híbrido.

**Tareas:**

- Agregar campos nuevos a `POSDevice`.
- Crear migración en Prisma o SQL.
- Definir valores por defecto para dispositivos existentes.
- Agregar endpoint de lectura y escritura de `dashboard-config`.

**Criterio de aceptación:** un dispositivo puede activarse como `DASHBOARD` y quedar asociado a una vista permitida.
### Historia 2 — Definición funcional del dashboard

**Objetivo:** dejar documentadas las reglas del módulo antes de programarlo.

**Tareas:**

- Confirmar estados de venta válidos.
- Confirmar estados de devolución válidos.
- Confirmar fórmula de `avgTicket`.
- Definir si la fecha base será `createdAt` o una fecha de negocio específica.
- Definir moneda oficial de presentación en v1.

**Criterio de aceptación:** existe una especificación funcional única para los KPIs y filtros.
### Historia 3 — Read model analítico

**Objetivo:** crear una fuente ligera y estable para los endpoints del dashboard.

**Tareas:**

- Crear `vw_dashboard_sales_daily`.
- Crear `vw_dashboard_returns_daily`.
- Crear `vw_dashboard_payments_daily`.
- Revisar índices sobre `Sale`, `SaleReturn` y `SalePayment`.

**Criterio de aceptación:** las consultas del dashboard no dependen de joins complejos en tiempo real sobre el modelo transaccional completo.
### Historia 4 — Backend reports

**Objetivo:** exponer una API agregada, limpia y lista para UI.

**Tareas:**

- Crear módulo `reports` o `dashboard`.
- Implementar servicio de summary.
- Implementar servicio de timeseries.
- Implementar servicio de payments.
- Implementar servicio de by-device.

**Criterio de aceptación:** los endpoints responden datos agregados, consistentes y rápidos.
### Historia 5 — Endpoint de dashboard por dispositivo

**Objetivo:** habilitar una pantalla dedicada sin necesidad de auth completa.

**Tareas:**

- Crear endpoint `GET /dashboard/device/:deviceId`.
- Validar dispositivo, tienda, modo, habilitación y token.
- Entregar payload consolidado para pintar la pantalla en una sola llamada.

**Criterio de aceptación:** un dispositivo dedicado puede abrir y consumir exclusivamente el módulo dashboard.
### Historia 6 — Frontend dashboard

**Objetivo:** exponer el módulo en Flutter de forma desacoplada del POS operativo.

**Tareas:**

- Crear feature `dashboard`.
- Crear `DashboardHomeScreen`.
- Crear `DeviceDashboardScreen`.
- Crear provider/controller o equivalente.
- Implementar refresco automático cada 30 a 60 segundos.
- Manejar loading, empty, error y no autorizado.

**Criterio de aceptación:** la UI renderiza KPIs, serie temporal y desglose de pagos usando la nueva API.
## Estructura sugerida en backend

```text
src/
  modules/
    reports/
      application/
        get-sales-summary.use-case.ts
        get-sales-timeseries.use-case.ts
        get-sales-payments.use-case.ts
        get-device-dashboard.use-case.ts
      domain/
        dashboard-kpis.ts
      infrastructure/
        reports.repository.ts
        sql/
          vw_dashboard_sales_daily.sql
          vw_dashboard_returns_daily.sql
          vw_dashboard_payments_daily.sql
      interfaces/
        reports.controller.ts
        dto/
          sales-summary-query.dto.ts
          sales-timeseries-query.dto.ts
          device-dashboard-query.dto.ts
```

## Estructura sugerida en Flutter

```text
lib/
  features/
    dashboard/
      data/
        dashboard_api.dart
        dashboard_repository.dart
      domain/
        dashboard_summary.dart
        dashboard_timeseries_point.dart
      presentation/
        screens/
          dashboard_home_screen.dart
          device_dashboard_screen.dart
        controllers/
          dashboard_controller.dart
        widgets/
          kpi_card.dart
          payments_breakdown.dart
          sales_line_chart.dart
```

## DTOs sugeridos

### `SalesSummaryResponseDto`

```json
{
  "storeId": "uuid",
  "currencyCode": "USD",
  "from": "2026-06-01",
  "to": "2026-06-07",
  "grossSales": "1000.00",
  "returns": "120.00",
  "netSales": "880.00",
  "tickets": 84,
  "avgTicket": "10.48"
}
```

### `SalesTimeSeriesPointDto`

```json
{
  "bucket": "2026-06-04",
  "grossSales": "250.00",
  "returns": "10.00",
  "netSales": "240.00",
  "tickets": 18
}
```

### `PaymentBreakdownDto`

```json
[
  { "method": "USD_CASH", "amount": "120.00" },
  { "method": "VES_CASH", "amount": "80.00" },
  { "method": "CARD", "amount": "50.00" }
]
```

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Estados inconsistentes en `Sale` o `SaleReturn` | KPIs erróneos | Estandarizar estados antes de construir reportes. |
| Diferencias entre moneda documento y funcional | Totales poco confiables | Definir moneda oficial del dashboard y documentar fórmula. |
| Endpoint por `deviceId` sin seguridad real | Exposición indebida | Agregar token por dispositivo desde la v1. |
| Consultas lentas sobre tablas operativas | Mala UX y presión sobre DB | Crear vistas o materialized views de agregación. |
| Futuro cambio a auth/roles | Refactor innecesario | Mantener la lógica de acceso encapsulada en `POSDevice` y servicio de autorización simple. |

## Backlog de evolución posterior

Una vez estabilizada la v1, el módulo puede crecer hacia:

- cierre de caja por turno
- comparativo semana actual vs anterior
- top productos
- ventas por categoría
- margen estimado
- salud de sincronización por dispositivo
- consolidado multi-sucursal
- alertas operativas en pantalla dedicada.
## Checklist final de ejecución para Cursor

### Backend

- [ ] Extender `POSDevice`.
- [ ] Crear migración.
- [ ] Definir enums o constantes de estados válidos.
- [ ] Crear vistas SQL de dashboard.
- [ ] Crear módulo `reports`.
- [ ] Implementar endpoints summary, timeseries, payments y by-device.
- [ ] Implementar endpoint `dashboard/device/:deviceId` con token.
- [ ] Agregar tests de agregación básica.

### Frontend

- [ ] Crear feature `dashboard`.
- [ ] Implementar pantalla `DashboardHomeScreen`.
- [ ] Implementar pantalla `DeviceDashboardScreen`.
- [ ] Integrar filtros de fecha.
- [ ] Pintar KPIs.
- [ ] Pintar serie temporal.
- [ ] Pintar pagos por método.
- [ ] Implementar refresh automático.
- [ ] Manejar estados loading, empty, error y no autorizado.

### Documentación

- [ ] Documentar fórmulas de KPI.
- [ ] Documentar estados válidos.
- [ ] Documentar contratos de endpoint.
- [ ] Registrar impacto en reportes dentro del documento maestro del proyecto, tal como recomienda la guía de mantenimiento documental.
## Decisión final recomendada

La mejor siguiente pieza para tu sistema es un **Dashboard Operativo desacoplado del POS de cobro**, apoyado en `POSDevice` para habilitación por dispositivo y en un read model analítico ligero para evitar cargar el modelo transaccional. Esta solución es suficientemente mínima para entrar ya en sprint, pero está bien pensada para evolucionar luego a un módulo de reportes más amplio, cercano a una aplicación tipo Odoo en organización y crecimiento funcional.