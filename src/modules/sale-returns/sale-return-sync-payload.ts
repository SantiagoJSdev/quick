import type { FxSnapshotDto } from '../exchange-rates/dto/fx-snapshot.dto';
import {
  SALE_RETURN_FX_POLICIES,
  type CreateSaleReturnDto,
  type CreateSaleReturnLineDto,
} from './dto/create-sale-return.dto';

export type ParsedSyncSaleReturnPayload = {
  storeId: string;
  dto: CreateSaleReturnDto;
};

/** `payload.saleReturn` para `sync/push` con `opType: SALE_RETURN`. */
export function parseSaleReturnPayload(
  payload: Record<string, unknown>,
): ParsedSyncSaleReturnPayload | null {
  const raw = payload.saleReturn;
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.storeId !== 'string' || typeof s.originalSaleId !== 'string') {
    return null;
  }
  if (!Array.isArray(s.lines)) {
    return null;
  }
  const linesIn = s.lines as unknown[];
  if (linesIn.length === 0) {
    return null;
  }

  const lines: CreateSaleReturnLineDto[] = [];
  for (const row of linesIn) {
    if (typeof row !== 'object' || row === null) {
      return null;
    }
    const L = row as Record<string, unknown>;
    if (typeof L.saleLineId !== 'string' || typeof L.quantity !== 'string') {
      return null;
    }
    lines.push({ saleLineId: L.saleLineId, quantity: L.quantity });
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

  let fxPolicy: CreateSaleReturnDto['fxPolicy'];
  if (typeof s.fxPolicy === 'string') {
    const p = s.fxPolicy as (typeof SALE_RETURN_FX_POLICIES)[number];
    if ((SALE_RETURN_FX_POLICIES as readonly string[]).includes(p)) {
      fxPolicy = p;
    }
  }

  const dto: CreateSaleReturnDto = {
    id: typeof s.id === 'string' ? s.id : undefined,
    originalSaleId: s.originalSaleId,
    lines,
    fxPolicy,
    fxSnapshot,
  };

  return { storeId: s.storeId, dto };
}
