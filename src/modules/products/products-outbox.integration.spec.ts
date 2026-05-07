import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import type { BusinessSettings } from '@prisma/client';
import { InventoryModule } from '../inventory/inventory.module';
import { MongoModule } from '../../mongo/mongo.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from './products.service';

const run = process.env.RUN_INTEGRATION === '1';

const integrationCtx = {
  storeId: '00000000-0000-4000-8000-000000000001',
  settings: { defaultMarginPercent: null } as BusinessSettings,
};

(run ? describe : describe.skip)(
  'ProductsService outbox (integration, RUN_INTEGRATION=1)',
  () => {
    let moduleRef: TestingModule | undefined;
    let products: ProductsService | undefined;
    let prisma: PrismaService | undefined;
    const sku = `it-sku-${randomUUID().slice(0, 8)}`;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [PrismaModule, MongoModule, InventoryModule],
        providers: [ProductsService],
      }).compile();

      products = moduleRef.get(ProductsService);
      prisma = moduleRef.get(PrismaService);
      await prisma.$connect();
      await prisma.store.upsert({
        where: { id: integrationCtx.storeId },
        create: {
          id: integrationCtx.storeId,
          name: 'Integration test store',
          type: 'main',
        },
        update: {},
      });
    });

    afterAll(async () => {
      if (!prisma) {
        return;
      }
      const p = await prisma.product.findUnique({ where: { sku } });
      if (p) {
        await prisma.outboxEvent.deleteMany({
          where: { aggregateType: 'Product', aggregateId: p.id },
        });
        await prisma.product.delete({ where: { id: p.id } });
      }
      await prisma.$disconnect();
      await moduleRef?.close();
    });

    it('create writes PRODUCT_CREATED outbox row in same flow', async () => {
      if (!products || !prisma) {
        throw new Error('Test module not initialized');
      }
      const product = await products.create(
        {
          sku,
          name: 'Integration test product',
          price: '1.00',
          cost: '0.50',
        },
        integrationCtx,
      );

      const ev = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: 'PRODUCT_CREATED',
        },
      });

      expect(ev).not.toBeNull();
      expect(ev?.status).toBeDefined();
    });
  },
);
