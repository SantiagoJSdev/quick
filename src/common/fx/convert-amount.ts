import { Prisma } from '@prisma/client';

/**
 * Convierte un importe expresado en `documentCode` a `functionalCode`
 * usando la paridad 1 `fxBaseCode` = `rateQuotePerBase` `fxQuoteCode`.
 *
 * **Redondeo:** todo el cálculo va en `Prisma.Decimal` (equivalente a `decimal.js`):
 * no hay redondeo comercial intermedio. El resultado se persiste con la escala del
 * campo en Postgres (`Decimal(65,30)` en líneas / cabeceras). Quien necesite
 * mostrar 2 decimales en UI debe formatear allí; no se aplica “banker’s rounding” aquí.
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
