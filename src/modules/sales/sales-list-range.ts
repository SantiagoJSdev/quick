import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';

const MAX_INCLUSIVE_DAYS = 31;
const DEFAULT_LOOKBACK_DAYS = 6; // hoy + 6 atrás = 7 días inclusive

export type SaleListRangeMeta = {
  /** IANA usada para interpretar dateFrom/dateTo (o `UTC`). */
  timezone: string;
  /** `YYYY-MM-DD` efectivos tras normalizar defaults. */
  dateFrom: string;
  dateTo: string;
  /** Texto fijo para documentación en respuesta. */
  rangeInterpretation: string;
};

export type UtcBounds = { startUtc: Date; endUtc: Date; meta: SaleListRangeMeta };

/**
 * Resuelve rango [startUtc, endUtc] para filtrar `Sale.createdAt`.
 * Fechas calendario en `storeTimezone` (fallback UTC).
 */
export function resolveSaleListUtcRange(
  storeTimezone: string | null | undefined,
  dateFrom?: string,
  dateTo?: string,
): UtcBounds {
  const zone =
    storeTimezone && storeTimezone.trim() !== ''
      ? storeTimezone.trim()
      : 'UTC';

  let interpretation = `Calendar dates dateFrom/dateTo are interpreted in store timezone "${zone}" (midnight through end-of-day). Timestamps in API responses are ISO-8601 in UTC.`;

  const nowZ = DateTime.now().setZone(zone);
  if (!nowZ.isValid) {
    throw new BadRequestException(
      `Invalid store timezone "${zone}"; set Store.timezone to a valid IANA zone or leave empty for UTC`,
    );
  }

  let fromStr = dateFrom;
  let toStr = dateTo;

  if (!fromStr && !toStr) {
    const toDay = nowZ.startOf('day');
    const fromDay = toDay.minus({ days: DEFAULT_LOOKBACK_DAYS });
    fromStr = fromDay.toISODate()!;
    toStr = toDay.toISODate()!;
    interpretation +=
      ' Default range when dates omitted: last 7 calendar days in store timezone (inclusive).';
  } else if (fromStr && !toStr) {
    const fromDay = DateTime.fromISO(fromStr, { zone }).startOf('day');
    if (!fromDay.isValid) {
      throw new BadRequestException('Invalid dateFrom');
    }
    const toDay = fromDay.plus({ days: MAX_INCLUSIVE_DAYS - 1 }).endOf('day');
    const cap = nowZ.endOf('day');
    const end = toDay > cap ? cap : toDay;
    toStr = end.startOf('day').toISODate()!;
    if (toDay > cap) {
      interpretation +=
        ' dateTo defaulted to today (store TZ) because only dateFrom was sent and the window is capped.';
    } else {
      interpretation +=
        ' dateTo defaulted to 31-day inclusive window from dateFrom when only dateFrom was sent.';
    }
  } else if (!fromStr && toStr) {
    const toDay = DateTime.fromISO(toStr, { zone }).endOf('day');
    if (!toDay.isValid) {
      throw new BadRequestException('Invalid dateTo');
    }
    const fromDay = toDay.startOf('day').minus({ days: MAX_INCLUSIVE_DAYS - 1 });
    fromStr = fromDay.toISODate()!;
    interpretation +=
      ' dateFrom defaulted to 31 calendar days before dateTo when only dateTo was sent.';
  }

  const fromDay = DateTime.fromISO(fromStr!, { zone }).startOf('day');
  const toDayEnd = DateTime.fromISO(toStr!, { zone }).endOf('day');
  if (!fromDay.isValid || !toDayEnd.isValid) {
    throw new BadRequestException('Invalid dateFrom or dateTo');
  }
  if (fromDay > toDayEnd.startOf('day')) {
    throw new BadRequestException('dateFrom must be on or before dateTo');
  }

  const inclusiveDays =
    Math.floor(
      toDayEnd.startOf('day').diff(fromDay.startOf('day'), 'days').days,
    ) + 1;
  if (inclusiveDays > MAX_INCLUSIVE_DAYS) {
    throw new BadRequestException(
      `Date range cannot exceed ${MAX_INCLUSIVE_DAYS} inclusive calendar days`,
    );
  }

  const startUtc = fromDay.toUTC().toJSDate();
  const endUtc = toDayEnd.toUTC().toJSDate();

  return {
    startUtc,
    endUtc,
    meta: {
      timezone: zone,
      dateFrom: fromStr!,
      dateTo: toStr!,
      rangeInterpretation: interpretation,
    },
  };
}
