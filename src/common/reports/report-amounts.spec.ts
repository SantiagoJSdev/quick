import { Prisma } from '@prisma/client';
import {
  avgTicketNet,
  returnRateString,
  saleFunctionalAmount,
} from './report-amounts';

describe('report-amounts', () => {
  it('uses totalFunctional when present', () => {
    const v = saleFunctionalAmount({
      totalFunctional: new Prisma.Decimal('10'),
      total: new Prisma.Decimal('99'),
    });
    expect(v.toString()).toBe('10');
  });

  it('avgTicketNet divides net by tickets', () => {
    expect(
      avgTicketNet(new Prisma.Decimal('100'), 4),
    ).toBe('25');
    expect(avgTicketNet(new Prisma.Decimal('100'), 0)).toBe('0');
  });

  it('returnRateString is null when gross is zero', () => {
    expect(
      returnRateString(new Prisma.Decimal(0), new Prisma.Decimal(5)),
    ).toBeNull();
  });
});
