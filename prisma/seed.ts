import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function utcDateOnly(d: Date) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

async function main() {
  const usd = await prisma.currency.upsert({
    where: { code: 'USD' },
    create: { code: 'USD', name: 'Dólar estadounidense', decimals: 2 },
    update: { name: 'Dólar estadounidense', active: true },
  });

  const ves = await prisma.currency.upsert({
    where: { code: 'VES' },
    create: { code: 'VES', name: 'Bolívar soberano', decimals: 2 },
    update: { name: 'Bolívar soberano', active: true },
  });

  let stores = await prisma.store.findMany({ take: 10 });
  if (stores.length === 0) {
    const created = await prisma.store.create({
      data: {
        name: 'Tienda principal (seed)',
        type: 'main',
        timezone: 'America/Caracas',
      },
    });
    console.log(
      'Seed: created default Store — use this id as X-Store-Id:',
      created.id,
    );
    stores = await prisma.store.findMany({ take: 10 });
  }
  const supplierCount = await prisma.supplier.count();
  if (supplierCount === 0) {
    await prisma.supplier.create({
      data: { name: 'Proveedor seed (general)' },
    });
    console.log('Seed: created default Supplier for purchases / POST /purchases');
  }

  for (const store of stores) {
    await prisma.businessSettings.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        functionalCurrencyId: usd.id,
        defaultSaleDocCurrencyId: ves.id,
      },
      update: {},
    });
  }

  const today = utcDateOnly(new Date());

  if (stores.length > 0) {
    const store = stores[0];
    const storeExists = await prisma.exchangeRate.findFirst({
      where: {
        storeId: store.id,
        baseCurrencyId: usd.id,
        quoteCurrencyId: ves.id,
        source: 'SEED',
        effectiveDate: today,
      },
    });
    if (!storeExists) {
      const rate = await prisma.exchangeRate.create({
        data: {
          storeId: store.id,
          baseCurrencyId: usd.id,
          quoteCurrencyId: ves.id,
          rateQuotePerBase: '36.5',
          effectiveDate: today,
          source: 'SEED',
          notes: 'Ejemplo por tienda (sin tasa global)',
        },
      });
      await prisma.outboxEvent.create({
        data: {
          aggregateType: 'ExchangeRate',
          aggregateId: rate.id,
          eventType: 'EXCHANGE_RATE_UPSERTED',
          payload: {
            exchangeRate: {
              id: rate.id,
              storeId: store.id,
              baseCurrencyCode: 'USD',
              quoteCurrencyCode: 'VES',
              rateQuotePerBase: '36.5',
              effectiveDate: today.toISOString().slice(0, 10),
              source: 'SEED',
              notes: 'Ejemplo por tienda (sin tasa global)',
            },
          },
        },
      });
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
