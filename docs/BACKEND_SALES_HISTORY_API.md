# API — Historial general de ventas (implementado)

Contrato alineado con **`GET /api/v1/sales`** en Nest (Quick Market backend).  
La app Flutter (`TicketHistoryScreen`, pestaña **General**) debe usar este listado; el detalle con líneas sigue en **`GET /api/v1/sales/:id`**.

---

## `GET /api/v1/sales`

- **Cabecera:** `X-Store-Id: <uuid>` (tienda con `BusinessSettings`, igual que el resto del POS).
- **Orden:** `createdAt` descendente, desempate `id` descendente (estable para cursor).

### Query

| Parámetro   | Tipo   | Default / reglas |
|------------|--------|-------------------|
| `dateFrom` | string | Opcional. `YYYY-MM-DD`. Interpretado en **zona horaria de la tienda** (`Store.timezone` en Postgres; si es `null`/vacío → **`UTC`**). |
| `dateTo`   | string | Opcional. Misma regla. Inclusive hasta fin de ese día calendario en esa zona. |
| `deviceId` | string | Opcional. Filtra `Sale.deviceId` exacto (trim). |
| `limit`    | int    | Default **50**, máximo **200**. |
| `cursor`   | string | Opcional. Valor opaco de `nextCursor` (paginación keyset). **No** usar con `format=array`. |
| `format`   | string | `object` (default) o `array`. Ver respuesta. |

### Comportamiento si faltan fechas

- **Sin `dateFrom` ni `dateTo`:** últimos **7 días calendario** en la zona de la tienda (hoy inclusive − 6).
- **Solo `dateTo`:** `dateFrom` = `dateTo` − 30 días calendario (ventana máxima **31 días inclusive**).
- **Solo `dateFrom`:** `dateTo` = min(`dateFrom` + 30 días, **hoy** en tienda), siempre dentro del tope de 31 días.

### Límite de rango

- Como mucho **31 días calendario inclusive** entre `dateFrom` y `dateTo` (tras normalizar). Si se excede → **400**.

### Zona horaria (para el front)

- Las query `dateFrom` / `dateTo` son **fechas de calendario locales a la tienda**, no “días UTC”.
- Los campos `createdAt` en JSON son **ISO-8601 en UTC** (instante absoluto).
- La respuesta incluye `meta.timezone` (IANA) y `meta.rangeInterpretation` con texto fijo útil para soporte/UI de depuración.

---

## Respuesta

### `format=object` (default)

```json
{
  "items": [
    {
      "id": "uuid",
      "createdAt": "2026-04-05T14:30:00.000Z",
      "documentCurrencyCode": "VES",
      "totalDocument": "125.50",
      "totalFunctional": "3.42",
      "deviceId": "pos-device-uuid-or-null",
      "status": "CONFIRMED"
    }
  ],
  "nextCursor": "base64url-opaque-or-null",
  "meta": {
    "timezone": "America/Caracas",
    "dateFrom": "2026-04-01",
    "dateTo": "2026-04-07",
    "rangeInterpretation": "...",
    "limit": 50,
    "hasMore": false,
    "deviceIdFilter": "solo-si-vino-deviceId-en-query"
  }
}
```

- **`nextCursor`:** si hay más filas, copiarlo en `cursor` en la siguiente petición (mismos filtros y `limit`).
- **`hasMore`:** `true` si existe página siguiente.
- **`totalDocument` / `totalFunctional`:** pueden ser `null` en datos antiguos; en ventas nuevas suelen venir rellenados.

### `format=array`

- Cuerpo = **solo** el array de ítems (misma forma que cada elemento de `items`).
- **No** enviar `cursor`; no hay `nextCursor` (solo primera página).

---

## Seguridad

- Solo ventas con `sale.storeId === X-Store-Id`.

---

## Enrutado Nest

- Declarado **`GET /sales`** **antes** de **`GET /sales/:id`** para que no se interprete `"…"` como UUID de venta.

---

## Referencia Flutter

- `SalesApi.listSales(...)` → este `GET` con query.
- Pestaña **General:** filtros de fecha + opción “solo este dispositivo” (`deviceId`).
- Copiar este archivo al repo Flutter si queréis documentación local: p. ej. `docs/BACKEND_SALES_HISTORY_API.md`.

Contexto amplio: **`docs/FRONTEND_INTEGRATION_CONTEXT.md`**.
