import { Prisma } from '@prisma/client';

export const REPORT_SALE_STATUS = 'CONFIRMED' as const;

/** Monto en moneda funcional para KPIs de venta/devolución. */
export function saleFunctionalAmount(row: {
  totalFunctional: Prisma.Decimal | null;
  total: Prisma.Decimal;
}): Prisma.Decimal {
  return row.totalFunctional ?? row.total;
}

export function decimalToReportString(value: Prisma.Decimal): string {
  return value.toString();
}

export function avgTicketNet(
  netSales: Prisma.Decimal,
  tickets: number,
): string {
  if (tickets <= 0) {
    return '0';
  }
  return netSales.div(tickets).toString();
}

export function returnRateString(
  grossSales: Prisma.Decimal,
  returns: Prisma.Decimal,
): string | null {
  if (grossSales.lte(0)) {
    return null;
  }
  return returns.div(grossSales).toString();
}
