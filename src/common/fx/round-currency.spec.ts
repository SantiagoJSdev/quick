import { Prisma } from '@prisma/client';
import { roundCurrency2 } from './round-currency';

describe('roundCurrency2', () => {
  it('rounds half up to 2 decimals', () => {
    expect(roundCurrency2(new Prisma.Decimal('5.375006')).toString()).toBe(
      '5.38',
    );
  });

  it('rounds down when third decimal < 5', () => {
    expect(roundCurrency2(new Prisma.Decimal('5.374')).toString()).toBe('5.37');
  });

  it('rounds exact half up using string decimal (no float artifacts)', () => {
    expect(roundCurrency2(new Prisma.Decimal('1.005')).toString()).toBe('1.01');
  });

  it('keeps two-decimal values unchanged', () => {
    expect(roundCurrency2(new Prisma.Decimal('5.38')).toFixed(2)).toBe('5.38');
  });
});
