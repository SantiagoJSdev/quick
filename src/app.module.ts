import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { StoreConfiguredGuard } from './common/guards/store-configured.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongoModule } from './mongo/mongo.module';
import { ProductsModule } from './modules/products/products.module';
import { SyncModule } from './modules/sync/sync.module';
import { BusinessSettingsModule } from './modules/business-settings/business-settings.module';
import { ExchangeRatesModule } from './modules/exchange-rates/exchange-rates.module';
import { OutboxModule } from './outbox/outbox.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MongoModule,
    OutboxModule,
    BusinessSettingsModule,
    ExchangeRatesModule,
    ProductsModule,
    SyncModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: StoreConfiguredGuard },
  ],
})
export class AppModule {}
