# Onboarding de tienda desde el POS / front

Permite que la app móvil **genere un UUID de tienda** en el cliente y registre la sucursal + `BusinessSettings` sin flujo admin previo.

## Endpoints

### `PUT /api/v1/stores/:storeId`

**Cabecera obligatoria:** `X-Store-Id` debe ser **exactamente igual** a `:storeId` (UUID v4 recomendado en el móvil).

**Body (JSON):**

```json
{
  "name": "Mi tienda",
  "type": "main"
}
```

- `name`: string no vacío (trim).
- `type`: `"main"` | `"branch"`.

**Efecto:** `upsert` en `Store` con `id = :storeId`. Si ya existía, actualiza `name` y `type`.

**Guard global:** estas rutas **no** pasan por `StoreConfiguredGuard` (la tienda aún puede no tener `BusinessSettings`).

**Activación:** solo si en el servidor está `STORE_ONBOARDING_ENABLED=1` en `.env`. Si no, **403** `Store onboarding API is disabled`.

---

### `PUT /api/v1/stores/:storeId/business-settings`

**Cabecera:** igual, `X-Store-Id` = `:storeId`.

**Body (JSON):**

```json
{
  "functionalCurrencyCode": "USD",
  "defaultSaleDocCurrencyCode": "VES"
}
```

Códigos deben existir en la tabla `Currency` (ej. seed USD/VES/EUR).

**Efecto:** crea o actualiza `BusinessSettings` para esa tienda. Responde con el **mismo shape** que `GET .../business-settings` (incluye relaciones `functionalCurrency`, `defaultSaleDocCurrency`, `store`).

**Precondición:** debe existir un `Store` con ese `id` (antes `PUT /stores/:storeId`). Si no, **404**.

---

### Flujo recomendado en la app

1. Generar `storeId = Uuid().v4()` y guardarlo en preferencias.
2. `PUT /api/v1/stores/{storeId}` con `X-Store-Id: {storeId}` + `{ name, type }`.
3. `PUT /api/v1/stores/{storeId}/business-settings` con los códigos de moneda.
4. (Opcional) `POST /api/v1/exchange-rates` para primera tasa — ya documentado en API.
5. Verificar con `GET /api/v1/stores/{storeId}/business-settings` (ahí **sí** aplica `StoreConfiguredGuard`: tienda + settings deben existir).

---

## Seguridad

| Riesgo | Mitigación actual |
|--------|-------------------|
| Cualquiera en LAN crea tiendas | Endpoint **desactivado** por defecto; activar solo con `STORE_ONBOARDING_ENABLED=1`. |
| Producción | Dejar flag en `0`; crear tiendas vía admin/seed; o sustituir por API key / JWT en una iteración futura. |

Opciones futuras (no implementadas aquí): API key dedicada, rol admin, rate limit por IP, ventana temporal solo en primer arranque.

---

## Qué compartir con el equipo mobile (modelos)

**Recomendación:** **no** enviar el `schema.prisma` completo como contrato de UI.

1. **Swagger** (`/api/docs`) — DTOs y respuestas oficiales.
2. **`FRONTEND_INTEGRATION_CONTEXT.md`** + **§13** (ejemplos JSON).
3. **Este archivo** — flujo onboarding.

Si hace falta tipado Dart: generar modelos a partir de **respuestas reales** o de los ejemplos JSON de `GET business-settings`, no de todas las tablas Prisma (evita acoplar el front a columnas internas que no expone la API).
