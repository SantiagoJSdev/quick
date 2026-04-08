import { randomUUID } from 'crypto';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { StoreFxSnapshotService } from '../exchange-rates/store-fx-snapshot.service';
import { InventoryService } from '../inventory/inventory.service';
import { PosDeviceService } from '../pos-device/pos-device.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesService } from './sales.service';

const run = process.env.RUN_INTEGRATION === '1';

(run ? describe : describe.skip)(
  'SalesService FX historical immutability (integration, RUN_INTEGRATION=1)',
  () => {
    let prisma: PrismaService;
    let sales: SalesService;
    let exchangeRates: ExchangeRatesService;
    let storeId: string;
    let usdId: string;
    let vesId: string;
    const sku = `it-fx-${randomUUID().slice(0, 8)}`;
    let productId: string;
    let extraRateId: string | null = null;

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();
      const inventory = new InventoryService(prisma);
      exchangeRates = new ExchangeRatesService(prisma);
      const storeFx = new StoreFxSnapshotService(exchangeRates);
      sales = new SalesService(
        prisma,
        storeFx,
        inventory,
        new PosDeviceService(),
      );

      const store = await prisma.store.findFirst({
        include: { businessSettings: true },
      });
      if (!store?.businessSettings) {
        throw new Error(
          'No store with BusinessSettings; run npm run db:seed before integration tests',
        );
      }
      storeId = store.id;

      const usd = await prisma.currency.findUnique({ where: { code: 'USD' } });
      const ves = await prisma.currency.findUnique({ where: { code: 'VES' } });
      if (!usd || !ves) {
        throw new Error('Seed currencies USD/VES required');
      }
      usdId = usd.id;
      vesId = ves.id;

      const p = await prisma.product.create({
        data: {
          sku,
          name: 'IT FX product',
          price: '10',
          cost: '5',
          currency: 'VES',
        },
      });
      productId = p.id;
      await prisma.inventoryItem.create({
        data: {
          productId,
          storeId,
          quantity: '100',
        },
      });
    });

    afterAll(async () => {
      if (!prisma) {
        return;
      }
      await prisma.stockMovement.deleteMany({
        where: { storeId, productId },
      });
      const saleIds = (
        await prisma.saleLine.findMany({
          where: { productId },
          select: { saleId: true },
        })
      ).map((l) => l.saleId);
      const uniqueSaleIds = [...new Set(saleIds)];
      for (const id of uniqueSaleIds) {
        await prisma.saleLine.deleteMany({ where: { saleId: id } });
        await prisma.sale.deleteMany({ where: { id } });
      }
      await prisma.inventoryItem.deleteMany({
        where: { productId, storeId },
      });
      await prisma.product.deleteMany({ where: { id: productId } });
      if (extraRateId) {
        await prisma.exchangeRate.deleteMany({ where: { id: extraRateId } });
      }
      await prisma.$disconnect();
    });

    it('sale keeps stored FX after a newer ExchangeRate row is inserted', async () => {
      const sale = await sales.create(storeId, {
        documentCurrencyCode: 'VES',
        lines: [{ productId, quantity: '1', price: '50' }],
      });

      const snap = {
        fxRate: sale.fxRateQuotePerBase?.toString() ?? '',
        fxBase: sale.fxBaseCurrencyCode,
        fxQuote: sale.fxQuoteCurrencyCode,
        exDate: sale.exchangeRateDate?.toISOString().slice(0, 10) ?? '',
        totalDoc: sale.totalDocument?.toString() ?? '',
        totalFunc: sale.totalFunctional?.toString() ?? '',
      };
      expect(snap.fxRate.length).toBeGreaterThan(0);

      const anchor = await prisma.exchangeRate.findFirst({
        where: {
          storeId,
          baseCurrencyId: usdId,
          quoteCurrencyId: vesId,
        },
        orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      });
      const effectiveDate =
        anchor?.effectiveDate ?? new Date(new Date().toISOString().slice(0, 10));

      const row = await prisma.exchangeRate.create({
        data: {
          storeId,
          baseCurrencyId: usdId,
          quoteCurrencyId: vesId,
          rateQuotePerBase: '99.999',
          effectiveDate,
          source: 'IT_FX_NEWER',
        },
      });
      extraRateId = row.id;

      const again = await sales.findOne(storeId, sale.id);
      expect(again).not.toBeNull();
      expect(again!.fxRateQuotePerBase?.toString()).toBe(snap.fxRate);
      expect(again!.fxBaseCurrencyCode).toBe(snap.fxBase);
      expect(again!.fxQuoteCurrencyCode).toBe(snap.fxQuote);
      expect(again!.totalDocument?.toString()).toBe(snap.totalDoc);
      expect(again!.totalFunctional?.toString()).toBe(snap.totalFunc);

      const sale2 = await sales.create(storeId, {
        documentCurrencyCode: 'VES',
        lines: [{ productId, quantity: '1', price: '50' }],
      });
      expect(sale2.fxRateQuotePerBase?.toString()).not.toBe(snap.fxRate);
    });

    it('persists mixed payments and returns them in sale detail', async () => {
      const fxLatest = await exchangeRates.findLatest({
        storeId,
        baseCurrencyCode: 'USD',
        quoteCurrencyCode: 'VES',
      });
      const rate = Number(fxLatest.rateQuotePerBase);
      const totalVes = 200;
      const vesPart = (totalVes - rate).toFixed(6);
      if (Number(vesPart) <= 0) {
        throw new Error('Test requires fx rate lower than total sale amount');
      }

      const sale = await sales.create(storeId, {
        documentCurrencyCode: 'VES',
        lines: [{ productId, quantity: '1', price: totalVes.toString() }],
        payments: [
          {
            method: 'CASH_USD',
            amount: '1',
            currencyCode: 'USD',
            fxSnapshot: {
              baseCurrencyCode: fxLatest.baseCurrencyCode,
              quoteCurrencyCode: fxLatest.quoteCurrencyCode,
              rateQuotePerBase: fxLatest.rateQuotePerBase,
              effectiveDate: fxLatest.effectiveDate,
              fxSource: fxLatest.source,
            },
          },
          {
            method: 'CASH_VES',
            amount: vesPart,
            currencyCode: 'VES',
          },
        ],
      });

      const detail = await sales.findOne(storeId, sale.id);
      expect(detail).not.toBeNull();
      const payments = (detail as { payments?: Array<{ method: string }> }).payments;
      expect(Array.isArray(payments)).toBe(true);
      expect(payments).toHaveLength(2);
      expect(payments?.map((p) => p.method)).toEqual(['CASH_USD', 'CASH_VES']);
    });
  },
);
