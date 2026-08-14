# Factura de proveedor, control de deuda e inventario — solicitud de implementación Front (+ gaps Backend)

## 1. Problema de negocio (enunciado)

El minimarket ya tiene **catálogo**, **stock** y **proveedores**. Falta el flujo operativo de:

1. **Cargar una factura completa** de un proveedor desde la UI (artículo por artículo: cantidad + costo).
2. Indicar si esa mercancía quedó **pagada (contado)** o **a crédito**.
3. Llevar **control de deuda** (cuánto se debe por factura / por proveedor).
4. Con esos datos (y SQL/reportes) poder responder:
   - ¿Cuánto debo?
   - ¿Cuánto tengo en inventario (valorizado a costo)?
   - ¿Cuánto gané (ventas − costo − devoluciones)?
   - ¿Se mantiene el **capital de trabajo** y solo se “saca” la ganancia?

Esto conecta con la proyección de caja diaria (`PROYECCION_PEDIDOS_POR_PROVEEDOR_Y_DISTRIBUCION_DIARIA_DE_CAJA.md`): el bolsillo “abono a facturas” solo tiene sentido si existen facturas con saldo.

---

## 2. Qué ya existe en Backend (usable hoy)

### 2.1 Schema

| Modelo | Qué cubre | Estado |
|---|---|---|
| `Supplier` | Proveedor por tienda (CRUD) | OK |
| `Product` + `InventoryItem` | Catálogo + stock por tienda | OK |
| `Purchase` | Compra/factura + **`paymentStatus` / `amountPaidFunctional` / `amountDueFunctional` / `dueDate` / `paidAt`** | **Listo (F2)** |
| `PurchaseLine` | Líneas qty + unitCost | OK |
| `PurchasePayment` | Abonos a factura | **Listo (F2)** |
| `StockMovement` `IN_PURCHASE` | Sube stock al crear | OK |

### 2.2 Endpoints / sync

| Capacidad | Endpoint / op | Estado |
|---|---|---|
| Crear compra + stock + pago | `POST /api/v1/purchases` (`paymentStatus`, `dueDate`, …) | **Listo** |
| Listar compras | `GET /api/v1/purchases?supplierId=&paymentStatus=OPEN` | **Listo** |
| Deuda por proveedor | `GET /api/v1/purchases/payables` | **Listo** |
| Ver una compra | `GET /api/v1/purchases/:id` (+ `payments`) | **Listo** |
| Registrar abono | `POST /api/v1/purchases/:id/payments` | **Listo** |
| Sync offline compra | `sync/push` → `PURCHASE_RECEIVE` (incluye pago) | **Listo** |
| Listar proveedores | `GET /api/v1/suppliers` | **Listo** |

Contrato: [api/PURCHASES.md](./api/PURCHASES.md).

### 2.3 Body F1+F2 (Front debe usar esto)

```json
{
  "supplierId": "<uuid>",
  "supplierInvoiceReference": "FAC-0042",
  "documentCurrencyCode": "VES",
  "paymentStatus": "CREDIT",
  "dueDate": "2026-08-20",
  "lines": [
    { "productId": "<uuid>", "quantity": "10", "unitCost": "5.00" }
  ]
}
```

- Contado: `"paymentStatus": "PAID"`.
- Crédito: `"paymentStatus": "CREDIT"` (saldo = total funcional).
- Abono inicial: `"paymentStatus": "PARTIAL"`, `"initialAmountPaidFunctional": "50.00"`.
- Si omiten `paymentStatus` → default **`PAID`** (compat).

---

## 3. Backend F2 — ya implementado

Los gaps de §2 anterior (pago/deuda) **ya están en el backend**. Front puede pedir F1+F2 juntos.

Migración: `prisma/migrations/20260806120000_purchase_payment_debt`.

### 3.1 Crear con pago

Ver §2.3. Reglas:

- `PAID` → pagado = total, due = 0, crea abono inicial.
- `CREDIT` → pagado = 0, due = total.
- `PARTIAL` + `initialAmountPaidFunctional` → due = total − abono.

### 3.2 Abonos

`POST /purchases/:id/payments` con `amountFunctional`, `method`, `opId` opcional.

### 3.3 Listados

- `GET /purchases?paymentStatus=OPEN`
- `GET /purchases/payables`

---

## 4. Ecuación de capital (cómo “sacar solo la ganancia”)

Idea de control (moneda funcional, ej. USD):

```text
Activos operativos ≈
  valor_inventario_a_costo
  + efectivo_en_caja
  + (otros activos menores)

Pasivos operativos ≈
  deuda_proveedores (facturas CREDIT/PARTIAL con saldo)

Capital_de_trabajo ≈ Activos − Pasivos

Ganancia_periodo ≈ ventas_netas − costo_mercancía_vendida (− merma/insumos si se estiman)

Regla operativa:
  Lo que se puede “sacar” del negocio ≈ ganancia_neta_acumulada
  (no el efectivo bruto del día, que incluye dinero para reponer stock y abonar facturas)
```

Eso alinea con el split diario: ganancia vs reposición contado vs abono crédito.

---

## 5. SQL de control

### 5.1 Inventario valorizado a costo (ya posible)

```sql
SELECT
  ROUND(SUM(i.quantity * COALESCE(NULLIF(i."averageUnitCostFunctional", 0), p.cost))::numeric, 2)
    AS valor_inventario_funcional
FROM "InventoryItem" i
JOIN "Product" p ON p.id = i."productId"
WHERE i."storeId" = '0b54c944-28ba-4542-991a-4840c4801906'
  AND p.active = true;
```

### 5.2 Compras del período

```sql
SELECT
  s.name AS proveedor,
  pu."supplierInvoiceReference",
  pu."paymentStatus",
  ROUND(COALESCE(pu."totalFunctional", pu.total)::numeric, 2) AS total_funcional,
  ROUND(pu."amountDueFunctional"::numeric, 2) AS saldo
FROM "Purchase" pu
JOIN "Supplier" s ON s.id = pu."supplierId"
WHERE pu."storeId" = '0b54c944-28ba-4542-991a-4840c4801906'
ORDER BY pu."createdAt" DESC;
```

### 5.3 Deuda (API o SQL)

```sql
SELECT
  s.name AS proveedor,
  SUM(pu."amountDueFunctional") AS deuda
FROM "Purchase" pu
JOIN "Supplier" s ON s.id = pu."supplierId"
WHERE pu."storeId" = '0b54c944-28ba-4542-991a-4840c4801906'
  AND pu."paymentStatus" IN ('CREDIT', 'PARTIAL')
  AND pu."amountDueFunctional" > 0
GROUP BY s.name
ORDER BY deuda DESC;
```

O vía API: `GET /purchases/payables`.

---

## 6. Solicitud al Front — implementación (Backend listo)

Implementar **factura + contado/crédito + deuda** con los endpoints de [api/PURCHASES.md](./api/PURCHASES.md).

### 6.1 Nueva factura / recepción

1. Proveedor (`GET /suppliers`).
2. Nº factura → `supplierInvoiceReference`.
3. **Contado (`PAID`) / Crédito (`CREDIT`)** — obligatorio en UI; enviarlo en el body.
4. Si crédito: opcional `dueDate` (`YYYY-MM-DD`).
5. Grid: producto, qty, unitCost; total abajo.
6. Confirmar → `POST /purchases` o sync `PURCHASE_RECEIVE`.
7. Refrescar stock.

### 6.2 Deuda y abonos

| Pantalla | API |
|---|---|
| Listado facturas | `GET /purchases?paymentStatus=OPEN` |
| Detalle + abonos | `GET /purchases/:id` |
| Registrar abono | `POST /purchases/:id/payments` |
| Resumen por proveedor | `GET /purchases/payables` |

### 6.3 Contratos

- Header `X-Store-Id`.
- Montos **string**.
- `supplierInvoiceReference` (no `reference` en REST).
- 1–100 líneas.
- No meter productos `SERVICE` en factura de mercancía.
- Offline compra: `id` + `opId`; abonos: `opId` en payments.

### 6.4 Criterios de aceptación

- [ ] Factura N líneas → stock sube.
- [ ] Contado → no aparece en payables.
- [ ] Crédito → payables con saldo = total.
- [ ] Abono reduce saldo; al completar → PAID.
- [ ] Totales UI = `totalFunctional` / `amountDueFunctional`.
- [ ] Offline sin duplicar compra.

---

## 7. Pedidos explícitos al Front

1. Pantalla **Nueva factura** con toggle Contado/Crédito real (API ya lo guarda).
2. Pantallas **listado / detalle / abono / payables**.
3. Sync `PURCHASE_RECEIVE` incluyendo `paymentStatus`.
4. Leer contrato completo: [api/PURCHASES.md](./api/PURCHASES.md).

Backend F2 **ya está**; no esperar más campos para esta feature.

---

## 8. Resumen ejecutivo

| Pregunta | Respuesta |
|---|---|
| ¿Factura artículo a artículo? | **Sí** — API lista; falta UI |
| ¿Contado vs crédito y deuda? | **Sí** — backend listo; falta UI |
| ¿Inventario y ganancia SQL? | **Sí** |
| ¿Cuánto debo? | `GET /purchases/payables` o SQL §5.3 |
| ¿Sacar solo la ganancia? | Capital = inventario + caja − deuda; sacar ≈ ganancia neta |

**Orden:** migrar DB → deploy backend → entregar este doc + `PURCHASES.md` al front.
