import type { FxSnapshotDto } from '../exchange-rates/dto/fx-snapshot.dto';
import type {
  CreatePurchaseDto,
  CreatePurchaseLineDto,
} from './dto/create-purchase.dto';

const PURCHASE_REF_MAX_LEN = 120;

function parseSupplierInvoiceReference(
  p: Record<string, unknown>,
): string | undefined {
  const raw = p.supplierInvoiceReference ?? p.reference;
  if (typeof raw !== 'string') {
    return undefined;
  }
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  return t.length > PURCHASE_REF_MAX_LEN
    ? t.slice(0, PURCHASE_REF_MAX_LEN)
    : t;
}

export type ParsedSyncPurchasePayload = {
  storeId: string;
  dto: CreatePurchaseDto;
};

/** Interpreta `payload.purchase` de `sync/push` con `opType: PURCHASE_RECEIVE`. */
export function parsePurchasePayload(
  payload: Record<string, unknown>,
): ParsedSyncPurchasePayload | null {
  const raw = payload.purchase;
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const p = raw as Record<string, unknown>;
  if (
    typeof p.storeId !== 'string' ||
    typeof p.supplierId !== 'string' ||
    !Array.isArray(p.lines)
  ) {
    return null;
  }
  const linesIn = p.lines as unknown[];
  if (linesIn.length === 0) {
    return null;
  }

  const lines: CreatePurchaseLineDto[] = [];
  for (const row of linesIn) {
    if (typeof row !== 'object' || row === null) {
      return null;
    }
    const L = row as Record<string, unknown>;
    if (
      typeof L.productId !== 'string' ||
      typeof L.quantity !== 'string' ||
      typeof L.unitCost !== 'string'
    ) {
      return null;
    }
    lines.push({
      productId: L.productId,
      quantity: L.quantity,
      unitCost: L.unitCost,
    });
  }

  let fxSnapshot: FxSnapshotDto | undefined;
  const fx = p.fxSnapshot ?? p.fx;
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

  const dto: CreatePurchaseDto = {
    id: typeof p.id === 'string' ? p.id : undefined,
    supplierId: p.supplierId,
    documentCurrencyCode:
      typeof p.documentCurrencyCode === 'string'
        ? p.documentCurrencyCode
        : undefined,
    supplierInvoiceReference: parseSupplierInvoiceReference(p),
    lines,
    fxSnapshot,
  };

  return { storeId: p.storeId, dto };
}
