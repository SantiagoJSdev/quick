import type {
  CreateSaleReturnDto,
  CreateSaleReturnLineDto,
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

  const dto: CreateSaleReturnDto = {
    id: typeof s.id === 'string' ? s.id : undefined,
    originalSaleId: s.originalSaleId,
    lines,
  };

  return { storeId: s.storeId, dto };
}
