import type { Prisma } from '@prisma/client';

type SalePaymentCreateManyData = {
  saleId: string;
  method: string;
  amount: Prisma.Decimal;
  currencyCode: string;
  amountDocumentCurrency: Prisma.Decimal;
  fxBaseCurrencyCode: string | null;
  fxQuoteCurrencyCode: string | null;
  fxRateQuotePerBase: Prisma.Decimal | null;
  exchangeRateDate: Date | null;
  fxSource: string | null;
};

export function salePaymentTx(tx: Prisma.TransactionClient) {
  const delegate = (
    tx as unknown as {
      salePayment: {
        createMany(args: { data: SalePaymentCreateManyData[] }): Promise<unknown>;
        findMany(args: {
          where: { saleId: string };
          orderBy?: { createdAt: 'asc' | 'desc' };
        }): Promise<
          Array<{
            id: string;
            saleId: string;
            method: string;
            amount: Prisma.Decimal;
            currencyCode: string;
            amountDocumentCurrency: Prisma.Decimal;
            fxBaseCurrencyCode: string | null;
            fxQuoteCurrencyCode: string | null;
            fxRateQuotePerBase: Prisma.Decimal | null;
            exchangeRateDate: Date | null;
            fxSource: string | null;
            createdAt: Date;
          }>
        >;
      };
    }
  ).salePayment;

  if (!delegate) {
    throw new Error(
      'Missing Prisma delegate `salePayment`. Run migrations and regenerate Prisma client.',
    );
  }

  return delegate;
}
