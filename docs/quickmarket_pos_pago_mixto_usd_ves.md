# Quick Market POS - Pago mixto USD/VES (documento operativo)

## 1) Objetivo

Definir la implementación de cobro mixto (USD + VES) para POS, alineada con el backend actual (multi-moneda + offline), y dejar claro qué parte ya existe y qué parte requiere cambios de API.

## 2) Estado actual del backend

Ya implementado:

- `POST /api/v1/sales` con `documentCurrencyCode`, `lines`, `fxSnapshot` y **`payments` opcional**.
- Persistencia de importes documento/funcional y movimientos de inventario.
- Persistencia de líneas de pago por venta en `SalePayment`.
- `GET /api/v1/sales/:id` retorna la venta con `saleLines` y `payments`.
- Offline por `sync/push` (`opType: SALE`) con idempotencia por `opId`, incluyendo `payments` en `payload.sale`.

## 3) Diseño funcional UX (tipo Odoo/Square)

En pantalla de cobro:

- Totales visibles:
  - `Total USD` (referencia),
  - `Total VES` (moneda de documento).
- Inputs:
  - `Pago USD`,
  - `Pago VES` (opcional).
- Resultado en tiempo real:
  - `Equivale en VES` para pago USD,
  - `Resta por cobrar`,
  - `Vuelto` (si aplica).
- Regla clave:
  - toda conversión usa **la misma tasa del `fxSnapshot` del ticket**, nunca una tasa nueva al cobrar.

## 4) Fórmulas front (decimal string)

- `pagoUsdEnVes = pagoUsd * fxRate`.
- `pagoTotalVes = pagoUsdEnVes + pagoVes`.
- `restoVes = totalDocumentVes - pagoTotalVes`.

Comportamiento:

- `restoVes > 0` -> no permitir cobrar.
- `restoVes <= 0` -> permitir cobrar y mostrar vuelto si excede.

## 5) Contrato backend vigente (`payments`)

Extender `POST /api/v1/sales` con campo opcional:

```ts
type SalePaymentInput = {
  method: 'CASH_USD' | 'CASH_VES' | 'CARD' | string;
  amount: string;
  currencyCode: string;
  fxSnapshot?: {
    baseCurrencyCode: string;
    quoteCurrencyCode: string;
    rateQuotePerBase: string;
    effectiveDate: string;
    fxSource?: string;
  };
};
```

En request de venta:

```json
{
  "documentCurrencyCode": "VES",
  "lines": [
    { "productId": "prod-uuid-1", "quantity": "2", "price": "91.25", "discount": "0" }
  ],
  "fxSnapshot": {
    "baseCurrencyCode": "USD",
    "quoteCurrencyCode": "VES",
    "rateQuotePerBase": "41.00",
    "effectiveDate": "2026-04-08"
  },
  "payments": [
    {
      "method": "CASH_USD",
      "amount": "12.00",
      "currencyCode": "USD",
      "fxSnapshot": {
        "baseCurrencyCode": "USD",
        "quoteCurrencyCode": "VES",
        "rateQuotePerBase": "41.00",
        "effectiveDate": "2026-04-08"
      }
    },
    {
      "method": "CASH_VES",
      "amount": "20.50",
      "currencyCode": "VES"
    }
  ]
}
```

## 6) Reglas backend recomendadas para `payments`

- `payments` opcional (retrocompatible).
- Si llega `payments`:
  - convertir cada pago a `documentCurrencyCode`,
  - validar suma ~= `totalDocument` con tolerancia de redondeo.
- Si `currencyCode != documentCurrencyCode`, exigir `fxSnapshot` de pago o usar fallback de cabecera si coincide el par.
- Venta/inventario siguen exactamente igual.
- Persistir pagos en nueva tabla `SalePayment` para reportes.
- Errores normalizados de validación:
  - `PAYMENTS_INVALID_AMOUNT`
  - `PAYMENTS_MISSING_FX_SNAPSHOT`
  - `PAYMENTS_FX_PAIR_MISMATCH`
  - `PAYMENTS_TOTAL_MISMATCH`

La validación de total usa tolerancia:

- `abs(sumPaymentsDocument - totalDocument) <= 0.01`

Campos sugeridos en `SalePayment`:

- `saleId`
- `method`
- `amount`
- `currencyCode`
- `amountDocumentCurrency`
- `fxBaseCurrencyCode?`
- `fxQuoteCurrencyCode?`
- `fxRateQuotePerBase?`
- `fxEffectiveDate?`

## 7) Offline/sync para pago mixto

- En `sync/push`, incluir `payments` dentro de `payload.sale`.
- Reintentos con mismo `opId` + mismo payload.
- Si ya fue aplicada la op -> `skipped`, sin duplicar venta ni stock.

## 8) Checklist frontend (implementación)

- [ ] Agregar bloque de cobro mixto en UI de ticket.
- [ ] Usar decimal seguro (no float nativo para dinero).
- [ ] Bloquear cobro cuando falte saldo.
- [ ] Construir `payments` al confirmar.
- [ ] En offline, guardar op `SALE` con `payments` en cola local.
- [ ] Mostrar estado de sync por ticket (pendiente/sincronizado/error).
- [ ] Pruebas con red inestable y reintentos.

## 9) Checklist backend (estado)

- [x] Extender DTO `CreateSaleDto` con `payments?`.
- [x] Agregar validaciones de suma por moneda documento.
- [x] Crear modelo y migración `SalePayment`.
- [x] Persistir pagos en misma transacción de venta.
- [x] Soportar `payments` en `sync/push` op `SALE`.
- [x] Agregar tests de integración (REST + sync).
- [ ] Actualizar colección Postman con ejemplos `payments`.

## 10) Decisión operativa

El backend ya está en la etapa full para pago mixto.  
La siguiente tarea principal es frontend:

1. UI de cobro mixto + validación local de saldo.
2. Enviar `payments` tanto en `POST /sales` online como en `sync/push` offline.
3. Completar Postman/QA end-to-end con casos de mezcla USD+VES.

## 11) Resumen opcional en respuesta de venta (ya disponible)

En create/detail de venta se agregan campos de apoyo para front:

- `paymentsCount`
- `paidDocumentTotal`
- `changeDocument`
