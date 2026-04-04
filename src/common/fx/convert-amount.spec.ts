import { Prisma } from '@prisma/client';
import { convertAmountDocumentToFunctional } from './convert-amount';

describe('convertAmountDocumentToFunctional', () => {
  const rate = new Prisma.Decimal('36.5');

  it('returns same amount when document equals functional', () => {
    const amt = new Prisma.Decimal('100');
    const r = convertAmountDocumentToFunctional(
      amt,
      'USD',
      'USD',
      'USD',
      'VES',
      rate,
    );
    expect(r.toString()).toBe('100');
  });

  it('converts VES document to USD functional (1 USD = rate VES)', () => {
    const ves365 = new Prisma.Decimal('365');
    const usd = convertAmountDocumentToFunctional(
      ves365,
      'VES',
      'USD',
      'USD',
      'VES',
      rate,
    );
    expect(usd.toFixed(2)).toBe('10.00');
  });

  it('converts USD document to VES functional', () => {
    const usd10 = new Prisma.Decimal('10');
    const ves = convertAmountDocumentToFunctional(
      usd10,
      'USD',
      'VES',
      'USD',
      'VES',
      rate,
    );
    expect(ves.toString()).toBe('365');
  });

  it('throws when currency does not match FX pair', () => {
    expect(() =>
      convertAmountDocumentToFunctional(
        new Prisma.Decimal('1'),
        'EUR',
        'USD',
        'USD',
        'VES',
        rate,
      ),
    ).toThrow(/Unexpected document/);
  });

  /** 1 EUR = 1.08 USD (base EUR, quote USD) */
  const eurUsd = new Prisma.Decimal('1.08');

  it('converts USD document to EUR functional (base EUR, quote USD)', () => {
    const usd = new Prisma.Decimal('10.8');
    const eur = convertAmountDocumentToFunctional(
      usd,
      'USD',
      'EUR',
      'EUR',
      'USD',
      eurUsd,
    );
    expect(eur.toString()).toBe('10');
  });

  it('converts EUR document to USD functional (base EUR, quote USD)', () => {
    const eur = new Prisma.Decimal('10');
    const usd = convertAmountDocumentToFunctional(
      eur,
      'EUR',
      'USD',
      'EUR',
      'USD',
      eurUsd,
    );
    expect(usd.toString()).toBe('10.8');
  });
});
