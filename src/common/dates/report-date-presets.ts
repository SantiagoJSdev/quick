import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  resolveSaleListUtcRange,
  type UtcBounds,
} from '../../modules/sales/sales-list-range';

export const REPORT_PRESETS = [
  'today',
  'yesterday',
  'week',
  'month',
] as const;

export type ReportDatePreset = (typeof REPORT_PRESETS)[number];

export function isReportPreset(value: string): value is ReportDatePreset {
  return (REPORT_PRESETS as readonly string[]).includes(value);
}

/**
 * Resuelve `dateFrom` / `dateTo` (YYYY-MM-DD) en zona de tienda para presets del dashboard.
 */
export function resolvePresetCalendarDates(
  preset: ReportDatePreset,
  storeTimezone: string | null | undefined,
): { dateFrom: string; dateTo: string } {
  const zone =
    storeTimezone && storeTimezone.trim() !== ''
      ? storeTimezone.trim()
      : 'UTC';
  const nowZ = DateTime.now().setZone(zone);
  if (!nowZ.isValid) {
    throw new BadRequestException(
      `Invalid store timezone "${zone}"; set Store.timezone to a valid IANA zone or leave empty for UTC`,
    );
  }

  const today = nowZ.startOf('day');

  switch (preset) {
    case 'today':
      return {
        dateFrom: today.toISODate()!,
        dateTo: today.toISODate()!,
      };
    case 'yesterday': {
      const y = today.minus({ days: 1 });
      return { dateFrom: y.toISODate()!, dateTo: y.toISODate()! };
    }
    case 'week': {
      const start = today.startOf('week');
      return { dateFrom: start.toISODate()!, dateTo: today.toISODate()! };
    }
    case 'month': {
      const start = today.startOf('month');
      return { dateFrom: start.toISODate()!, dateTo: today.toISODate()! };
    }
    default:
      throw new BadRequestException(`Unknown preset: ${preset}`);
  }
}

export type ReportUtcRangeInput = {
  storeTimezone: string | null | undefined;
  preset?: string;
  dateFrom?: string;
  dateTo?: string;
};

/** Combina preset o fechas explícitas y devuelve límites UTC + meta. */
export function resolveReportUtcRange(input: ReportUtcRangeInput): UtcBounds & {
  preset?: ReportDatePreset;
} {
  if (input.preset?.trim()) {
    const p = input.preset.trim().toLowerCase();
    if (!isReportPreset(p)) {
      throw new BadRequestException(
        `preset must be one of: ${REPORT_PRESETS.join(', ')}`,
      );
    }
    const { dateFrom, dateTo } = resolvePresetCalendarDates(
      p,
      input.storeTimezone,
    );
    const bounds = resolveSaleListUtcRange(
      input.storeTimezone,
      dateFrom,
      dateTo,
    );
    return { ...bounds, preset: p };
  }

  const bounds = resolveSaleListUtcRange(
    input.storeTimezone,
    input.dateFrom,
    input.dateTo,
  );
  return bounds;
}
