import { Module } from '@nestjs/common';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExchangeRatesService } from './exchange-rates.service';
import { StoreFxSnapshotService } from './store-fx-snapshot.service';

@Module({
  controllers: [ExchangeRatesController],
  providers: [ExchangeRatesService, StoreFxSnapshotService],
  exports: [ExchangeRatesService, StoreFxSnapshotService],
})
export class ExchangeRatesModule {}
