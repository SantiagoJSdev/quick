import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';
import { LatestExchangeRateQueryDto } from './dto/latest-exchange-rate.query.dto';
import { ExchangeRatesService } from './exchange-rates.service';

@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly exchangeRates: ExchangeRatesService) {}

  /**
   * Tasa sugerida para UI / cache offline (tras sync). Requiere header `X-Store-Id`.
   * Solo tasas registradas para esa tienda (no hay tasa global).
   */
  @Get('latest')
  getLatest(@Req() req: Request, @Query() query: LatestExchangeRateQueryDto) {
    return this.exchangeRates.findLatest({
      storeId: req.storeContext!.storeId,
      baseCurrencyCode: query.baseCurrencyCode,
      quoteCurrencyCode: query.quoteCurrencyCode,
      effectiveOn: query.effectiveOn,
    });
  }

  /** Alta manual. Requiere `X-Store-Id`. Dispara outbox -> Mongo `fx_rates_read`. */
  @Post()
  create(@Req() req: Request, @Body() dto: CreateExchangeRateDto) {
    return this.exchangeRates.create(req.storeContext!.storeId, dto);
  }
}
