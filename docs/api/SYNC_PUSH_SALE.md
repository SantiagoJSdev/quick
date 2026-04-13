# `sync/push` — `opType: SALE` (offline POS)

El cliente debe enviar **`X-Store-Id`** igual a **`payload.sale.storeId`**.

## Forma del body (batch)

```json
{
  "deviceId": "uuid-dispositivo",
  "ops": [
    {
      "opId": "uuid-v4-único-por-operación",
      "opType": "SALE",
      "timestamp": "2026-04-13T18:00:00.000Z",
      "payload": {
        "sale": { }
      }
    }
  ]
}
```

## Reglas críticas (errores frecuentes en Flutter/Dart)

1. **`sale.lines[].quantity` y `sale.lines[].price` deben ser strings en JSON**  
   Ejemplo válido: `"quantity": "2"`, `"price": "15.50"`.  
   Si el JSON lleva números (`2`, `15.5`), el backend rechaza la op con **`validation_error`** y un mensaje que indica `got number`.  
   En Dart: serializar con strings explícitos (`toString()` / formateo decimal), no mandar `double`/`int` directo en el mapa que va a `jsonEncode`.

2. **`sale.lines[].productId`**: string UUID.

3. **`payload.sale`**: objeto obligatorio; **`lines`**: array con al menos un elemento.

4. **`payments`** (opcional): cada ítem necesita `method`, `amount`, `currencyCode` como **strings**. Si un pago incluye **`fxSnapshot`**, deben ir **todos** los campos obligatorios del snapshot como strings (`baseCurrencyCode`, `quoteCurrencyCode`, `rateQuotePerBase`, `effectiveDate`); un objeto incompleto aquí hace fallar el parseo de toda la venta.

5. **`fxSnapshot` / `fx` en `sale`** (opcional): si se envía objeto completo (cuatro campos string obligatorios), se usa; si el objeto está incompleto, se **ignora** y el servidor resuelve FX por configuración.

## Ops atascadas en `failed`

Si una `opId` ya quedó registrada como **`failed`**, el servidor **no la vuelve a aplicar** con el mismo `opId`. Hay que **corregir el payload** y generar un **`opId` nuevo**, o intervenir la tabla `SyncOperation` solo en entornos controlados.

## Diagnóstico

- Respuesta de **`POST /sync/push`**: array **`failed[].details`** con el motivo concreto.  
- **`GET /api/v1/ops/metrics`** → **`sync.failedSamples[].failureDetails`** (tras migraciones recientes en el servidor).
