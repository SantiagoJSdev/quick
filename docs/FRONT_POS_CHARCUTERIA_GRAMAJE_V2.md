# Front POS - Charcutería por gramaje (V2)

Documento operativo para frontend, alineado con backend actual.

## 1) Objetivo

Implementar en POS el modal **"Agregar por peso"** para productos de charcutería, con 3 formas de entrada:

1. gramos,
2. monto en bolívares,
3. monto en dólares.

Y cerrar el flujo hasta ticket impreso + venta persistida (online/offline).

## 2) Qué ya está implementado en backend

- `Product.unit` existe (string) y puede usarse con valor `KG`.
- `POST /api/v1/sales` ya permite líneas con `quantity` decimal string.
- `sync/push` `SALE` ya operativo con idempotencia por `opId`.
- Multi-moneda por `fxSnapshot` en venta.
- Cobro mixto en venta (`payments`) ya implementado.

## 3) Qué NO requiere cambio backend para este flujo

Para MVP de gramaje:

- **No hace falta endpoint nuevo**.
- **No hace falta cambiar contrato de `POST /sales`**.

Regla:

- Para productos por peso, enviar `quantity` en **kg** (ej: 350 g -> `"0.35"`).
- `price` en la línea = precio por kg en moneda documento del ticket.

## 4) Reglas de negocio frontend (obligatorias)

- Usar siempre decimal seguro (no float nativo para dinero crítico).
- Toda conversión monetaria del ticket usa el **`fxSnapshot` del ticket**, nunca tasa "nueva".
- Para charcutería, `+` en producto abre modal de peso en vez de sumar 1 unidad.

## 5) Diseño de UI - Modal "Agregar por peso"

## 5.1 Header del modal

- Nombre producto.
- Precio por kg en USD.
- Equivalente por kg en VES (según `fxSnapshot` actual).
- Tasa visible: `1 USD = X VES`.

## 5.2 Entradas del modal (3 modos)

### Modo A: Ingresar gramos

- Campo: `Peso (g)`.
- Cálculo:
  - `kg = gramos / 1000`
  - `importeUSD = kg * priceUsdPerKg`
  - `importeVES = importeUSD * fxRate`

### Modo B: Ingresar monto en bolívares

- Campo: `Monto VES`.
- Cálculo:
  - `importeVES = montoVES`
  - `importeUSD = importeVES / fxRate`
  - `kg = importeUSD / priceUsdPerKg`
  - `gramos = kg * 1000`

### Modo C: Ingresar monto en dólares (**nuevo requerido**)

- Campo: `Monto USD`.
- Cálculo:
  - `importeUSD = montoUSD`
  - `importeVES = importeUSD * fxRate`
  - `kg = importeUSD / priceUsdPerKg`
  - `gramos = kg * 1000`

## 5.3 Validaciones del modal

- gramos > 0, monto VES > 0, monto USD > 0 según modo activo.
- si `priceUsdPerKg <= 0` bloquear confirmación.
- mostrar redondeo visual (ej. 2-3 decimales), pero preservar precisión interna.

## 5.4 Confirmación

Al confirmar:

- agregar/actualizar línea del ticket con:
  - `productId`
  - `quantity` en kg (string decimal)
  - `price` por kg en moneda documento
  - `discount` opcional
- guardar metadatos UI locales para render:
  - `displayGrams`
  - `pricePerKgUsd`
  - `lineAmountUsd`
  - `lineAmountVes`

## 6) Ticket visual e impresión (POS)

Para línea de charcutería en ticket (pantalla e impresión):

- Nombre producto.
- Cantidad en gramos visible para usuario (ej. `350 g`).
- Referencia precio por kg (ej. `$8.00/kg`).
- Importe de línea en moneda documento.
- Referencia secundaria USD/VES (según configuración de impresión).

Formato sugerido:

- `Queso blanco duro`
- `350 g  x  $8.00/kg`
- `Bs 102.20  (ref $2.80)`

## 7) Mapeo al payload de venta

Ejemplo de línea resultante para backend:

```json
{
  "productId": "<uuid>",
  "quantity": "0.35",
  "price": "292.00",
  "discount": "0"
}
```

Donde `price` está en moneda documento (si documento es VES) y representa precio por kg.

## 8) Cobro mixto junto con gramaje

Si además usan cobro mixto:

- armar `payments` como en `docs/quickmarket_pos_pago_mixto_usd_ves.md`.
- esto es independiente de cómo se calculó la línea por gramaje.

## 9) Offline

Online:

- enviar `POST /api/v1/sales`.

Offline:

- guardar op `SALE` en cola local con:
  - mismas líneas (quantity en kg),
  - mismo `fxSnapshot`,
  - `payments` si hubo cobro mixto.
- al reconectar, `sync/push`.

## 10) Checklist de implementación frontend

- [ ] Detectar productos por peso (`unit == KG`) y abrir modal especial.
- [ ] Implementar 3 modos de entrada (g, VES, USD).
- [ ] Mostrar cálculos en tiempo real (kg, g, USD, VES).
- [ ] Persistir línea con `quantity` en kg.
- [ ] Soportar editar línea reabriendo modal.
- [ ] Reflejar datos correctos en ticket visual e impresión.
- [ ] Validar flujo online y offline.
- [ ] Validar integración con cobro mixto.

## 11) Nota de compatibilidad backend (importante)

Backend actual no tiene enum `DELI` en `Product.type` (hoy usa tipos base).
Para no bloquear:

- usar `unit = KG` como criterio funcional de "producto por peso" en frontend.
- opcionalmente usar categoría/nombre para reforzar UX.

