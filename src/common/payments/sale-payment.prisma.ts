import type { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

type SalePaymentRow = {
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
};

export function salePaymentPrisma(prisma: PrismaService) {
  return (
    prisma as unknown as {
      salePayment: {
        findMany(args: {
          where: { saleId: string };
          orderBy?: { createdAt: 'asc' | 'desc' };
        }): Promise<SalePaymentRow[]>;
      };
    }
  ).salePayment;
}
