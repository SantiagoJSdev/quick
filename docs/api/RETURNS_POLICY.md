# Política de devoluciones de venta (M6)

## Alcance MVP

- Solo **devolución de mercancía** sobre una **`Sale` con `status = CONFIRMED`**.
- Documento **`SaleReturn`** con líneas referenciando **`SaleLine.id`** de la venta original.
- **FX**: política fija **`INHERIT_ORIGINAL_SALE`** — se copian en cabecera los campos `fx*`, `exchangeRateDate` y monedas de la venta original (no se envía snapshot nuevo en REST/sync).
- **Importe comercial** (lo que se “devuelve” al cliente en documento/funcional): **proporcional** al total de cada línea original (`lineTotalDocument` / `lineTotalFunctional` × cantidad devuelta / cantidad vendida). Si faltan totales persistidos, se calcula como `qty × price − discount` en documento.
- **Inventario (`IN_RETURN`)**: el valor funcional reingresado es el **COGS** de la salida original, como **promedio ponderado** de todos los movimientos **`OUT_SALE`** de esa venta y ese **mismo `productId`** (caso varias líneas con el mismo producto).
- **Parciales**: se permiten varias devoluciones por la misma línea mientras la suma de cantidades devueltas no supere la cantidad vendida en esa `SaleLine`.

## API

- `POST /api/v1/sale-returns` — cuerpo: `originalSaleId`, `lines[]` con `saleLineId`, `quantity` (string decimal), opcional `id` (idempotencia), opcional `opId` (sync).
- `GET /api/v1/sale-returns/:id`
- `sync/push` — `opType: SALE_RETURN`, `payload.saleReturn` con `storeId`, `originalSaleId`, `lines`, opcional `id`.

## Futuro (no implementado)

- Política alternativa **tasa del día** en la devolución (nuevo snapshot y validación).
- Devolución de compra a proveedor (`OUT_*` distinto).
- Notas de crédito / integración contable.

## Referencia código

- `src/modules/sale-returns/`
- `src/modules/inventory/inventory.service.ts` — `applyInSaleReturnLineTx`
