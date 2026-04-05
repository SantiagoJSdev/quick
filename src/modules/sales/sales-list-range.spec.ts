import { resolveSaleListUtcRange } from './sales-list-range';

describe('resolveSaleListUtcRange', () => {
  it('parses inclusive range in America/Caracas', () => {
    const r = resolveSaleListUtcRange(
      'America/Caracas',
      '2026-04-01',
      '2026-04-01',
    );
    expect(r.meta.dateFrom).toBe('2026-04-01');
    expect(r.meta.dateTo).toBe('2026-04-01');
    expect(r.meta.timezone).toBe('America/Caracas');
    expect(r.startUtc.getTime()).toBeLessThan(r.endUtc.getTime());
  });

  it('rejects range over 31 inclusive days', () => {
    expect(() =>
      resolveSaleListUtcRange('UTC', '2026-04-01', '2026-05-05'),
    ).toThrow(/cannot exceed/);
  });
});
