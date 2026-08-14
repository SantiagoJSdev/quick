import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  decimalToReportString,
  REPORT_SALE_STATUS,
} from '../../common/reports/report-amounts';
import { resolveReportUtcRange } from '../../common/dates/report-date-presets';
import { PrismaService } from '../../prisma/prisma.service';
import {
  inclusiveCalendarDays,
  resolveRealProfitConfig,
  sumEmployeeDaily,
  sumFixedDaily,
  type RealProfitConfig,
} from './real-profit-config';
import type { KpisSnapshotQueryDto } from './dto/kpis-snapshot-query.dto';

const DEFAULT_LOW_UNITS = new Prisma.Decimal(5);
const DEFAULT_LOW_KG = new Prisma.Decimal(3);

function isWeightUnit(unit: string): boolean {
  const u = unit.toLowerCase();
  return u.includes('kg') || u.includes('kilo');
}

function lineCost(
  qty: Prisma.Decimal,
  productCost: Prisma.Decimal,
  avgCost: Prisma.Decimal | null | undefined,
): Prisma.Decimal {
  const unit =
    avgCost != null && avgCost.gt(0) ? avgCost : productCost;
  return qty.mul(unit);
}

@Injectable()
export class KpisService {
  private readonly logger = new Logger(KpisService.name);

  constructor(private readonly prisma: PrismaService) {}

  async snapshot(storeId: string, query: KpisSnapshotQueryDto) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { timezone: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const settings = await this.prisma.businessSettings.findUnique({
      where: { storeId },
      include: { functionalCurrency: true },
    });
    if (!settings) {
      throw new NotFoundException('Business settings not found for this store');
    }

    const timezoneSource =
      store.timezone && store.timezone.trim() !== ''
        ? ('store' as const)
        : ('fallback_utc' as const);
    if (timezoneSource === 'fallback_utc') {
      this.logger.warn(
        `Store ${storeId} has null/empty timezone; KPI day bounds use UTC. Set Store.timezone=America/Caracas`,
      );
    }

    const range = resolveReportUtcRange({
      storeTimezone: store.timezone,
      preset: query.preset ?? (!query.dateFrom && !query.dateTo ? 'today' : undefined),
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });

    const zone =
      store.timezone && store.timezone.trim() !== ''
        ? store.timezone.trim()
        : 'UTC';

    const [grossProfit, payables, stockAlerts] = await Promise.all([
      this.grossProfitForRange(storeId, range.startUtc, range.endUtc, zone),
      this.payablesByDay(storeId, zone),
      this.stockAlerts(storeId),
    ]);

    const cfg = resolveRealProfitConfig(
      (settings as { realProfitConfig?: unknown }).realProfitConfig,
    );
    const realProfit = await this.realProfitForRange(
      storeId,
      range.startUtc,
      range.endUtc,
      range.meta.dateFrom,
      range.meta.dateTo,
      grossProfit,
      cfg,
      {
        timezone: range.meta.timezone,
        timezoneSource,
        rangeInterpretation: range.meta.rangeInterpretation,
        preset: range.preset ?? null,
      },
    );

    this.logger.log(
      `KPI snapshot store=${storeId} preset=${range.preset ?? 'custom'} ` +
        `tz=${range.meta.timezone}(${timezoneSource}) ` +
        `from=${range.meta.dateFrom} to=${range.meta.dateTo} ` +
        `utc=[${range.startUtc.toISOString()},${range.endUtc.toISOString()}) ` +
        `gross=${grossProfit.grossProfit} real=${realProfit.realProfit} ` +
        `deduct=${realProfit.deductions.total}`,
    );

    return {
      storeId,
      currencyCode: settings.functionalCurrency.code,
      from: range.meta.dateFrom,
      to: range.meta.dateTo,
      timezone: range.meta.timezone,
      timezoneSource,
      rangeInterpretation: range.meta.rangeInterpretation,
      rangeUtc: {
        gte: range.startUtc.toISOString(),
        lt: range.endUtc.toISOString(),
      },
      ...(range.preset ? { preset: range.preset } : {}),
      grossProfit,
      realProfit,
      payables,
      stockAlerts,
    };
  }

  /**
   * Fase 1: ganancia bruta − bolsas − platos charcutería − nómina − fijos.
   * Fijos/nómina se multiplican por días calendario del rango.
   */
  private async realProfitForRange(
    storeId: string,
    startUtc: Date,
    endUtc: Date,
    dateFrom: string,
    dateTo: string,
    gross: {
      netSales: string;
      cogs: string;
      grossProfit: string;
      marginPercent: string | null;
    },
    cfg: RealProfitConfig,
    rangeMeta: {
      timezone: string;
      timezoneSource: 'store' | 'fallback_utc';
      rangeInterpretation: string;
      preset: string | null;
    },
  ) {
    const days = inclusiveCalendarDays(dateFrom, dateTo);
    const daysDec = new Prisma.Decimal(days);
    const nowZ = DateTime.now().setZone(rangeMeta.timezone);
    const isSingleToday =
      dateFrom === dateTo && dateFrom === nowZ.toISODate();
    const dayStart = nowZ.startOf('day');
    const dayProgress = isSingleToday
      ? Math.min(1, Math.max(0, nowZ.diff(dayStart, 'days').days))
      : dateFrom === dateTo
        ? 1
        : null;

    const tickets = await this.prisma.sale.count({
      where: {
        storeId,
        status: REPORT_SALE_STATUS,
        createdAt: { gte: startUtc, lt: endUtc },
      },
    });

    const bagProduct = await this.prisma.product.findUnique({
      where: { id: cfg.bag.productId },
      select: { id: true, name: true, cost: true, sku: true },
    });
    const bagUnitCost = bagProduct
      ? bagProduct.cost.div(cfg.bag.packSize)
      : new Prisma.Decimal(0);
    const bagsEstimated = new Prisma.Decimal(tickets).mul(
      cfg.bag.ticketCoverageRate,
    );
    const bagCost = bagsEstimated.mul(bagUnitCost);

    const wrapQtyAgg = await this.prisma.saleLine.aggregate({
      where: {
        productId: { in: cfg.charcuterieWrap.productIds },
        sale: {
          storeId,
          status: REPORT_SALE_STATUS,
          createdAt: { gte: startUtc, lt: endUtc },
        },
      },
      _sum: { quantity: true },
    });
    const wrapQty = wrapQtyAgg._sum.quantity ?? new Prisma.Decimal(0);
    const wrapUnit = new Prisma.Decimal(cfg.charcuterieWrap.unitCost);
    const wrapCost = wrapQty.mul(wrapUnit);

    const payrollOneDay = sumEmployeeDaily(cfg);
    const fixedOneDay = sumFixedDaily(cfg);
    const payroll = payrollOneDay.mul(daysDec);
    const fixed = fixedOneDay.mul(daysDec);

    const grossProfit = new Prisma.Decimal(gross.grossProfit);
    const totalDeductions = bagCost.plus(wrapCost).plus(payroll).plus(fixed);
    const realProfit = grossProfit.minus(totalDeductions);
    const opsFullDay = payroll.plus(fixed);
    const warnings: string[] = [];
    if (rangeMeta.timezoneSource === 'fallback_utc') {
      warnings.push(
        'Store.timezone vacío: el día KPI se calcula en UTC (desfase vs Caracas).',
      );
    }
    if (isSingleToday && dayProgress != null && dayProgress < 0.98) {
      warnings.push(
        'Día en curso: nómina+fijos se cargan enteros (1 día) contra ventas parciales hasta ahora.',
      );
    }

    return {
      phase: '1' as const,
      calendarDays: days,
      grossProfit: gross.grossProfit,
      deductions: {
        bags: {
          tickets,
          ticketCoverageRate: cfg.bag.ticketCoverageRate,
          bagsEstimated: decimalToReportString(bagsEstimated),
          packSize: cfg.bag.packSize,
          productId: cfg.bag.productId,
          productSku: bagProduct?.sku ?? null,
          productName: bagProduct?.name ?? null,
          packCost: bagProduct ? decimalToReportString(bagProduct.cost) : null,
          unitCost: decimalToReportString(bagUnitCost),
          amount: decimalToReportString(bagCost),
        },
        charcuterieWrap: {
          productCount: cfg.charcuterieWrap.productIds.length,
          unitsSold: decimalToReportString(wrapQty),
          unitCost: cfg.charcuterieWrap.unitCost,
          amount: decimalToReportString(wrapCost),
        },
        payroll: {
          employees: cfg.employees,
          dailyTotal: decimalToReportString(payrollOneDay),
          days,
          amount: decimalToReportString(payroll),
        },
        fixed: {
          ...cfg.fixedDaily,
          dailyTotal: decimalToReportString(fixedOneDay),
          days,
          amount: decimalToReportString(fixed),
        },
        total: decimalToReportString(totalDeductions),
      },
      realProfit: decimalToReportString(realProfit),
      realMarginPercent: new Prisma.Decimal(gross.netSales).gt(0)
        ? decimalToReportString(
            realProfit.div(new Prisma.Decimal(gross.netSales)).mul(100),
          )
        : null,
      explain: {
        timezone: rangeMeta.timezone,
        timezoneSource: rangeMeta.timezoneSource,
        preset: rangeMeta.preset,
        dateFrom,
        dateTo,
        rangeUtc: {
          gte: startUtc.toISOString(),
          lt: endUtc.toISOString(),
        },
        dayProgress:
          dayProgress == null ? null : Number(dayProgress.toFixed(4)),
        opsFullDayCharged: true,
        opsFullDayAmount: decimalToReportString(opsFullDay),
        formula:
          'realProfit = grossProfit - bags - charcuterieWrap - payroll*days - fixed*days',
        warnings,
      },
    };
  }

  /** Ganancia bruta + margen % del período, con serie diaria. */
  private async grossProfitForRange(
    storeId: string,
    startUtc: Date,
    endUtc: Date,
    zone: string,
  ) {
    const saleLines = await this.prisma.saleLine.findMany({
      where: {
        sale: {
          storeId,
          status: REPORT_SALE_STATUS,
          createdAt: { gte: startUtc, lt: endUtc },
        },
      },
      select: {
        quantity: true,
        total: true,
        lineTotalFunctional: true,
        sale: { select: { createdAt: true } },
        product: {
          select: {
            cost: true,
            inventoryItems: {
              where: { storeId },
              select: { averageUnitCostFunctional: true },
              take: 1,
            },
          },
        },
      },
    });

    const returnLines = await this.prisma.saleReturnLine.findMany({
      where: {
        saleReturn: {
          storeId,
          status: REPORT_SALE_STATUS,
          createdAt: { gte: startUtc, lt: endUtc },
        },
      },
      select: {
        quantity: true,
        lineTotalFunctional: true,
        unitPriceFunctional: true,
        saleReturn: { select: { createdAt: true } },
        product: {
          select: {
            cost: true,
            price: true,
            inventoryItems: {
              where: { storeId },
              select: { averageUnitCostFunctional: true },
              take: 1,
            },
          },
        },
      },
    });

    type DayAgg = {
      netSales: Prisma.Decimal;
      cogs: Prisma.Decimal;
    };
    const byDay = new Map<string, DayAgg>();

    const bump = (day: string, net: Prisma.Decimal, cogs: Prisma.Decimal) => {
      const cur = byDay.get(day) ?? {
        netSales: new Prisma.Decimal(0),
        cogs: new Prisma.Decimal(0),
      };
      cur.netSales = cur.netSales.plus(net);
      cur.cogs = cur.cogs.plus(cogs);
      byDay.set(day, cur);
    };

    let netSales = new Prisma.Decimal(0);
    let cogs = new Prisma.Decimal(0);

    for (const sl of saleLines) {
      const revenue =
        sl.lineTotalFunctional ??
        sl.total ??
        sl.quantity.mul(0);
      const avg = sl.product.inventoryItems[0]?.averageUnitCostFunctional;
      const cost = lineCost(sl.quantity, sl.product.cost, avg);
      netSales = netSales.plus(revenue);
      cogs = cogs.plus(cost);
      const day = DateTime.fromJSDate(sl.sale.createdAt, { zone: 'utc' })
        .setZone(zone)
        .toISODate()!;
      bump(day, revenue, cost);
    }

    for (const rl of returnLines) {
      const revenue =
        rl.lineTotalFunctional ??
        rl.quantity.mul(
          rl.unitPriceFunctional ?? rl.product.price,
        );
      const avg = rl.product.inventoryItems[0]?.averageUnitCostFunctional;
      const cost = lineCost(rl.quantity, rl.product.cost, avg);
      netSales = netSales.minus(revenue);
      cogs = cogs.minus(cost);
      const day = DateTime.fromJSDate(rl.saleReturn.createdAt, { zone: 'utc' })
        .setZone(zone)
        .toISODate()!;
      bump(day, revenue.neg(), cost.neg());
    }

    const grossProfit = netSales.minus(cogs);
    const marginPercent = netSales.gt(0)
      ? grossProfit.div(netSales).mul(100)
      : null;

    const byDaySorted = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        const gp = v.netSales.minus(v.cogs);
        return {
          date,
          netSales: decimalToReportString(v.netSales),
          cogs: decimalToReportString(v.cogs),
          grossProfit: decimalToReportString(gp),
          marginPercent: v.netSales.gt(0)
            ? decimalToReportString(gp.div(v.netSales).mul(100))
            : null,
        };
      });

    return {
      netSales: decimalToReportString(netSales),
      cogs: decimalToReportString(cogs),
      grossProfit: decimalToReportString(grossProfit),
      marginPercent:
        marginPercent != null ? decimalToReportString(marginPercent) : null,
      byDay: byDaySorted,
    };
  }

  /**
   * Deuda abierta actual, agrupada por día de vencimiento (dueDate).
   * Sin dueDate → bucket `sin_vencimiento`.
   */
  private async payablesByDay(storeId: string, zone: string) {
    const open = await this.prisma.purchase.findMany({
      where: {
        storeId,
        status: 'RECEIVED',
        paymentStatus: { in: ['CREDIT', 'PARTIAL'] },
        amountDueFunctional: { gt: 0 },
      },
      select: {
        id: true,
        dueDate: true,
        amountDueFunctional: true,
        supplierInvoiceReference: true,
        supplier: { select: { id: true, name: true } },
        createdAt: true,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });

    const today = DateTime.now().setZone(zone).startOf('day');
    let totalDue = new Prisma.Decimal(0);
    let overdue = new Prisma.Decimal(0);
    let dueToday = new Prisma.Decimal(0);
    let dueNext7 = new Prisma.Decimal(0);
    let laterOrNone = new Prisma.Decimal(0);

    type DayBucket = {
      date: string | null;
      amountDueFunctional: Prisma.Decimal;
      invoiceCount: number;
    };
    const days = new Map<string, DayBucket>();

    for (const p of open) {
      const due = p.amountDueFunctional;
      totalDue = totalDue.plus(due);

      let key: string;
      if (!p.dueDate) {
        key = 'sin_vencimiento';
        laterOrNone = laterOrNone.plus(due);
      } else {
        const dueLocal = DateTime.fromJSDate(p.dueDate, { zone: 'utc' })
          .setZone(zone)
          .startOf('day');
        key = dueLocal.toISODate()!;
        if (dueLocal < today) {
          overdue = overdue.plus(due);
        } else if (dueLocal.hasSame(today, 'day')) {
          dueToday = dueToday.plus(due);
        } else if (dueLocal <= today.plus({ days: 7 })) {
          dueNext7 = dueNext7.plus(due);
        } else {
          laterOrNone = laterOrNone.plus(due);
        }
      }

      const cur = days.get(key) ?? {
        date: key === 'sin_vencimiento' ? null : key,
        amountDueFunctional: new Prisma.Decimal(0),
        invoiceCount: 0,
      };
      cur.amountDueFunctional = cur.amountDueFunctional.plus(due);
      cur.invoiceCount += 1;
      days.set(key, cur);
    }

    const byDay = [...days.entries()]
      .sort(([a], [b]) => {
        if (a === 'sin_vencimiento') return 1;
        if (b === 'sin_vencimiento') return -1;
        return a.localeCompare(b);
      })
      .map(([, v]) => ({
        date: v.date,
        amountDueFunctional: decimalToReportString(v.amountDueFunctional),
        invoiceCount: v.invoiceCount,
      }));

    return {
      asOf: today.toISODate(),
      totalDueFunctional: decimalToReportString(totalDue),
      openInvoiceCount: open.length,
      aging: {
        overdue: decimalToReportString(overdue),
        dueToday: decimalToReportString(dueToday),
        dueNext7Days: decimalToReportString(dueNext7),
        laterOrNoDueDate: decimalToReportString(laterOrNone),
      },
      byDay,
    };
  }

  /** Stock negativo + stock bajo (minStock o umbral default). */
  private async stockAlerts(storeId: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        storeId,
        product: { active: true },
      },
      select: {
        quantity: true,
        reserved: true,
        minStock: true,
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            unit: true,
          },
        },
      },
    });

    const negatives: Array<{
      productId: string;
      sku: string;
      name: string;
      unit: string;
      quantity: string;
      available: string;
    }> = [];
    const lowList: Array<{
      productId: string;
      sku: string;
      name: string;
      unit: string;
      quantity: string;
      available: string;
      threshold: string;
    }> = [];

    for (const it of items) {
      const available = it.quantity.minus(it.reserved);
      if (it.quantity.lt(0) || available.lt(0)) {
        negatives.push({
          productId: it.product.id,
          sku: it.product.sku,
          name: it.product.name,
          unit: it.product.unit,
          quantity: decimalToReportString(it.quantity),
          available: decimalToReportString(available),
        });
        continue;
      }

      const threshold =
        it.minStock.gt(0)
          ? it.minStock
          : isWeightUnit(it.product.unit)
            ? DEFAULT_LOW_KG
            : DEFAULT_LOW_UNITS;

      if (available.lt(threshold)) {
        lowList.push({
          productId: it.product.id,
          sku: it.product.sku,
          name: it.product.name,
          unit: it.product.unit,
          quantity: decimalToReportString(it.quantity),
          available: decimalToReportString(available),
          threshold: decimalToReportString(threshold),
        });
      }
    }

    negatives.sort((a, b) => a.name.localeCompare(b.name));
    lowList.sort((a, b) => a.name.localeCompare(b.name));

    return {
      negativeCount: negatives.length,
      lowCount: lowList.length,
      defaults: {
        lowUnits: decimalToReportString(DEFAULT_LOW_UNITS),
        lowKg: decimalToReportString(DEFAULT_LOW_KG),
      },
      negatives: negatives.slice(0, 100),
      low: lowList.slice(0, 100),
    };
  }
}
