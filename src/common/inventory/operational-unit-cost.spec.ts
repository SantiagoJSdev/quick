import { Prisma } from '@prisma/client';
import {
  inventoryValuationFunctional,
  operationalUnitCostFunctional,
} from './operational-unit-cost';

describe('operationalUnitCostFunctional', () => {
  it('prefers catalog cost over average', () => {
    expect(
      operationalUnitCostFunctional(
        new Prisma.Decimal('2.35'),
        new Prisma.Decimal('335'),
      ).toString(),
    ).toBe('2.35');
  });

  it('falls back to average when catalog is zero', () => {
    expect(
      operationalUnitCostFunctional(
        new Prisma.Decimal('0'),
        new Prisma.Decimal('1.25'),
      ).toString(),
    ).toBe('1.25');
  });

  it('values inventory at catalog × qty', () => {
    const v = inventoryValuationFunctional(
      new Prisma.Decimal('15.9'),
      new Prisma.Decimal('1.25'),
      new Prisma.Decimal('335'),
    );
    expect(v.unitCost.toString()).toBe('1.25');
    expect(v.totalCost.toString()).toBe('19.875');
  });
});
