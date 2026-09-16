import { Prisma } from '@prisma/client';

/**
 * Redondea un importe decimal a 2 decimales (centavos) usando "round half up",
 * el mismo criterio con el que el front POS redondea los montos monetarios.
 *
 * Se usa SOLO para comparar el total de pagos contra el total de la venta en
 * moneda funcional; la persistencia de importes sigue guardando la precisión
 * completa del cálculo FX (sin redondeo intermedio).
 */
export function roundCurrency2(value: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}
