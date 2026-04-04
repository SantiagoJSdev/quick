import { randomUUID } from 'crypto';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { StoreFxSnapshotService } from '../exchange-rates/store-fx-snapshot.service';
import { InventoryService } from '../inventory/inventory.service';
import { PurchasesService } from '../purchases/purchases.service';
import { SaleReturnsService } from '../sale-returns/sale-returns.service';
import { SalesService } from '../sales/sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncService } from './sync.service';

const run = process.env.RUN_INTEGRATION === '1';

(run ? describe : describe.skip)('SyncService (integration, RUN_INTEGRATION=1)', () => {
  let prisma: PrismaService;
  let service: SyncService;
  let exchangeRates: ExchangeRatesService;
  let storeId: string;
  const deviceId = `it-device-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const inventory = new InventoryService(prisma);
    exchangeRates = new ExchangeRatesService(prisma);
    const storeFx = new StoreFxSnapshotService(exchangeRates);
    const sales = new SalesService(prisma, storeFx, inventory);
    const purchases = new PurchasesService(prisma, storeFx, inventory);
    const saleReturns = new SaleReturnsService(
      prisma,
      inventory,
      storeFx,
    );
    service = new SyncService(
      prisma,
      inventory,
      sales,
      purchases,
      saleReturns,
      storeFx,
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
  });

  afterAll(async () => {
    await prisma.syncOperation.deleteMany({ where: { deviceId } });
    await prisma.pOSDevice.deleteMany({ where: { deviceId } });
    await prisma.$disconnect();
  });

  it('NOOP acks then same opId is skipped', async () => {
    const opId = randomUUID();
    const ts = new Date().toISOString();

    const first = await service.push(
      {
        deviceId,
        ops: [
          {
            opId,
            opType: 'NOOP',
            timestamp: ts,
            payload: { ping: true },
          },
        ],
      },
      storeId,
    );

    expect(first.acked).toHaveLength(1);
    expect(first.acked[0].opId).toBe(opId);
    expect(first.acked[0].serverVersion).toBeGreaterThan(0);
    expect(first.skipped).toHaveLength(0);
    expect(first.failed).toHaveLength(0);

    const second = await service.push(
      {
        deviceId,
        ops: [
          {
            opId,
            opType: 'NOOP',
            timestamp: ts,
            payload: { ping: true },
          },
        ],
      },
      storeId,
    );

    expect(second.acked).toHaveLength(0);
    expect(second.skipped).toEqual([
      { opId, reason: 'already_applied' },
    ]);
    expect(second.failed).toHaveLength(0);
  });

  it('pull returns ordered ops and stable shape', async () => {
    const r = await service.pull(storeId, 0, 50);
    expect(r.fromVersion).toBe(0);
    expect(Array.isArray(r.ops)).toBe(true);
    expect(typeof r.toVersion).toBe('number');
    expect(r.toVersion).toBeGreaterThanOrEqual(0);
    expect(typeof r.hasMore).toBe('boolean');
    for (let i = 1; i < r.ops.length; i++) {
      expect(r.ops[i].serverVersion).toBeGreaterThan(r.ops[i - 1].serverVersion);
    }
  });

  describe('SALE offline idempotency (same opId)', () => {
    const sku = `it-sync-sale-${randomUUID().slice(0, 8)}`;
    let productId: string;
    let opId: string;
    let saleId: string;

    beforeAll(async () => {
      const p = await prisma.product.create({
        data: {
          sku,
          name: 'IT sync sale',
          price: '10',
          cost: '5',
          currency: 'VES',
        },
      });
      productId = p.id;
      await prisma.inventoryItem.create({
        data: { productId, storeId, quantity: '50' },
      });
      opId = randomUUID();
      saleId = randomUUID();
    });

    afterAll(async () => {
      await prisma.syncOperation.deleteMany({ where: { opId } });
      await prisma.stockMovement.deleteMany({
        where: { referenceId: saleId },
      });
      await prisma.saleLine.deleteMany({ where: { saleId } });
      await prisma.sale.deleteMany({ where: { id: saleId } });
      await prisma.inventoryItem.deleteMany({
        where: { productId, storeId },
      });
      await prisma.product.deleteMany({ where: { id: productId } });
    });

    it('second push with same opId is skipped (already_applied)', async () => {
      const fxLatest = await exchangeRates.findLatest({
        storeId,
        baseCurrencyCode: 'USD',
        quoteCurrencyCode: 'VES',
      });
      const payload = {
        sale: {
          storeId,
          id: saleId,
          documentCurrencyCode: 'VES',
          deviceId,
          lines: [
            { productId, quantity: '1', price: '100' },
          ],
          fxSnapshot: {
            baseCurrencyCode: fxLatest.baseCurrencyCode,
            quoteCurrencyCode: fxLatest.quoteCurrencyCode,
            rateQuotePerBase: fxLatest.rateQuotePerBase,
            effectiveDate: fxLatest.effectiveDate,
            fxSource: fxLatest.source,
          },
        },
      };
      const ts = new Date().toISOString();
      const op = {
        opId,
        opType: 'SALE' as const,
        timestamp: ts,
        payload,
      };

      const first = await service.push({ deviceId, ops: [op] }, storeId);
      expect(first.failed).toHaveLength(0);
      expect(first.acked).toHaveLength(1);
      expect(first.acked[0].opId).toBe(opId);

      const second = await service.push({ deviceId, ops: [op] }, storeId);
      expect(second.failed).toHaveLength(0);
      expect(second.acked).toHaveLength(0);
      expect(second.skipped).toEqual([
        { opId, reason: 'already_applied' },
      ]);
    });
  });
});
