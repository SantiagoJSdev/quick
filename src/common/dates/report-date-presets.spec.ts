import { resolvePresetCalendarDates } from './report-date-presets';

describe('resolvePresetCalendarDates', () => {
  it('today uses same from and to in UTC', () => {
    const r = resolvePresetCalendarDates('today', 'UTC');
    expect(r.dateFrom).toBe(r.dateTo);
    expect(r.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('yesterday is one day before today in zone', () => {
    const today = resolvePresetCalendarDates('today', 'UTC');
    const yesterday = resolvePresetCalendarDates('yesterday', 'UTC');
    expect(yesterday.dateFrom).not.toBe(today.dateFrom);
  });
});
