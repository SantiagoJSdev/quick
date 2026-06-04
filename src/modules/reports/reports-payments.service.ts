import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { convertAmountDocumentToFunctional } from '../../common/fx/convert-amount';
import { decimalToReportString } from '../../common/reports/report-amounts';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReportSalesFilter } from './reports.types';

type PaymentRow = {
  method: string;
  amount: Prisma.Decimal;
  currencyCode: string;
  amountDocumentCurrency: Prisma.Decimal;
  sale: {
    documentCurrencyCode: string | null;
    functionalCurrencyCode: string | null;
    fxBaseCurrencyCode: string | null;
    fxQuoteCurrencyCode: string | null;
    fxRateQuotePerBase: Prisma.Decimal | null;
  };
};

@Injectable()
export class ReportsPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async breakdownByMethod(
    filter: ReportSalesFilter,
    functionalCode: string,
  ): Promise<Array<{ method: string; amount: string }>> {
    const funcCode = functionalCode.toUpperCase();

    const payments = (await this.prisma.salePayment.findMany({
      where: {
        sale: {
          storeId: filter.storeId,
          status: filter.status,
          createdAt: { gte: filter.startUtc, lte: filter.endUtc },
          ...(filter.deviceId ? { deviceId: filter.deviceId } : {}),
        },
      },
      select: {
        method: true,
        amount: true,
        currencyCode: true,
        amountDocumentCurrency: true,
        sale: {
          select: {
            documentCurrencyCode: true,
            functionalCurrencyCode: true,
            fxBaseCurrencyCode: true,
            fxQuoteCurrencyCode: true,
            fxRateQuotePerBase: true,
          },
        },
      },
    })) as PaymentRow[];

    const byMethod = new Map<string, Prisma.Decimal>();

    for (const p of payments) {
      const amountFunc = this.paymentToFunctional(p, funcCode);
      const prev = byMethod.get(p.method) ?? new Prisma.Decimal(0);
      byMethod.set(p.method, prev.plus(amountFunc));
    }

    return [...byMethod.entries()]
      .map(([method, amount]) => ({
        method,
        amount: decimalToReportString(amount),
      }))
      .sort((a, b) => a.method.localeCompare(b.method));
  }

  private paymentToFunctional(p: PaymentRow, funcCode: string): Prisma.Decimal {
    const saleFunc =
      p.sale.functionalCurrencyCode?.toUpperCase() ?? funcCode;
    const docCode = (
      p.sale.documentCurrencyCode?.toUpperCase() ?? saleFunc
    );

    if (p.currencyCode.toUpperCase() === saleFunc) {
      return p.amount;
    }

    const docAmount = p.amountDocumentCurrency;

    if (docCode === saleFunc) {
      return docAmount;
    }

    const base = p.sale.fxBaseCurrencyCode?.toUpperCase();
    const quote = p.sale.fxQuoteCurrencyCode?.toUpperCase();
    const rate = p.sale.fxRateQuotePerBase;
    if (!base || !quote || rate == null) {
      return docAmount;
    }

    return convertAmountDocumentToFunctional(
      docAmount,
      docCode,
      saleFunc,
      base,
      quote,
      rate,
    );
  }
}
