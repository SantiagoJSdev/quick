import { BadRequestException } from '@nestjs/common';
import {
  calendarDateUtcMidnight,
  CAPITAL_SERIES_MAX_DAYS,
  listInclusiveYmd,
  resolveCapitalSeriesCalendarRange,
  ymdFromPrismaDate,
} from './capital-snapshot.util';

describe('capital-snapshot.util', () => {
  it('maps DATE column midnight UTC back to YYYY-MM-DD', () => {
    expect(ymdFromPrismaDate(calendarDateUtcMidnight('2026-08-17'))).toBe(
      '2026-08-17',
    );
  });

  it('lists inclusive calendar days', () => {
    expect(listInclusiveYmd('2026-08-30', '2026-09-01')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
  });

  it('rejects custom ranges longer than max days', () => {
    expect(() =>
      resolveCapitalSeriesCalendarRange({
        storeTimezone: 'America/Caracas',
        dateFrom: '2026-01-01',
        dateTo: '2026-04-01',
      }),
    ).toThrow(BadRequestException);
  });

  it(`allows a ${CAPITAL_SERIES_MAX_DAYS}-day custom range`, () => {
    const r = resolveCapitalSeriesCalendarRange({
      storeTimezone: 'America/Caracas',
      dateFrom: '2026-07-01',
      dateTo: '2026-08-31',
    });
    expect(r.preset).toBeNull();
    expect(r.dateFrom).toBe('2026-07-01');
    expect(r.dateTo).toBe('2026-08-31');
  });
});
