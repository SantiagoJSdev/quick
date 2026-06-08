# Quick Market — Guía de esquema de base de datos

Referencia de tablas, relaciones y propósito de cada entidad.  
Fuente técnica exacta: **`prisma/schema.prisma`**.  
Contexto general del backend: [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md).

---

## 1. Objetivo del modelo

El esquema está orientado a:

- Operación POS por tienda (catálogo, inventario, ventas, compras, devoluciones).
- Flujo offline/online con sincronización idempotente por dispositivo.
- Multi-moneda con moneda funcional y snapshot FX por documento confirmado.
- Trazabilidad para auditoría y reportes (dashboard, ops).

---

## 2. Convenciones para reportes y consultas

1. **OLTP vs analítica:** PostgreSQL es transaccional; reportes pesados → agregación en API o vistas/materialized views futuras.
2. **Montos:** distinguir `total` / `totalDocument` (moneda documento) vs `totalFunctional` (moneda funcional al confirmar).
3. **Estados:** ventas y devoluciones confirmadas usan `status = 'CONFIRMED'`.
4. **Fechas:** `createdAt` = timestamp técnico; en reportes usar timezone de `Store.timezone`.
5. **Auditoría:** conservar `opId`, `deviceId`, `storeId` en trazas.

---

## 3. Mapa de dominios y tablas

### 3.1 Configuración y monedas

#### `Currency`
- Catálogo de monedas (`code`, `name`, `decimals`).
- Relacionada con `ExchangeRate` y `BusinessSettings`.

#### `ExchangeRate`
- Historial de tasas: 1 base = `rateQuotePerBase` quote.
- Opcional por `storeId`; `effectiveDate` para fecha de negocio FX.

#### `BusinessSettings`
- 1:1 con `Store`.
- `functionalCurrencyId`, `defaultSaleDocCurrencyId`, `defaultMarginPercent`.

---

### 3.2 Catálogo

#### `ProductSkuCounter`
- Contador global SKU (`SKU-000001`).

#### `Category`
- Jerarquía padre/hijo autoreferenciada.

#### `Tax`
- Impuestos aplicables a productos.

#### `Supplier`
- Proveedor por tienda (`storeId`).
- Campo fiscal en DB: columna `rif` mapeada como `taxId` en Prisma.

#### `Product`
- Maestro: `sku`, `barcode`, `name`, `price`, `cost`, `pricingMode`, `marginPercentOverride`.
- `catalogStoreId`: scope catálogo por tienda.
- Relaciones: inventario, ventas, compras, movimientos.

---

### 3.3 Inventario

#### `InventoryItem`
- Stock por (`productId`, `storeId`): `quantity`, `reserved`, `minStock`, `maxStock`.
- Costos: `averageUnitCostFunctional`, `totalCostFunctional`.

#### `StockMovement`
- Kardex: `type` (`IN_PURCHASE`, `IN_ADJUST`, `OUT_SALE`, `OUT_ADJUST`, etc.).
- `opId` opcional; `referenceId`, `reason`.

---

### 3.4 Compras

#### `Purchase`
- Cabecera: `supplierId`, `storeId`, `status`, totales, snapshot FX.
- `supplierInvoiceReference`: factura/referencia proveedor.
- `dateOrdered`, `dateReceived`.

#### `PurchaseLine`
- Detalle: `productId`, `quantity`, `unitCost`, costos document/functional.

---

### 3.5 Ventas y cobros

#### `User`
- Usuarios/cajeros; opcional en `Sale.userId`.

#### `POSDevice`
- Terminal por `deviceId` (string instalación) y `storeId`.
- Trazabilidad: `lastSeen`, `appVersion`.
- Dashboard: `dashboardEnabled`, `deviceMode` (`POS`|`DASHBOARD`|`HYBRID`), `dashboardView`, `dashboardAccessTokenHash`, `lastHeartbeatAt`.

#### `Sale`
- Cabecera venta: `storeId`, `deviceId`, `status` (`CONFIRMED`), totales, snapshot FX.
- Relaciones: `SaleLine`, `SalePayment`, `SaleReturn`.

#### `SaleLine`
- Línea: `productId`, `quantity`, `price`, `discount`, montos document/functional.

#### `SalePayment`
- Cobro mixto: `method`, `amount`, `currencyCode`, `amountDocumentCurrency`, snapshot FX por pago.

---

### 3.6 Devoluciones

#### `SaleReturn`
- Cabecera: `originalSaleId`, `storeId`, `status`, totales, `fxPolicy`.

#### `SaleReturnLine`
- Línea: `saleLineId`, `productId`, `quantity`, montos document/functional.

---

### 3.7 Sync y resiliencia

#### `StoreSyncState`
- Versión monotona por tienda (`serverVersion`) para ack de `sync/push`.

#### `SyncOperation`
- Ops offline: `opId`, `opType`, `payload`, `status`, `failureReason`, `failureDetails`.

#### `ServerChangeLog`
- Stream global para `sync/pull`; `serverVersion` autoincrement, `storeScopeId` opcional.

#### `IdempotencyRecord`
- Cache `Idempotency-Key` (ej. `products-with-stock`).

---

### 3.8 Organización

#### `Store`
- Tienda/sucursal: `name`, `type`, `timezone`, `metadata`.
- Eje multi-tenant: casi todas las tablas operativas cuelgan de `storeId`.

---

## 4. Relaciones clave

```
Store 1──1 BusinessSettings, StoreSyncState
Store 1──N Sale, Purchase, SaleReturn, InventoryItem, StockMovement,
         Supplier, POSDevice, ExchangeRate, SyncOperation, IdempotencyRecord

Product 1──N InventoryItem, StockMovement, SaleLine, PurchaseLine, SaleReturnLine

Sale 1──N SaleLine, SalePayment
Sale 1──N SaleReturn (via originalSaleId)

Purchase 1──N PurchaseLine
Supplier 1──N Purchase

Category 1──N Product (+ jerarquía parent/children)
POSDevice.deviceId ← Sale.deviceId (string, no UUID de fila)
```

---

## 5. Consultas útiles (pgAdmin)

**Ventas recientes de una tienda:**

```sql
SELECT id, status, total, "totalFunctional", "deviceId", "createdAt"
FROM "Sale"
WHERE "storeId" = '<store-uuid>' AND status = 'CONFIRMED'
ORDER BY "createdAt" DESC
LIMIT 20;
```

**Devoluciones:**

```sql
SELECT id, "originalSaleId", total, "totalFunctional", "createdAt"
FROM "SaleReturn"
WHERE "storeId" = '<store-uuid>' AND status = 'CONFIRMED'
ORDER BY "createdAt" DESC
LIMIT 20;
```

**Ventas netas por día (manual):**

```sql
WITH sales AS (
  SELECT DATE("createdAt") AS day, SUM(COALESCE("totalFunctional", total)) AS gross
  FROM "Sale"
  WHERE "storeId" = '<store-uuid>' AND status = 'CONFIRMED'
  GROUP BY 1
),
returns AS (
  SELECT DATE("createdAt") AS day, SUM(COALESCE("totalFunctional", total)) AS ret
  FROM "SaleReturn"
  WHERE "storeId" = '<store-uuid>' AND status = 'CONFIRMED'
  GROUP BY 1
)
SELECT s.day,
       s.gross,
       COALESCE(r.ret, 0) AS returns,
       s.gross - COALESCE(r.ret, 0) AS net
FROM sales s
LEFT JOIN returns r ON r.day = s.day
ORDER BY s.day DESC;
```

**Dispositivos POS de una tienda:**

```sql
SELECT id, "deviceId", "deviceMode", "dashboardEnabled", "lastSeen"
FROM "POSDevice"
WHERE "storeId" = '<store-uuid>';
```

> Para reportes en producción usar los endpoints `/reports/sales/*` (timezone de tienda). SQL directo es útil para auditoría y pgAdmin.

---

## 6. KPIs del dashboard (referencia)

| Métrica | Origen |
|---------|--------|
| Ventas brutas | `SUM(Sale.totalFunctional)` WHERE `CONFIRMED` |
| Devoluciones | `SUM(SaleReturn.totalFunctional)` WHERE `CONFIRMED` |
| Netas | brutas − devoluciones |
| Tickets | `COUNT(Sale)` |
| Pagos por método | `SalePayment` agrupado por `method` (convertido a funcional en API) |

Integración Flutter: [FRONTEND.md](./FRONTEND.md) §10.

---

## 7. Mantenimiento

- Cambio de tablas/columnas → actualizar **`prisma/schema.prisma`**, migración, y **[DATABASE_SCHEMA_GUIDE.md](./DATABASE_SCHEMA_GUIDE.md)**.
- Resumen operativo breve → este archivo (§5).
