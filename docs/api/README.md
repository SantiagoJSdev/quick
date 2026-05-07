# Contratos HTTP (referencia)

| Documento | Contenido |
|-----------|-----------|
| [OPS_METRICS.md](./OPS_METRICS.md) | `GET /api/v1/ops/metrics` — auth, query `storeId`, forma de respuesta, `sync.failedSamples`, relación con logs del scheduler. |
| [PURCHASES.md](./PURCHASES.md) | `POST/GET /purchases`, `sync/push` `PURCHASE_RECEIVE`, campo `supplierInvoiceReference`. |
| [SYNC_PUSH_SALE.md](./SYNC_PUSH_SALE.md) | `sync/push` `SALE`: strings en líneas/pagos, ops `failed` y `opId`. |
| [SYNC_PUSH_SUPPLIERS.md](./SYNC_PUSH_SUPPLIERS.md) | `sync/push` `SUPPLIER_*`: payloads JSON, `acked.supplier`, provisional + `PURCHASE_RECEIVE`, `sync/pull` `SUPPLIER_CREATED`… |

Índice general del repo: **`docs/MASTER_CONTEXT.md`**.
