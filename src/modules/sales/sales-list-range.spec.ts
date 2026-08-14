import { resolveSaleListUtcRange } from './sales-list-range';

describe('resolveSaleListUtcRange', () => {
  it('parses inclusive range in America/Caracas as [00:00, next-00:00)', () => {
    const r = resolveSaleListUtcRange(
      'America/Caracas',
      '2026-04-01',
      '2026-04-01',
    );
    expect(r.meta.dateFrom).toBe('2026-04-01');
    expect(r.meta.dateTo).toBe('2026-04-01');
    expect(r.meta.timezone).toBe('America/Caracas');
    // Caracas UTC-4: 2026-04-01 00:00 → 04:00Z; next day 04:00Z
    expect(r.startUtc.toISOString()).toBe('2026-04-01T04:00:00.000Z');
    expect(r.endUtc.toISOString()).toBe('2026-04-02T04:00:00.000Z');
  });

  it('rejects range over 31 inclusive days', () => {
    expect(() =>
      resolveSaleListUtcRange('UTC', '2026-04-01', '2026-05-05'),
    ).toThrow(/cannot exceed/);
  });
});
