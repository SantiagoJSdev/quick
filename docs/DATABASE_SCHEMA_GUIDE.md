# Quick Market Backend - Guia de Esquema de Base de Datos

Este documento define las tablas principales del backend, sus relaciones y la funcion de cada una.
Esta guia sirve como base para onboarding tecnico, evolucion del sistema y construccion de reportes.

## 1. Objetivo del modelo de datos

El esquema actual esta orientado a:

- Operacion POS por tienda (catalogo, inventario, compras, ventas y devoluciones).
- Flujo offline/online con sincronizacion idempotente por dispositivo.
- Soporte multi-moneda con moneda funcional y snapshot de tasa de cambio por documento.
- Trazabilidad operativa para auditoria y analitica.

## 2. Convenciones recomendadas para documentar y reportar mejor

Antes de seguir ampliando el sistema, conviene mantener estas reglas:

1. **Modelo transaccional vs modelo analitico**
   - PostgreSQL actual es transaccional (OLTP).
   - Para reportes pesados, crear vistas materializadas o un esquema `analytics` (OLAP ligero) evita cargar endpoints operativos.

2. **Diccionario de datos por columna critica**
   - Definir semantica exacta para campos monetarios similares (`total`, `totalDocument`, `totalFunctional`).
   - Documentar si un campo es "snapshot historico" o "valor actual mutable".

3. **Catalogo de estados**
   - Estandarizar estados string (ejemplo: `Purchase.status`, `Sale.status`, `SyncOperation.status`) en enums o tabla de referencia para evitar variantes inconsistentes.

4. **Fechas de negocio**
   - Distinguir siempre `createdAt` (fecha tecnica) vs fecha de negocio (`dateReceived`, `exchangeRateDate`) en reportes.

5. **Identificadores para auditoria**
   - Mantener `opId`, `Idempotency-Key`, `deviceId`, `storeId` en los reportes de trazabilidad para poder reconstruir incidentes.

## 3. Mapa de dominios y tablas

### 3.1 Dominio de configuracion y monedas

#### `Currency`
- **Funcion**: Catalogo de monedas habilitadas (codigo, nombre, decimales).
- **Se relaciona con**:
  - `ExchangeRate` (base/quote).
  - `BusinessSettings` (moneda funcional y moneda por defecto de venta).

#### `ExchangeRate`
- **Funcion**: Historial de tasas de cambio por fecha efectiva y, opcionalmente, por tienda.
- **Se relaciona con**:
  - `Store` (si la tasa es especifica por tienda).
  - `Currency` (base y cotizada).
- **Uso en reportes**: reconstruccion de conversiones y conciliacion de documentos en multi-moneda.

#### `BusinessSettings`
- **Funcion**: Configuracion financiera por tienda.
- **Campos clave**:
  - `functionalCurrencyId`
  - `defaultSaleDocCurrencyId`
  - `defaultMarginPercent`
- **Se relaciona con**:
  - `Store`
  - `Currency`

### 3.2 Dominio maestro de catalogo

#### `ProductSkuCounter`
- **Funcion**: Contador global para generar SKU autoincremental.
- **Uso**: evita colisiones al crear SKU automatico.

#### `Category`
- **Funcion**: Jerarquia de categorias (autorelacion padre/hijo).
- **Se relaciona con**:
  - `Product`

#### `Tax`
- **Funcion**: Definicion de impuestos aplicables a productos.
- **Se relaciona con**:
  - `Product`

#### `Supplier`
- **Funcion**: Maestro de proveedores por tienda.
- **Se relaciona con**:
  - `Store`
  - `Product`
  - `Purchase`

#### `Product`
- **Funcion**: Maestro de productos del catalogo.
- **Campos clave**:
  - Identificacion: `sku`, `barcode`, `name`
  - Precio/costo: `price`, `cost`, `currency`
  - Reglas de pricing: `pricingMode`, `marginPercentOverride`
  - Scope: `catalogStoreId`
- **Se relaciona con**:
  - `Category`, `Tax`, `Supplier`, `Store`
  - `InventoryItem`, `StockMovement`
  - `PurchaseLine`, `SaleLine`, `SaleReturnLine`
- **Uso en reportes**: ventas por categoria, rentabilidad por producto, rotacion de inventario.

### 3.3 Dominio de inventario

#### `InventoryItem`
- **Funcion**: Existencia por producto y tienda.
- **Campos clave**:
  - `quantity`, `reserved`, `minStock`, `maxStock`
  - `averageUnitCostFunctional`, `totalCostFunctional`
- **Regla importante**: unicidad por (`productId`, `storeId`).
- **Uso en reportes**: stock actual, quiebres, cobertura y valorizacion.

#### `StockMovement`
- **Funcion**: Kardex/movimientos historicos de inventario.
- **Campos clave**:
  - `type` (`IN_*`, `OUT_*`)
  - `quantity`
  - costos/precios al momento
  - `referenceId`, `reason`, `opId`
- **Se relaciona con**:
  - `Product`, `Store`
- **Uso en reportes**: auditoria de ajustes, entradas/salidas netas, costo historico.

### 3.4 Dominio de compras

#### `Purchase`
- **Funcion**: Cabecera de compra a proveedor.
- **Campos clave**:
  - `supplierId`, `storeId`, `status`
  - `total`, `dateOrdered`, `dateReceived`
  - snapshot FX/documento (`fx*`, `totalDocument`, `totalFunctional`)
  - `supplierInvoiceReference`
- **Se relaciona con**:
  - `Supplier`, `Store`, `PurchaseLine`
- **Uso en reportes**: compras por periodo/proveedor, costo de abastecimiento.

#### `PurchaseLine`
- **Funcion**: Detalle de lineas de compra.
- **Campos clave**:
  - `productId`, `quantity`, `unitCost`, `totalCost`
  - costos document/functional por linea
- **Se relaciona con**:
  - `Purchase`, `Product`
- **Uso en reportes**: costo unitario historico y analisis por producto.

### 3.5 Dominio de ventas y cobros

#### `User`
- **Funcion**: Usuarios del sistema (cajeros/roles).
- **Se relaciona con**:
  - `Sale`

#### `POSDevice`
- **Funcion**: Dispositivo POS por tienda para trazabilidad offline.
- **Se relaciona con**:
  - `Store`
  - `Sale`
  - `SyncOperation`

#### `Sale`
- **Funcion**: Cabecera de venta.
- **Campos clave**:
  - `storeId`, `deviceId`, `userId`
  - `total`, `status`, `createdAt`
  - snapshot FX/documento (`fx*`, `totalDocument`, `totalFunctional`)
- **Se relaciona con**:
  - `Store`, `POSDevice`, `User`
  - `SaleLine`, `SalePayment`, `SaleReturn`
- **Uso en reportes**: ingresos por tienda/metodo/periodo y ticket promedio.

#### `SaleLine`
- **Funcion**: Lineas de la venta.
- **Campos clave**:
  - `productId`, `quantity`, `price`, `discount`, `total`
  - montos en documento/funcional
- **Se relaciona con**:
  - `Sale`, `Product`, `SaleReturnLine`
- **Uso en reportes**: mix de productos, descuentos, margen estimado.

#### `SalePayment`
- **Funcion**: Pagos asociados a una venta (incluye pago mixto).
- **Campos clave**:
  - `method`, `amount`, `currencyCode`
  - snapshot FX para cada pago
- **Se relaciona con**:
  - `Sale`
- **Uso en reportes**: distribucion por metodo de pago y exposicion por moneda.

### 3.6 Dominio de devoluciones

#### `SaleReturn`
- **Funcion**: Cabecera de devolucion asociada a venta original.
- **Campos clave**:
  - `originalSaleId`, `status`, `total`
  - snapshot FX + `fxPolicy`
- **Se relaciona con**:
  - `Store`, `Sale`, `SaleReturnLine`
- **Uso en reportes**: tasa de devolucion y recupero por periodo.

#### `SaleReturnLine`
- **Funcion**: Lineas devueltas por item vendido.
- **Campos clave**:
  - `saleLineId`, `productId`, `quantity`
  - montos document/functional
- **Se relaciona con**:
  - `SaleReturn`, `SaleLine`, `Product`

### 3.7 Dominio de sincronizacion y resiliencia

#### `StoreSyncState`
- **Funcion**: version monotona por tienda para `sync/push`.
- **Se relaciona con**:
  - `Store`

#### `SyncOperation`
- **Funcion**: registro de operaciones enviadas por POS offline.
- **Campos clave**:
  - `opId`, `opType`, `payload`, `status`
  - `serverVersion`, `failureReason`, `failureDetails`
- **Se relaciona con**:
  - `Store`, `POSDevice`
- **Uso en reportes**: salud de sincronizacion, retries y fallas por dispositivo.

#### `ServerChangeLog`
- **Funcion**: log append-only para `sync/pull` (cambios servidor).
- **Campos clave**:
  - `serverVersion` (global)
  - `opType`, `payload`, `storeScopeId`
- **Uso en reportes**: volumen de cambios y analisis de propagacion.

#### `IdempotencyRecord`
- **Funcion**: cache de respuestas para prevenir duplicados por `Idempotency-Key`.
- **Se relaciona con**:
  - `Store`
- **Uso en reportes**: detectar reintentos cliente y diagnosticar colisiones de requests.

#### `OutboxEvent`
- **Funcion**: cola transaccional para integraciones/eventos asincronos.
- **Campos clave**:
  - `aggregateType`, `aggregateId`, `eventType`
  - `status`, `attempts`, `availableAt`, `lastError`
- **Uso en reportes**: salud de integracion eventual y latencia de procesamiento.

### 3.8 Dominio de organizacion

#### `Store`
- **Funcion**: entidad organizacional principal (tienda/sucursal).
- **Se relaciona con**:
  - casi todos los modulos operativos (`Product` por catalogo de tienda, inventario, compras, ventas, devoluciones, sync, settings).
- **Uso en reportes**: particion natural multi-tenant y consolidado por sucursal.

## 4. Relaciones clave (vista rapida)

- **Store -> (1:N)** `InventoryItem`, `StockMovement`, `Purchase`, `Sale`, `SaleReturn`, `Supplier`, `POSDevice`, `ExchangeRate`, `SyncOperation`, `IdempotencyRecord`
- **Store -> (1:1)** `BusinessSettings`, `StoreSyncState`
- **Product -> (1:N)** `InventoryItem`, `StockMovement`, `PurchaseLine`, `SaleLine`, `SaleReturnLine`
- **Sale -> (1:N)** `SaleLine`, `SalePayment`, `SaleReturn`
- **SaleReturn -> (1:N)** `SaleReturnLine`
- **Purchase -> (1:N)** `PurchaseLine`
- **Supplier -> (1:N)** `Purchase`
- **Category -> (1:N)** `Product` y jerarquia autoreferenciada

## 5. Recomendaciones especificas para reporteria futura

1. **Crear vistas de hechos**
   - `fact_sales_lines`, `fact_purchase_lines`, `fact_stock_movements`.
   - Incluir llaves de dimension (`storeId`, `productId`, `categoryId`, `supplierId`, fecha).

2. **Dimensiones estables**
   - `dim_product`, `dim_store`, `dim_supplier`, `dim_category`, `dim_currency`.
   - Guardar atributos descriptivos para evitar joins costosos en cada reporte.

3. **Calendario de negocio**
   - Tabla `dim_date` para agregaciones por dia/semana/mes/trimestre sin recalculo repetido.

4. **KPI base sugeridos**
   - Ventas netas (descontando devoluciones).
   - Margen bruto estimado por producto/categoria.
   - Rotacion y dias de inventario.
   - Compras por proveedor y variacion de costo unitario.
   - Tasa de fallas de sync por dispositivo.

5. **Trazabilidad de moneda**
   - Reportar siempre monto en moneda documento y funcional cuando ambos existan.
   - Exponer origen de tasa (`fxSource`) y fecha efectiva para auditoria.

## 6. Buenas practicas de mantenimiento de esta guia

- Actualizar este archivo cuando se agreguen tablas/campos que cambien logica de negocio.
- Mantener consistencia con `prisma/schema.prisma` como fuente tecnica.
- En cada feature nueva, agregar una nota breve de impacto en reportes (que metricas habilita o altera).
