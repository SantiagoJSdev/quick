import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FxSnapshotDto } from './dto/fx-snapshot.dto';
import { ExchangeRatesService } from './exchange-rates.service';

export type ResolvedFxSnapshot = {
  fxBaseCurrencyCode: string;
  fxQuoteCurrencyCode: string;
  fxRateQuotePerBase: Prisma.Decimal;
  exchangeRateDate: Date;
  fxSource: string;
};

/**
 * Resolución de par FX por tienda (MVP USD/VES) para confirmar ventas/compras.
 * `POS_OFFLINE` usa tasa del cliente; en otro caso se valida contra servidor (±0,5%).
 */
@Injectable()
export class StoreFxSnapshotService {
  constructor(private readonly exchangeRates: ExchangeRatesService) {}

  private utcDateOnly(d: Date): Date {
    const x = new Date(d);
    x.setUTCHours(0, 0, 0, 0);
    return x;
  }

  async resolveFxSnapshot(
    storeId: string,
    documentCode: string,
    functionalCode: string,
    snapshot?: FxSnapshotDto,
  ): Promise<ResolvedFxSnapshot> {
    const doc = documentCode.toUpperCase();
    const fun = functionalCode.toUpperCase();
    const supported = new Set(['USD', 'VES']);
    if (!supported.has(doc) || !supported.has(fun)) {
      throw new BadRequestException(
        'MVP: moneda documento y funcional deben ser USD y/o VES',
      );
    }

    if (doc === fun) {
      return {
        fxBaseCurrencyCode: doc,
        fxQuoteCurrencyCode: doc,
        fxRateQuotePerBase: new Prisma.Decimal(1),
        exchangeRateDate: this.utcDateOnly(new Date()),
        fxSource: snapshot?.fxSource?.trim() || 'IDENTITY',
      };
    }

    const latest = await this.exchangeRates.findLatest({
      storeId,
      baseCurrencyCode: 'USD',
      quoteCurrencyCode: 'VES',
      effectiveOn: snapshot?.effectiveDate,
    });

    let rate = new Prisma.Decimal(latest.rateQuotePerBase);
    let exchangeRateDate = this.utcDateOnly(
      new Date(`${latest.effectiveDate}T12:00:00.000Z`),
    );
    let fxSource = 'SERVER';

    if (snapshot) {
      const clientBase = snapshot.baseCurrencyCode.toUpperCase();
      const clientQuote = snapshot.quoteCurrencyCode.toUpperCase();
      if (clientBase !== 'USD' || clientQuote !== 'VES') {
        throw new BadRequestException(
          'MVP: snapshot FX debe usar base USD y quote VES',
        );
      }
      const snapRate = new Prisma.Decimal(snapshot.rateQuotePerBase);
      const src = snapshot.fxSource?.trim();
      if (src === 'POS_OFFLINE') {
        rate = snapRate;
        exchangeRateDate = this.utcDateOnly(
          new Date(`${snapshot.effectiveDate}T12:00:00.000Z`),
        );
        fxSource = 'POS_OFFLINE';
      } else {
        const drift = rate.minus(snapRate).abs().div(rate);
        if (drift.gt(0.005)) {
          throw new BadRequestException(
            'FX snapshot difiere más de 0,5% de la tasa del servidor',
          );
        }
      }
    }

    return {
      fxBaseCurrencyCode: 'USD',
      fxQuoteCurrencyCode: 'VES',
      fxRateQuotePerBase: rate,
      exchangeRateDate,
      fxSource,
    };
  }
}
