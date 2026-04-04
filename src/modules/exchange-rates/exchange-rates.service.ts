import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';

@Injectable()
export class ExchangeRatesService {
  constructor(private readonly prisma: PrismaService) {}

  private utcDateOnlyFromIso(iso?: string): Date {
    if (!iso) {
      return this.utcDateOnly(new Date());
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('effectiveOn: invalid date');
    }
    return this.utcDateOnly(d);
  }

  private utcDateOnly(d: Date): Date {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
  }

  /**
   * Solo tasas de la tienda (sin fallback global). Requiere header X-Store-Id + guard.
   */
  async findLatest(params: {
    storeId: string;
    baseCurrencyCode: string;
    quoteCurrencyCode: string;
    effectiveOn?: string;
  }) {
    const base = await this.prisma.currency.findUnique({
      where: { code: params.baseCurrencyCode.toUpperCase() },
    });
    const quote = await this.prisma.currency.findUnique({
      where: { code: params.quoteCurrencyCode.toUpperCase() },
    });
    if (!base || !quote) {
      throw new NotFoundException('Currency code not found');
    }

    const asOf = this.utcDateOnlyFromIso(params.effectiveOn);

    const includeCurrencies = {
      baseCurrency: true,
      quoteCurrency: true,
    } as const;

    const row = await this.prisma.exchangeRate.findFirst({
      where: {
        storeId: params.storeId,
        baseCurrencyId: base.id,
        quoteCurrencyId: quote.id,
        effectiveDate: { lte: asOf },
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      include: includeCurrencies,
    });

    if (!row) {
      throw new NotFoundException(
        'No exchange rate for this store, pair and effective date',
      );
    }

    return {
      id: row.id,
      storeId: row.storeId,
      baseCurrencyCode: row.baseCurrency.code,
      quoteCurrencyCode: row.quoteCurrency.code,
      rateQuotePerBase: row.rateQuotePerBase.toString(),
      effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
      source: row.source,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      convention:
        '1 ' + row.baseCurrency.code + ' = rateQuotePerBase ' + row.quoteCurrency.code,
    };
  }

  /**
   * Última tasa de la tienda para el par documento/funcional, en cualquier orientación
   * almacenada (`base/quote` o `quote/base`). Convención devuelta = fila en BD.
   */
  async findLatestForDocumentFunctionalPair(params: {
    storeId: string;
    documentCode: string;
    functionalCode: string;
    effectiveOn?: string;
  }) {
    const doc = params.documentCode.toUpperCase();
    const fun = params.functionalCode.toUpperCase();
    if (doc === fun) {
      throw new BadRequestException(
        'documentCode and functionalCode must differ for an FX pair lookup',
      );
    }

    const docCur = await this.prisma.currency.findUnique({
      where: { code: doc },
    });
    const funCur = await this.prisma.currency.findUnique({
      where: { code: fun },
    });
    if (!docCur || !funCur) {
      throw new NotFoundException('Currency code not found');
    }

    const asOf = this.utcDateOnlyFromIso(params.effectiveOn);

    const row = await this.prisma.exchangeRate.findFirst({
      where: {
        storeId: params.storeId,
        OR: [
          {
            baseCurrencyId: docCur.id,
            quoteCurrencyId: funCur.id,
          },
          {
            baseCurrencyId: funCur.id,
            quoteCurrencyId: docCur.id,
          },
        ],
        effectiveDate: { lte: asOf },
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      include: { baseCurrency: true, quoteCurrency: true },
    });

    if (!row) {
      throw new NotFoundException(
        'No exchange rate for this store, currency pair and effective date',
      );
    }

    return {
      id: row.id,
      storeId: row.storeId,
      baseCurrencyCode: row.baseCurrency.code,
      quoteCurrencyCode: row.quoteCurrency.code,
      rateQuotePerBase: row.rateQuotePerBase.toString(),
      effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
      source: row.source,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      convention:
        '1 ' +
        row.baseCurrency.code +
        ' = rateQuotePerBase ' +
        row.quoteCurrency.code,
    };
  }

  async create(storeId: string, dto: CreateExchangeRateDto) {
    const base = await this.prisma.currency.findUnique({
      where: { code: dto.baseCurrencyCode.toUpperCase() },
    });
    const quote = await this.prisma.currency.findUnique({
      where: { code: dto.quoteCurrencyCode.toUpperCase() },
    });
    if (!base || !quote) {
      throw new NotFoundException('Currency code not found');
    }

    const effectiveDate = this.utcDateOnlyFromIso(dto.effectiveDate);
    const rate = new Prisma.Decimal(dto.rateQuotePerBase);

    const source = dto.source?.trim() || 'MANUAL';
    const notes = dto.notes?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.exchangeRate.create({
        data: {
          storeId,
          baseCurrencyId: base.id,
          quoteCurrencyId: quote.id,
          rateQuotePerBase: rate,
          effectiveDate,
          source,
          notes,
        },
        include: {
          baseCurrency: true,
          quoteCurrency: true,
        },
      });

      const payload: Prisma.InputJsonValue = {
        exchangeRate: {
          id: created.id,
          storeId,
          baseCurrencyCode: created.baseCurrency.code,
          quoteCurrencyCode: created.quoteCurrency.code,
          rateQuotePerBase: created.rateQuotePerBase.toString(),
          effectiveDate: created.effectiveDate.toISOString().slice(0, 10),
          source: created.source,
          notes: created.notes,
        },
      };

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'ExchangeRate',
          aggregateId: created.id,
          eventType: 'EXCHANGE_RATE_UPSERTED',
          payload,
        },
      });

      return created;
    });
  }
}
