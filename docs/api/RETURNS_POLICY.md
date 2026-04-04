# Política de devoluciones de venta (M6)

## Alcance MVP

- Solo **devolución de mercancía** sobre una **`Sale` con `status = CONFIRMED`**.
- Documento **`SaleReturn`** con líneas referenciando **`SaleLine.id`** de la venta original.
- **FX comercial (cabecera y líneas en moneda funcional)** — dos políticas:
  - **`INHERIT_ORIGINAL_SALE`** (defecto): se copian en cabecera los campos `fx*`, `exchangeRateDate` y monedas de la venta original; los importes funcionales comerciales de cada línea son **proporcionales** al total funcional original de la línea (misma paridad histórica que la venta).
  - **`SPOT_ON_RETURN`**: el importe en **moneda documento** sigue siendo proporcional al vendido; el **funcional comercial** se recalcula con la **tasa vigente** al devolver (`StoreFxSnapshotService.resolveFxSnapshot`: misma regla que ventas, pares múltiples en `ExchangeRate`, validación ±0,5% o `POS_OFFLINE`). La cabecera de la devolución guarda el **nuevo** snapshot FX. Opcional en REST/sync: `fxSnapshot` (misma forma que ventas).
- **Inventario (`IN_RETURN`)**: el valor funcional reingresado es el **COGS** de la salida original, como **promedio ponderado** de todos los movimientos **`OUT_SALE`** de esa venta y ese **mismo `productId`** — **no cambia** con `SPOT_ON_RETURN` (sigue siendo costo histórico de la salida).
- **Importe comercial en documento**: proporcional al total de cada línea original (`lineTotalDocument` × cantidad devuelta / cantidad vendida). Si faltan totales persistidos, se calcula como `qty × price − discount` en documento.
- **Parciales**: se permiten varias devoluciones por la misma línea mientras la suma de cantidades devueltas no supere la cantidad vendida en esa `SaleLine`.

## Redondeo

Cálculos en `Prisma.Decimal`; sin redondeo comercial en servicio. Ver comentario en `src/common/fx/convert-amount.ts` y cabecera de `sale-returns.service.ts`.

## API

- `POST /api/v1/sale-returns` — cuerpo: `originalSaleId`, `lines[]` con `saleLineId`, `quantity` (string decimal), opcional `id` (idempotencia), opcional `opId` (sync), opcional `fxPolicy` (`INHERIT_ORIGINAL_SALE` | `SPOT_ON_RETURN`), opcional `fxSnapshot` (si `SPOT_ON_RETURN`).
- `GET /api/v1/sale-returns/:id`
- `sync/push` — `opType: SALE_RETURN`, `payload.saleReturn` con `storeId`, `originalSaleId`, `lines`, opcional `id`, opcional `fxPolicy`, opcional `fxSnapshot` (alias `fx`).

## Futuro (no implementado)

- Devolución de compra a proveedor (`OUT_*` distinto).
- Notas de crédito / integración contable.

## Referencia código

- `src/modules/sale-returns/`
- `src/modules/inventory/inventory.service.ts` — `applyInSaleReturnLineTx`
