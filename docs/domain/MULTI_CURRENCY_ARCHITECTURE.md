# Arquitectura multi-moneda (Venezuela) — Mini market / ERP simplificado

Documento de diseno alineado con: PostgreSQL fuente maestra, proyecciones de lectura (Mongo), sincronizacion offline con `opId` e idempotencia.

## 1) Objetivos y principios

1. **Moneda funcional** del negocio: configurable por **sucursal** (`Store`) via `BusinessSettings.functionalCurrencyId` (ej. `USD`).
2. **Compras y ventas** pueden registrarse en **cualquier moneda catalogada** (`Currency`) para la que exista par en `ExchangeRate` respecto a la funcional: típicamente **USD / VES / EUR**, etc.
3. Cada documento **confirmado** guarda **snapshot** de la tasa usada: `exchangeRateDate` + parametros de paridad (no se recalcula al cambiar la tasa del maestro).
4. Cada linea y el encabezado guardan importes en **dos dimensiones**: moneda del documento y moneda funcional.
5. **Inventario valorizado** solo en moneda funcional (costo medio y valor total en funcional).
6. **No reinterpretar** documentos historicos cuando cambia la tasa diaria.
7. **POS offline**: la tasa usada **viaja en el payload** de la operacion; el servidor **valida** y **persiste** el snapshot; no sustituye por la tasa “actual” del servidor si ya hay documento confirmado.

---

## 2) Modelo conceptual de tasa (convencion obligatoria)

Definimos siempre un par **base / quote** y un numero `rateQuotePerBase`:

> **1 unidad de `baseCurrency` = `rateQuotePerBase` unidades de `quoteCurrency`**

Ejemplo Venezuela habitual (BCV): **1 USD = 36,50 VES**  
- `baseCurrency` = USD  
- `quoteCurrency` = VES  
- `rateQuotePerBase` = 36,50  

**Conversiones:**

- De **funcional → documento** o viceversa depende de cual sea funcional y cual documento.  
- Regla en servicio (una sola funcion pura):

```text
Si convierto cantidad en moneda X a moneda Y usando la misma paridad (base, quote, rate):
  Primero expresar ambas en terminos de base y quote, luego aplicar rate.
```

Implementacion practica (evitar errores):

- Normalizar a: `amountInQuote = amountInBase * rateQuotePerBase`
- `amountInBase = amountInQuote / rateQuotePerBase`

Al confirmar un documento (venta, compra, devolución con `SPOT_ON_RETURN`), el backend **resuelve** `base` y `quote` desde la fila de **`ExchangeRate`** de la tienda que cubra el par **moneda documento / moneda funcional** (cualquier orientación almacenada: busca `(doc, fun)` o `(fun, doc)` y usa la convención **tal como está guardada**). Ejemplos habituales: **USD/VES** (1 USD = X VES), **EUR/USD** (1 EUR = X USD). Alta de nuevos pares: `POST /exchange-rates` + monedas en `Currency`. El documento almacena:

- `fxBaseCurrencyCode`, `fxQuoteCurrencyCode`, `fxRateQuotePerBase`, `exchangeRateDate`

y opcionalmente `fxSource` (`BCV`, `MANUAL`, `POS_OFFLINE`, etc.).

**Redondeo:** conversiones en `Decimal` de alta precisión; sin redondeo comercial en servicios (ver `src/common/fx/convert-amount.ts`).

**Devoluciones:** por defecto se **hereda** el snapshot de la venta (`INHERIT_ORIGINAL_SALE`); opcional **`SPOT_ON_RETURN`** recalcula solo el **funcional comercial** con tasa del día; el inventario sigue valorizándose al COGS histórico de la venta.

---

## 3) Entidades y tablas (PostgreSQL)

### 3.1 `Currency`

| Campo | Tipo | Notas |
|-------|------|--------|
| id | UUID | PK |
| code | string unique | `USD`, `VES`, `EUR`, … (ISO 4217) |
| name | string | |
| decimals | int | 2 tipico |
| active | bool | |

### 3.2 `ExchangeRate` (tasa diaria / por sucursal)

Registro de **referencia** para UI y validaciones; el documento confirmado **no** depende de esta fila.

| Campo | Tipo | Notas |
|-------|------|--------|
| id | UUID | PK |
| storeId | UUID? | null = empresa global; si no usas multi-sucursal para FX |
| baseCurrencyId | UUID | FK Currency |
| quoteCurrencyId | UUID | FK Currency |
| rateQuotePerBase | decimal(30,10) | precision alta |
| effectiveDate | date | “dia de la tasa” |
| source | string | `BCV`, `MANUAL`, … |
| notes | string? | |
| createdAt | timestamptz | auditoria de alta |
| createdById | UUID? | usuario |

**Indice:** `(storeId, baseCurrencyId, quoteCurrencyId, effectiveDate DESC)` para “ultima tasa del dia”.

**Auditoria de cambios:** no editar filas publicadas; **insertar** nueva fila (append-only). Si se requiere correccion, nueva fila + `notes` con referencia al error.

### 3.3 `BusinessSettings` (por sucursal)

| Campo | Tipo | Notas |
|-------|------|--------|
| id | UUID | PK |
| storeId | UUID unique | FK Store |
| functionalCurrencyId | UUID | FK Currency |
| defaultSaleDocCurrencyId | UUID? | opcional: moneda por defecto en POS |
| updatedAt | timestamptz | |

### 3.4 `Product` (catalogo)

Semantica recomendada (alineada a inventario funcional):

- `price` + `currency` (o `priceCurrencyCode`): **precio de lista / venta sugerido** en la moneda indicada (puede ser VES en ticket y USD en otro canal).
- `cost` (o renombrar mentalmente a `averageUnitCostFunctional`): **costo medio unitario en moneda funcional** para valorizar inventario y margen.

> El esquema Prisma actual mantiene `price`, `cost`, `currency`; la **documentacion** fija que `cost` = costo medio en **moneda funcional**. Migracion futura opcional: renombrar campo a `averageCostFunctional` para claridad.

### 3.5 `Sale` (documento confirmado)

Ademas de totales legacy si aplica:

| Campo | Tipo | Notas |
|-------|------|--------|
| documentCurrencyCode | string | moneda del documento |
| functionalCurrencyCode | string | copia de la funcional al confirmar |
| fxBaseCurrencyCode | string | snapshot |
| fxQuoteCurrencyCode | string | snapshot |
| fxRateQuotePerBase | decimal | snapshot |
| exchangeRateDate | date | “tasa usada” |
| fxSource | string? | `POS_OFFLINE`, `SERVER`, … |
| totalDocument | decimal | total en moneda documento |
| totalFunctional | decimal | total en moneda funcional |

`total` existente puede seguir siendo alias de `totalDocument` durante transicion.

### 3.6 `SaleLine`

| Campo | Tipo |
|-------|------|
| unitPriceDocument | decimal |
| unitPriceFunctional | decimal |
| lineTotalDocument | decimal |
| lineTotalFunctional | decimal |
| discountDocument | decimal? |
| discountFunctional | decimal? |

Mantener `price`/`total` legacy como espejo opcional durante transicion.

### 3.7 `Purchase` / `PurchaseLine`

Misma estructura dual que venta (documento vs funcional + snapshot FX en cabecera).

### 3.8 `InventoryItem` (valorizacion funcional)

| Campo | Tipo | Notas |
|-------|------|--------|
| quantity | decimal | unidades |
| averageUnitCostFunctional | decimal | costo medio **solo funcional** |
| totalCostFunctional | decimal | `quantity * averageUnitCostFunctional` (o mantener incrementalmente) |

### 3.9 `StockMovement`

Para movimientos que afectan valor (compra, ajuste con costo, devolucion):

| Campo | Tipo |
|-------|------|
| unitCostFunctional | decimal? |
| totalCostFunctional | decimal? |

`costAtMoment` / `priceAtMoment` existentes pueden mapearse a contexto documento vs funcional en migracion de servicios.

### 3.10 Devoluciones

**Implementado (backend):** entidad **`SaleReturn`** + **`SaleReturnLine`** con FK a `Sale` / `SaleLine`; política **`INHERIT_ORIGINAL_SALE`** (FX copiada de la venta original). Importe comercial proporcional por línea; inventario **`IN_RETURN`** valorizado al COGS medio de los **`OUT_SALE`** de esa venta y producto. Detalle: **`docs/api/RETURNS_POLICY.md`**.

**Opcion A (alternativa no usada):** `Sale` con `status` = `RETURN` y lineas negativas.

Invariante: **nunca** recalcular lineas de la venta original; la devolucion es un **nuevo** documento.

---

## 4) Reglas de negocio

1. **Confirmacion:** solo al `COMMIT` del documento se fijan `fx*` y totales por linea. Borradores pueden recalcular desde `ExchangeRate` vigente.
2. **Moneda funcional** se lee de `BusinessSettings` al confirmar y se **copia** al documento (`functionalCurrencyCode`).
3. Si documento = funcional: `fxRateQuotePerBase` puede ser 1 con base=quote (no recomendado) o **omitir conversion** y exigir `totalDocument == totalFunctional` y mismos precios en ambas columnas — mejor: tratar como identidad con validacion.
4. **Redondeo:** calcular en `Decimal` alta precision; **redondear solo al final de linea** al `decimals` de la moneda destino; acumular totales desde lineas ya redondeadas para cuadre con ticket. Documentar `ROUND_HALF_UP` (o politica unica).
5. **Offline:** payload debe incluir `fxBaseCurrencyCode`, `fxQuoteCurrencyCode`, `fxRateQuotePerBase`, `exchangeRateDate`, `documentCurrencyCode`, `functionalCurrencyCode` y precios en **documento**; el servidor **recalcula** funcional y **rechaza** si desviacion > tolerancia (ej. 0.5%) salvo rol admin (configurable).
6. **No recalcular historicos:** jobs de reporting leen columnas guardadas, no `ExchangeRate` actual.

---

## 5) Flujos

### 5.1 Compra (confirmada)

1. Usuario elige moneda del documento (VES/USD).
2. Sistema carga tasa sugerida del dia (`ExchangeRate` + fecha) segun sucursal.
3. Usuario confirma o ajusta tasa (auditable como nueva fila o `source=MANUAL`).
4. Lineas: cantidad, `unitCostDocument` → derivar `unitCostFunctional` con snapshot.
5. Actualizar **inventario**: cantidad + **costo medio en funcional** (ver §7).
6. `StockMovement` tipo `IN_PURCHASE` con `unitCostFunctional` / `totalCostFunctional`.

### 5.2 Venta (POS online/offline)

1. Misma carga de tasa sugerida; offline lleva tasa en payload.
2. Lineas: `unitPriceDocument`, descuentos → funcionales con snapshot.
3. `OUT_SALE` con costo funcional al costo medio **al momento** (no reprice historico).
4. Descontar `InventoryItem.quantity`; **no** cambiar valoracion por la venta salvo politica de costo (PEPS/medio — aqui **medio** ya esta en producto/inventario).

### 5.3 Actualizacion de precios de catalogo

- Cambiar `Product.price` / moneda de lista es independiente del FX del documento.
- Opcional: disparar `OutboxEvent` `PRODUCT_UPDATED` para Mongo (ya implementado).
- No tocar ventas pasadas.

### 5.4 Tasa diaria

- Operador registra `ExchangeRate` del dia (append).
- Apps consultan “ultima tasa efectiva para fecha F” para **sugerir**; documento guarda copia.

---

## 6) Costeo e inventario (costo promedio ponderado)

Al recibir compra en documento distinto a funcional:

- `unitCostFunctional = unitCostDocument * factor` o division segun par base/quote (usar funcion central).

**Costo medio** (simplificado):

```text
nuevaMedia = (qtyAntes * mediaAntes + qtyEntrada * costoEntradaFunctional) / (qtyAntes + qtyEntrada)
```

Actualizar `InventoryItem.averageUnitCostFunctional` y `totalCostFunctional = qty * media`.

**Errores comunes a evitar:**

- Mezclar VES y USD sin snapshot en documento.
- Recalcular ventas viejas con tasa nueva.
- Redondear antes de multiplicar cantidad * precio.
- Usar float JS; usar `Decimal` / strings en API.

---

## 7) Invariantes del sistema

1. Documento confirmado tiene `exchangeRateDate` y par FX completo coherente con `documentCurrencyCode` y `functionalCurrencyCode`.
2. Suma de `lineTotalDocument` = `totalDocument` (tolerancia redondeo documentada).
3. Suma de `lineTotalFunctional` = `totalFunctional`.
4. `InventoryItem.totalCostFunctional` = `quantity * averageUnitCostFunctional` (salvo ajustes explícitos).
5. `opId` unico por operacion sync; reintentos no duplican movimientos ni documentos.

---

## 8) DTOs (ejemplo)

### Confirmar venta (servidor)

```ts
ConfirmSaleDto {
  storeId: UUID
  documentCurrencyCode: 'USD' | 'VES'
  functionalCurrencyCode: string // copia validada vs settings
  fxBaseCurrencyCode: string
  fxQuoteCurrencyCode: string
  fxRateQuotePerBase: string // decimal as string
  exchangeRateDate: string // ISO date
  fxSource?: string
  lines: {
    productId: UUID
    quantity: string
    unitPriceDocument: string
    discountDocument?: string
  }[]
}
```

Servicio deriva `unitPriceFunctional`, `lineTotal*`, valida redondeo, persiste en transaccion + `StockMovement` + idempotencia `opId`.

### POS offline payload (sync)

Incluir los mismos campos FX + lineas en moneda documento; servidor valida y persiste snapshot.

---

## 9) Pseudocodigo servicio (nucleo)

```ts
function toFunctional(amountDoc, docCode, functionalCode, fx) {
  if (docCode === functionalCode) return amountDoc;
  // expresar amountDoc en base/quote segun docCode, luego convertir a functional
  return convertUsingFx(amountDoc, docCode, functionalCode, fx);
}

function confirmSale(dto, opId) {
  assertIdempotent(opId);
  tx(() => {
    for (line of dto.lines) {
      const unitF = toFunctional(line.unitPriceDocument, ...);
      const totalDoc = round(line.qty * line.unitPriceDocument, docDecimals);
      const totalF = round(line.qty * unitF, functionalDecimals);
      insert SaleLine(...);
      stockOut(line.productId, line.qty, unitCostFunctionalFromInventory);
    }
    insert Sale(header with fx snapshot and totals);
  });
}
```

---

## 10) Ejemplos numericos

**Funcional = USD. Venta documento VES. Tasa: 1 USD = 36,50 VES.**  
Base USD, quote VES, `rateQuotePerBase = 36.50`.

Producto vendido a **365 VES** / unidad → **10 USD** / unidad (365 / 36,50).

**Compra documento USD, funcional USD:** sin conversion; columnas documento y funcional iguales.

**Compra documento VES, funcional USD:** entrada **3 650 VES** total linea → **100 USD** funcional (3650 / 36,50) con misma tasa snapshot.

---

## 11) Impacto en Mongo `products_read`

Proyeccion para mobile debe incluir al menos:

- `listPrice`, `listPriceCurrency` (o `currency` actual)
- `functionalCurrencyCode` de la sucursal por defecto (o por contexto de tienda)
- opcional: `suggestedPriceDocument` segun tasa del dia **solo para UI**, nunca como verdad contable

Eventos outbox existentes pueden extenderse en fase siguiente con campos adicionales.

---

## 12) Pruebas recomendadas (delicadas)

- Matriz: documento USD/VES x funcional USD/VES (4 casos + identidad).
- Redondeo: cantidades fraccionarias, descuentos.
- Offline: mismo `opId` dos veces; payload con tasa distinta a servidor → rechazo o override segun politica.
- No regresion: documento viejo inmutable al insertar nueva `ExchangeRate`.

---

## 13) Estado de implementacion en repo

- Modelos Prisma `Currency`, `ExchangeRate`, `BusinessSettings` y campos opcionales en documentos/inventario/movimientos: **ver migracion** `*_multi_currency_foundation`.
- Servicios de confirmacion de compra/venta con dual currency: **pendiente** (tracker).
- Seed de `USD`/`VES`: **pendiente** o manual inicial.
