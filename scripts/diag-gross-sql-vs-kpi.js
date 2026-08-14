const { PrismaClient } = require('@prisma/client');
const { DateTime } = require('luxon');

const p = new PrismaClient();
const STORE = '0b54c944-28ba-4542-991a-4840c4801906';

async function main() {
  const store = await p.store.findUnique({
    where: { id: STORE },
    select: { timezone: true },
  });
  const zone = store.timezone || 'UTC';
  const day = DateTime.now().setZone(zone).startOf('day');
  const startUtc = day.toUTC().toJSDate();
  const endUtc = day.plus({ days: 1 }).toUTC().toJSDate();

  const lines = await p.saleLine.findMany({
    where: {
      sale: {
        storeId: STORE,
        status: 'CONFIRMED',
        createdAt: { gte: startUtc, lt: endUtc },
      },
    },
    select: {
      quantity: true,
      total: true,
      lineTotalFunctional: true,
      price: true,
      product: {
        select: {
          cost: true,
          inventoryItems: {
            where: { storeId: STORE },
            select: { averageUnitCostFunctional: true },
            take: 1,
          },
        },
      },
    },
  });

  const returns = await p.saleReturnLine.findMany({
    where: {
      saleReturn: {
        storeId: STORE,
        status: 'CONFIRMED',
        createdAt: { gte: startUtc, lt: endUtc },
      },
    },
    select: {
      quantity: true,
      lineTotalFunctional: true,
      unitPriceFunctional: true,
      product: {
        select: {
          cost: true,
          price: true,
          inventoryItems: {
            where: { storeId: STORE },
            select: { averageUnitCostFunctional: true },
            take: 1,
          },
        },
      },
    },
  });

  let salesSqlCost = 0;
  let salesKpiCost = 0;
  let salesNet = 0;
  let linesUsingAvg = 0;
  let linesUsingProductCost = 0;
  let costDelta = 0;

  for (const l of lines) {
    const venta = Number(l.lineTotalFunctional ?? l.total);
    const qty = Number(l.quantity);
    const productCost = Number(l.product.cost);
    const avg = l.product.inventoryItems[0]?.averageUnitCostFunctional;
    const avgN = avg != null ? Number(avg) : null;
    const kpiUnit = avgN != null && avgN > 0 ? avgN : productCost;
    if (avgN != null && avgN > 0) linesUsingAvg += 1;
    else linesUsingProductCost += 1;

    salesNet += venta;
    salesSqlCost += qty * productCost;
    salesKpiCost += qty * kpiUnit;
    costDelta += qty * (kpiUnit - productCost);
  }

  let retNet = 0;
  let retSqlCost = 0;
  let retKpiCost = 0;
  for (const l of returns) {
    const venta = Number(
      l.lineTotalFunctional ??
        Number(l.quantity) * Number(l.unitPriceFunctional ?? l.product.price),
    );
    const qty = Number(l.quantity);
    const productCost = Number(l.product.cost);
    const avg = l.product.inventoryItems[0]?.averageUnitCostFunctional;
    const avgN = avg != null ? Number(avg) : null;
    const kpiUnit = avgN != null && avgN > 0 ? avgN : productCost;
    retNet += venta;
    retSqlCost += qty * productCost;
    retKpiCost += qty * kpiUnit;
  }

  const sqlGp = salesNet - retNet - (salesSqlCost - retSqlCost);
  const kpiGp = salesNet - retNet - (salesKpiCost - retKpiCost);

  console.log(
    JSON.stringify(
      {
        zone,
        rangeUtc: [startUtc.toISOString(), endUtc.toISOString()],
        saleLines: lines.length,
        returnLines: returns.length,
        linesUsingAvg,
        linesUsingProductCost,
        netSales: +(salesNet - retNet).toFixed(2),
        cogsProductCost_SQL: +(salesSqlCost - retSqlCost).toFixed(2),
        cogsAvgOrCost_KPI: +(salesKpiCost - retKpiCost).toFixed(2),
        extraCogsFromAvgVsProductCost: +costDelta.toFixed(2),
        ganancia_SQL_style: +sqlGp.toFixed(2),
        ganancia_KPI_style: +kpiGp.toFixed(2),
        diff_SQL_minus_KPI: +(sqlGp - kpiGp).toFixed(2),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });
