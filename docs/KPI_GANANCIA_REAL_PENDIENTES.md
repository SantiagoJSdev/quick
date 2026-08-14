# Ganancia real diaria — pendientes (post fase 1)

Fase 1 ya está en `/kpis/snapshot` → bloque `realProfit` (bolsas 90% tickets, platos charcutería, nómina, fijos luz/alquiler/transporte). Config: `BusinessSettings.realProfitConfig`.

---

## Pendiente dentro del KPI “ganancia real” (fase 2+)

| Ítem | Descripción | Notas |
|---|---|---|
| Comisión de pagos | % sobre transferencias / punto / tarjeta | Usar `SalePayment.method` del rango |
| Faltante de caja | `countedCash − expected` al cerrar `CashSession` | Solo días con cierre |
| Merma frescos | % o monto diario sobre carne/pollo/verdura/pan | Lista de categorías o productIds |
| `OUT_LOSS` del día | Merma ya registrada en inventario | Sumar `StockMovement` tipo `OUT_LOSS` × costo |
| Otros empaques | Film, bolsas negras, servilletas | Mismo patrón que platos |
| Impuesto estimado | % sobre ganancia o sobre venta | Variable en config |
| UI admin config | Pantalla para editar `realProfitConfig` sin SQL | `PATCH /business-settings` ya acepta el JSON |
| Serie `realProfit.byDay` | Repartir fijos/nómina por día en rangos week/month | Hoy se prorratea el total del rango |

---

## KPI aparte (no mezclar con ganancia real)

### Disponible para sacar / caja neta del día

```text
efectivo_cobrado_del_día
− reserva_reposición_contado
− abonos_a_proveedores
− (opcional) reserva_insumos
= disponible_para_sacar
```

| Subtarea | Estado |
|---|---|
| Definir % o montos de split (reposición vs abono) | Pendiente |
| Vincular abonos reales `PurchasePayment` del día | Pendiente |
| Endpoint o bloque `cashAvailable` en snapshot | Pendiente |
| Documentar diferencia vs `realProfit` en front | Pendiente |

Este KPI responde “¿cuánto puedo retirar sin descapitalizarme?”, no “¿cuánto gané operando?”.

---

## Mejoras de precisión (bolsas / platos)

- Contar bolsas reales si algún día se venden como línea de ticket (hoy es estimado 90% tickets).
- Ajustar `ticketCoverageRate` / `unitCost` platos desde la app.
- Usar costo promedio de inventario del paquete de bolsas si `Product.cost` está desactualizado.
