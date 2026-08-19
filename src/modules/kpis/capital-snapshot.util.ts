import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';

export const CAPITAL_SERIES_MAX_DAYS = 62;

export type CapitalSnapshotSource = 'CASH_CLOSE' | 'LAZY' | 'MANUAL';

export const CAPITAL_SERIES_PRESETS = ['week', 'month'] as const;
export type CapitalSeriesPreset = (typeof CAPITAL_SERIES_PRESETS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertYmd(value: string, field: string): string {
  const trimmed = value.trim();
  if (!DATE_RE.test(trimmed)) {
    throw new BadRequestException(`${field} must be YYYY-MM-DD`);
  }
  const dt = DateTime.fromISO(trimmed, { zone: 'utc' });
  if (!dt.isValid) {
    throw new BadRequestException(`${field} must be a valid calendar date`);
  }
  return trimmed;
}

/** Columna DATE de Prisma: medianoche UTC del YYYY-MM-DD. */
export function calendarDateUtcMidnight(ymd: string): Date {
  return new Date(`${assertYmd(ymd, 'date')}T00:00:00.000Z`);
}

export function ymdFromPrismaDate(d: Date): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).toISODate()!;
}

export function listInclusiveYmd(dateFrom: string, dateTo: string): string[] {
  const from = DateTime.fromISO(dateFrom, { zone: 'utc' }).startOf('day');
  const to = DateTime.fromISO(dateTo, { zone: 'utc' }).startOf('day');
  if (!from.isValid || !to.isValid || to < from) {
    return [];
  }
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur.toISODate()!);
    cur = cur.plus({ days: 1 });
  }
  return out;
}

export function storeZone(storeTimezone: string | null | undefined): string {
  return storeTimezone && storeTimezone.trim() !== ''
    ? storeTimezone.trim()
    : 'UTC';
}

/**
 * Rango de la serie de patrimonio.
 * `week` = últimos 7 días calendario de la tienda (hoy inclusive), no semana ISO.
 */
export function resolveCapitalSeriesCalendarRange(input: {
  storeTimezone: string | null | undefined;
  preset?: string;
  dateFrom?: string;
  dateTo?: string;
}): { dateFrom: string; dateTo: string; preset: CapitalSeriesPreset | null } {
  const zone = storeZone(input.storeTimezone);
  const nowZ = DateTime.now().setZone(zone);
  if (!nowZ.isValid) {
    throw new BadRequestException(
      `Invalid store timezone "${zone}"; set Store.timezone to a valid IANA zone or leave empty for UTC`,
    );
  }
  const today = nowZ.startOf('day');

  const presetRaw = input.preset?.trim().toLowerCase();
  if (presetRaw) {
    if (presetRaw !== 'week' && presetRaw !== 'month') {
      throw new BadRequestException(
        `preset must be one of: ${CAPITAL_SERIES_PRESETS.join(', ')}`,
      );
    }
    if (presetRaw === 'week') {
      return {
        dateFrom: today.minus({ days: 6 }).toISODate()!,
        dateTo: today.toISODate()!,
        preset: 'week',
      };
    }
    return {
      dateFrom: today.startOf('month').toISODate()!,
      dateTo: today.toISODate()!,
      preset: 'month',
    };
  }

  if (!input.dateFrom && !input.dateTo) {
    return {
      dateFrom: today.minus({ days: 6 }).toISODate()!,
      dateTo: today.toISODate()!,
      preset: 'week',
    };
  }

  const dateFrom = input.dateFrom
    ? assertYmd(input.dateFrom, 'dateFrom')
    : today.minus({ days: CAPITAL_SERIES_MAX_DAYS - 1 }).toISODate()!;
  const dateTo = input.dateTo ? assertYmd(input.dateTo, 'dateTo') : today.toISODate()!;

  if (dateTo < dateFrom) {
    throw new BadRequestException('dateTo must be on or after dateFrom');
  }

  const days =
    DateTime.fromISO(dateTo, { zone: 'utc' }).diff(
      DateTime.fromISO(dateFrom, { zone: 'utc' }),
      'days',
    ).days + 1;
  if (days > CAPITAL_SERIES_MAX_DAYS) {
    throw new BadRequestException(
      `date range cannot exceed ${CAPITAL_SERIES_MAX_DAYS} calendar days`,
    );
  }

  return { dateFrom, dateTo, preset: null };
}
