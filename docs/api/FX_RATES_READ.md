# Mongo read model: `fx_rates_read`

Proyeccion para **consulta rapida** y referencia offline (si el cliente replica Mongo o sincroniza documentos).

## Origen

- Cada alta de tasa en PostgreSQL (`POST /api/v1/exchange-rates` con outbox) genera `OutboxEvent` `EXCHANGE_RATE_UPSERTED`.
- El worker hace **upsert** en la coleccion `fx_rates_read`.

## Clave `_id`

Formato: `{storeId}_{baseCurrencyCode}_{quoteCurrencyCode}`

Ejemplo: `a1b2c3d4-...-USD_VES`

## Documento (campos principales)

| Campo | Descripcion |
|-------|-------------|
| `storeId` | UUID tienda |
| `baseCurrencyCode` / `quoteCurrencyCode` | ISO |
| `rateQuotePerBase` | string decimal — **1 base = rate quote** |
| `effectiveDate` | fecha efectiva (YYYY-MM-DD) |
| `postgresExchangeRateId` | id fila en Postgres |
| `convention` | texto legible |
| `sync` | `lastEventId`, `lastEventType`, `lastProjectedAt` |

## Nota operativa

- El documento representa la **ultima proyeccion** para ese par en esa tienda (ultimo evento aplicado). Para historico completo usar PostgreSQL `ExchangeRate`.
