import type { FxSnapshotDto } from '../exchange-rates/dto/fx-snapshot.dto';
import type {
  CreateSaleDto,
  CreateSaleLineDto,
  SalePaymentInputDto,
} from './dto/create-sale.dto';

export type ParsedSyncSalePayload = {
  storeId: string;
  dto: CreateSaleDto;
};

export type SalePayloadParseResult =
  | { ok: true; data: ParsedSyncSalePayload }
  | { ok: false; details: string };

function typeLabel(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Interpreta `payload.sale` de `sync/push` con `opType: SALE`. */
export function parseSalePayload(
  payload: Record<string, unknown>,
): SalePayloadParseResult {
  const raw = payload.sale;
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      details:
        'payload.sale must be an object. Send { "payload": { "sale": { "storeId", "lines": [...] } } }.',
    };
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.storeId !== 'string') {
    return {
      ok: false,
      details: `sale.storeId must be a string (UUID). Got ${typeLabel(s.storeId)}.`,
    };
  }
  if (!Array.isArray(s.lines)) {
    return {
      ok: false,
      details: `sale.lines must be a non-empty array. Got ${typeLabel(s.lines)}.`,
    };
  }
  const linesIn = s.lines as unknown[];
  if (linesIn.length === 0) {
    return {
      ok: false,
      details: 'sale.lines must contain at least one line.',
    };
  }

  const lines: CreateSaleLineDto[] = [];
  for (let i = 0; i < linesIn.length; i++) {
    const row = linesIn[i];
    if (typeof row !== 'object' || row === null) {
      return {
        ok: false,
        details: `sale.lines[${i}] must be an object.`,
      };
    }
    const L = row as Record<string, unknown>;
    if (
      typeof L.productId !== 'string' ||
      typeof L.quantity !== 'string' ||
      typeof L.price !== 'string'
    ) {
      return {
        ok: false,
        details:
          `sale.lines[${i}]: productId, quantity and price must be JSON strings (e.g. "2" and "10.50"), not numbers — Dart/Flutter often encodes double/int; convert to String before JSON. ` +
          `Got productId=${typeLabel(L.productId)}, quantity=${typeLabel(L.quantity)}, price=${typeLabel(L.price)}.`,
      };
    }
    lines.push({
      productId: L.productId,
      quantity: L.quantity,
      price: L.price,
      discount: typeof L.discount === 'string' ? L.discount : undefined,
    });
  }

  let fxSnapshot: FxSnapshotDto | undefined;
  const fx = s.fxSnapshot ?? s.fx;
  if (typeof fx === 'object' && fx !== null) {
    const f = fx as Record<string, unknown>;
    if (
      typeof f.baseCurrencyCode === 'string' &&
      typeof f.quoteCurrencyCode === 'string' &&
      typeof f.rateQuotePerBase === 'string' &&
      typeof f.effectiveDate === 'string'
    ) {
      fxSnapshot = {
        baseCurrencyCode: f.baseCurrencyCode,
        quoteCurrencyCode: f.quoteCurrencyCode,
        rateQuotePerBase: f.rateQuotePerBase,
        effectiveDate: f.effectiveDate,
        fxSource: typeof f.fxSource === 'string' ? f.fxSource : undefined,
      };
    }
    /* Objeto parcial: se ignora (mismo comportamiento que antes); el servidor resuelve FX por settings. */
  }

  const payments: SalePaymentInputDto[] = [];
  if (Array.isArray(s.payments)) {
    for (let i = 0; i < s.payments.length; i++) {
      const row = (s.payments as unknown[])[i];
      if (typeof row !== 'object' || row === null) {
        return {
          ok: false,
          details: `sale.payments[${i}] must be an object.`,
        };
      }
      const p = row as Record<string, unknown>;
      if (
        typeof p.method !== 'string' ||
        typeof p.amount !== 'string' ||
        typeof p.currencyCode !== 'string'
      ) {
        return {
          ok: false,
          details:
            `sale.payments[${i}]: method, amount and currencyCode must be strings. ` +
            `Got method=${typeLabel(p.method)}, amount=${typeLabel(p.amount)}, currencyCode=${typeLabel(p.currencyCode)}.`,
        };
      }

      let paymentFx: FxSnapshotDto | undefined;
      if (typeof p.fxSnapshot === 'object' && p.fxSnapshot !== null) {
        const f = p.fxSnapshot as Record<string, unknown>;
        if (
          typeof f.baseCurrencyCode !== 'string' ||
          typeof f.quoteCurrencyCode !== 'string' ||
          typeof f.rateQuotePerBase !== 'string' ||
          typeof f.effectiveDate !== 'string'
        ) {
          return {
            ok: false,
            details:
              `sale.payments[${i}].fxSnapshot must include baseCurrencyCode, quoteCurrencyCode, rateQuotePerBase, effectiveDate (all strings), or omit fxSnapshot entirely.`,
          };
        }
        paymentFx = {
          baseCurrencyCode: f.baseCurrencyCode,
          quoteCurrencyCode: f.quoteCurrencyCode,
          rateQuotePerBase: f.rateQuotePerBase,
          effectiveDate: f.effectiveDate,
          fxSource: typeof f.fxSource === 'string' ? f.fxSource : undefined,
        };
      }

      payments.push({
        method: p.method,
        amount: p.amount,
        currencyCode: p.currencyCode,
        fxSnapshot: paymentFx,
      });
    }
  }

  const dto: CreateSaleDto = {
    id: typeof s.id === 'string' ? s.id : undefined,
    documentCurrencyCode:
      typeof s.documentCurrencyCode === 'string'
        ? s.documentCurrencyCode
        : undefined,
    lines,
    userId: typeof s.userId === 'string' ? s.userId : undefined,
    deviceId: typeof s.deviceId === 'string' ? s.deviceId : undefined,
    appVersion: typeof s.appVersion === 'string' ? s.appVersion : undefined,
    fxSnapshot,
    payments: payments.length > 0 ? payments : undefined,
  };

  return { ok: true, data: { storeId: s.storeId, dto } };
}
