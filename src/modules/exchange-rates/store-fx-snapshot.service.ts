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
 * Resuelve par FX por tienda para cualquier par **documento / funcional** que exista
 * en `ExchangeRate` (orientación base/quote como en BD). Valida snapshot cliente
 * (±0,5%) salvo `POS_OFFLINE`.
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

    if (doc === fun) {
      return {
        fxBaseCurrencyCode: doc,
        fxQuoteCurrencyCode: doc,
        fxRateQuotePerBase: new Prisma.Decimal(1),
        exchangeRateDate: this.utcDateOnly(new Date()),
        fxSource: snapshot?.fxSource?.trim() || 'IDENTITY',
      };
    }

    const latest = await this.exchangeRates.findLatestForDocumentFunctionalPair({
      storeId,
      documentCode: doc,
      functionalCode: fun,
      effectiveOn: snapshot?.effectiveDate,
    });

    let rate = new Prisma.Decimal(latest.rateQuotePerBase);
    let exchangeRateDate = this.utcDateOnly(
      new Date(`${latest.effectiveDate}T12:00:00.000Z`),
    );
    let fxSource = 'SERVER';

    const serverBase = latest.baseCurrencyCode.toUpperCase();
    const serverQuote = latest.quoteCurrencyCode.toUpperCase();

    if (snapshot) {
      const clientBase = snapshot.baseCurrencyCode.toUpperCase();
      const clientQuote = snapshot.quoteCurrencyCode.toUpperCase();
      if (clientBase !== serverBase || clientQuote !== serverQuote) {
        throw new BadRequestException(
          `FX snapshot pair must match server row: ${serverBase}/${serverQuote}`,
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
      fxBaseCurrencyCode: serverBase,
      fxQuoteCurrencyCode: serverQuote,
      fxRateQuotePerBase: rate,
      exchangeRateDate,
      fxSource,
    };
  }
}
