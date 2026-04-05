import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { StoreConfiguredGuard } from './common/guards/store-configured.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongoModule } from './mongo/mongo.module';
import { ProductsModule } from './modules/products/products.module';
import { SyncModule } from './modules/sync/sync.module';
import { BusinessSettingsModule } from './modules/business-settings/business-settings.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { SaleReturnsModule } from './modules/sale-returns/sale-returns.module';
import { SalesModule } from './modules/sales/sales.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { ExchangeRatesModule } from './modules/exchange-rates/exchange-rates.module';
import { OutboxModule } from './outbox/outbox.module';
import { OpsModule } from './modules/ops/ops.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MongoModule,
    OutboxModule,
    BusinessSettingsModule,
    ExchangeRatesModule,
    InventoryModule,
    SalesModule,
    PurchasesModule,
    SuppliersModule,
    SaleReturnsModule,
    ProductsModule,
    SyncModule,
    OpsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RequestIdMiddleware,
    { provide: APP_GUARD, useClass: StoreConfiguredGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
