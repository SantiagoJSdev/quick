import { Prisma } from '@prisma/client';

/**
 * Convierte un importe expresado en `documentCode` a `functionalCode`
 * usando la paridad 1 `fxBaseCode` = `rateQuotePerBase` `fxQuoteCode`.
 */
export function convertAmountDocumentToFunctional(
  amountInDocument: Prisma.Decimal,
  documentCode: string,
  functionalCode: string,
  fxBaseCode: string,
  fxQuoteCode: string,
  rateQuotePerBase: Prisma.Decimal,
): Prisma.Decimal {
  const doc = documentCode.toUpperCase();
  const fun = functionalCode.toUpperCase();
  if (doc === fun) {
    return amountInDocument;
  }
  const base = fxBaseCode.toUpperCase();
  const quote = fxQuoteCode.toUpperCase();

  const toBase = (amt: Prisma.Decimal, code: string): Prisma.Decimal => {
    if (code === base) {
      return amt;
    }
    if (code === quote) {
      return amt.div(rateQuotePerBase);
    }
    throw new Error(`Unexpected document/functional currency vs FX pair (${code})`);
  };

  const baseTo = (amtBase: Prisma.Decimal, target: string): Prisma.Decimal => {
    if (target === base) {
      return amtBase;
    }
    if (target === quote) {
      return amtBase.mul(rateQuotePerBase);
    }
    throw new Error(`Unexpected target currency (${target})`);
  };

  return baseTo(toBase(amountInDocument, doc), fun);
}
