const { PrismaClient } = require('@prisma/client');
const { DateTime } = require('luxon');

const p = new PrismaClient();
const STORE = '0b54c944-28ba-4542-991a-4840c4801906';

async function main() {
  const store = await p.store.findUnique({
    where: { id: STORE },
    select: { timezone: true, name: true },
  });
  const zone = (store.timezone && store.timezone.trim()) || 'UTC';
  const now = DateTime.now().setZone(zone);
  const today = now.startOf('day');
  const yest = today.minus({ days: 1 });

  function bounds(day) {
    return {
      s: day.startOf('day').toUTC().toJSDate(),
      next: day.plus({ days: 1 }).startOf('day').toUTC().toJSDate(),
      endOfDay: day.endOf('day').toUTC().toJSDate(),
      localFrom: day.toISO(),
    };
  }

  const t = bounds(today);
  const y = bounds(yest);

  async function sales(label, s, e) {
    const rows = await p.sale.findMany({
      where: {
        storeId: STORE,
        status: 'CONFIRMED',
        createdAt: { gte: s, lt: e },
      },
      select: { id: true, total: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const lines = await p.saleLine.findMany({
      where: {
        sale: {
          storeId: STORE,
          status: 'CONFIRMED',
          createdAt: { gte: s, lt: e },
        },
      },
      select: {
        quantity: true,
        total: true,
        lineTotalFunctional: true,
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
    let net = 0;
    let cogs = 0;
    for (const l of lines) {
      const saleAmt = Number(l.lineTotalFunctional ?? l.total);
      const avg = l.product.inventoryItems[0]?.averageUnitCostFunctional;
      const unit =
        avg != null && Number(avg) > 0 ? Number(avg) : Number(l.product.cost);
      net += saleAmt;
      cogs += Number(l.quantity) * unit;
    }
    return {
      label,
      tickets: rows.length,
      net: net.toFixed(2),
      cogs: cogs.toFixed(2),
      gp: (net - cogs).toFixed(2),
      first: rows[0]?.createdAt?.toISOString() ?? null,
      last: rows[rows.length - 1]?.createdAt?.toISOString() ?? null,
    };
  }

  // Same filter style as KPI service uses today (endOf day + lt)
  const stodayKpiStyle = await sales('today_kpi_endOfDay_lt', t.s, t.endOfDay);
  const syestKpiStyle = await sales('yesterday_kpi_endOfDay_lt', y.s, y.endOfDay);
  const stoday = await sales('today_nextMidnight_lt', t.s, t.next);
  const syest = await sales('yesterday_nextMidnight_lt', y.s, y.next);

  const payroll = 11.66 + 8.33 + 4.16;
  const fixed = 1.46 + 2.5 + 4.41;
  const dailyOps = payroll + fixed;
  const dayFrac = now.diff(today, 'days').days;

  // status check: what statuses exist
  const statuses = await p.sale.groupBy({
    by: ['status'],
    where: {
      storeId: STORE,
      createdAt: { gte: y.s, lt: t.next },
    },
    _count: { _all: true },
  });

  console.log(
    JSON.stringify(
      {
        store,
        zone,
        nowLocal: now.toISO(),
        dayProgress: Number(dayFrac.toFixed(4)),
        ranges: {
          today: {
            utcStart: t.s.toISOString(),
            utcEndOfDay: t.endOfDay.toISOString(),
            utcNextMidnight: t.next.toISOString(),
            localStart: t.localFrom,
          },
          yesterday: {
            utcStart: y.s.toISOString(),
            utcEndOfDay: y.endOfDay.toISOString(),
            utcNextMidnight: y.next.toISOString(),
            localStart: y.localFrom,
          },
        },
        saleStatusesLast2Days: statuses,
        sales: {
          todayNextMidnight: stoday,
          yesterdayNextMidnight: syest,
          todayKpiStyle: stodayKpiStyle,
          yesterdayKpiStyle: syestKpiStyle,
        },
        opsDaily: { payroll, fixed, total: dailyOps },
        realApproxFullDayOps: {
          today: (Number(stoday.gp) - dailyOps).toFixed(2),
          yesterday: (Number(syest.gp) - dailyOps).toFixed(2),
          todayIfProrated: (Number(stoday.gp) - dailyOps * dayFrac).toFixed(2),
        },
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
