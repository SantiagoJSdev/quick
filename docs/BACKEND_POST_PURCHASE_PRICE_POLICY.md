# Política MVP: precio de lista tras compra (M7-P6)

Documenta el comportamiento **real** del backend y qué debe hacer el **front** para sugerir o aplicar un nuevo precio después de **`POST /api/v1/purchases`** (movimientos `IN_PURCHASE`).

## 1) Qué hace el servidor hoy al confirmar una compra

- Actualiza **existencias y costo valorizado** de la tienda: `InventoryItem.quantity`, `averageUnitCostFunctional`, `totalCostFunctional` (promedio ponderado en **moneda funcional**, igual que otras entradas).
- **No** modifica **`Product.price`** ni **`Product.cost`** en el catálogo. Es intencional en este MVP: el precio de venta y el “costo de ficha” siguen siendo responsabilidad explícita del usuario o de una **`PATCH /api/v1/products/:id`**.

## 2) Reglas por `pricingMode` (sin cambios silenciosos)

| `pricingMode` | ¿El servidor cambia `price` tras compra? | Uso de sugerencias |
|---------------|----------------------------------------|--------------------|
| `USE_STORE_DEFAULT` | **No** | El front puede mostrar una sugerencia usando margen de tienda + costo base elegido (ver §3). |
| `USE_PRODUCT_OVERRIDE` | **No** | Igual, con margen del override. |
| `MANUAL_PRICE` | **No** | El listado es manual; **nunca** se debe asumir que una compra actualizará `price` en backend. |

Cualquier cambio de **`price`** (o de **`cost`** en catálogo) debe ser **explícito**: normalmente **`PATCH /products/:id`** desde la app o un flujo admin.

## 3) De dónde sale el “costo” para la sugerencia en pantalla

Hay **dos** nociones distintas:

1. **`InventoryItem.averageUnitCostFunctional`** — costo medio **después** de compras y ajustes, en moneda funcional. Es la referencia contable/valorización de **esa tienda**.  
   - Obtener: **`GET /api/v1/inventory/:productId`** (cabecera `X-Store-Id`).

2. **`Product.cost`** (y **`Product.price`**) — campos del **catálogo**. Los derivados **`suggestedPrice`**, **`effectiveMarginPercent`**, **`marginComputedPercent`** en **`GET /api/v1/products`** / **`GET .../:id`** se calculan respecto a **`Product.cost`** y **`Product.price`**, **no** respecto al promedio de inventario.

Por tanto, **tras una compra**, si la UI quiere una sugerencia alineada al **nuevo costo real**:

- **Opción A (recomendada en MVP):** leer **`averageUnitCostFunctional`** del inventario y aplicar en cliente la misma regla de margen que el backend (`defaultMarginPercent` / override / manual), **o**
- **Opción B:** copiar el promedio a **`Product.cost`** con **`PATCH /products/:id`** y luego usar la respuesta de **`GET /products/:id`** (los derivados del API coincidirán con ese costo de ficha).

## 4) Resumen para integración Flutter / POS

1. Tras **`POST /purchases`**, el precio de venta del catálogo **no cambia** solo.
2. Para “¿actualizamos precio?”: mostrar sugerencia **informativa**; en **`MANUAL_PRICE`** el usuario decide si pega la sugerencia o no.
3. Para basar la sugerencia en el costo **post-compra**, usar **`GET /inventory/:productId`** o actualizar **`Product.cost`** y reconsultar producto.
4. Aplicar nuevo precio: **`PATCH /products/:id`** con **`price`** (y opcionalmente **`cost`**) en string decimal.

## 5) Evolución futura (no implementado)

- Incluir en la respuesta de compra **hints** por línea (`suggestedListPrice`, `pricingMode`, etc.), o
- Job que sincronice **`Product.cost`** con el promedio de inventario bajo reglas de negocio explícitas.

Hasta entonces, este documento + **`docs/FRONTEND_INTEGRATION_CONTEXT.md`** (compras y productos) son el contrato.
