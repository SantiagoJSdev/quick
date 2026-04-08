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

/** Interpreta `payload.sale` de `sync/push` con `opType: SALE`. */
export function parseSalePayload(
  payload: Record<string, unknown>,
): ParsedSyncSalePayload | null {
  const raw = payload.sale;
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.storeId !== 'string' || !Array.isArray(s.lines)) {
    return null;
  }
  const linesIn = s.lines as unknown[];
  if (linesIn.length === 0) {
    return null;
  }

  const lines: CreateSaleLineDto[] = [];
  for (const row of linesIn) {
    if (typeof row !== 'object' || row === null) {
      return null;
    }
    const L = row as Record<string, unknown>;
    if (
      typeof L.productId !== 'string' ||
      typeof L.quantity !== 'string' ||
      typeof L.price !== 'string'
    ) {
      return null;
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
  }

  const payments: SalePaymentInputDto[] = [];
  if (Array.isArray(s.payments)) {
    for (const row of s.payments as unknown[]) {
      if (typeof row !== 'object' || row === null) {
        return null;
      }
      const p = row as Record<string, unknown>;
      if (
        typeof p.method !== 'string' ||
        typeof p.amount !== 'string' ||
        typeof p.currencyCode !== 'string'
      ) {
        return null;
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
          return null;
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

  return { storeId: s.storeId, dto };
}
