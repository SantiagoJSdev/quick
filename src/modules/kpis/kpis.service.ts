import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  decimalToReportString,
  REPORT_SALE_STATUS,
} from '../../common/reports/report-amounts';
import { convertAmountDocumentToFunctional } from '../../common/fx/convert-amount';
import {
  inventoryValuationFunctional,
  operationalUnitCostFunctional,
} from '../../common/inventory/operational-unit-cost';
import {
  frozenCostMapFromSnapshot,
  frozenSkuCostsPayload,
  frozenUnitCostForProduct,
  type FrozenSkuCostLine,
} from '../../common/kpis/frozen-catalog-costs';
import { saleLineCogsFunctional } from '../../common/sales/sale-line-cogs';
import { resolveReportUtcRange } from '../../common/dates/report-date-presets';
import { PrismaService } from '../../prisma/prisma.service';
import {
  calendarDateUtcMidnight,
  listInclusiveYmd,
  resolveCapitalSeriesCalendarRange,
  storeZone,
  ymdFromPrismaDate,
  type CapitalSnapshotSource,
} from './capital-snapshot.util';
import { GASTO_REPLENISH_RESERVE_PERCENT } from './gasto-constants';
import {
  inclusiveCalendarDays,
  resolveRealProfitConfig,
  sumEmployeeDaily,
  sumFixedDaily,
  type RealProfitConfig,
} from './real-profit-config';
import type { KpisCapitalSeriesQueryDto } from './dto/kpis-capital-series-query.dto';
import type { KpisSnapshotQueryDto } from './dto/kpis-snapshot-query.dto';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { resolveSaleListUtcRange } from '../sales/sales-list-range';

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
  return qty.mul(operationalUnitCostFunctional(productCost, avgCost));
}

function returnLineCogs(
  rl: {
    quantity: Prisma.Decimal;
    saleLine: { unitCostFunctional: Prisma.Decimal | null } | null;
  },
  fallbackCatalogCost: Prisma.Decimal,
): Prisma.Decimal {
  if (rl.saleLine?.unitCostFunctional != null) {
    return saleLineCogsFunctional(
      rl.quantity,
      rl.saleLine.unitCostFunctional,
      fallbackCatalogCost,
    );
  }
  return lineCost(rl.quantity, fallbackCatalogCost, null);
}

@Injectable()
export class KpisService {
  private readonly logger = new Logger(KpisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentMethods: PaymentMethodsService,
  ) {}

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

    const frozenCostsByDay = await this.loadFrozenCostMapsForDays(
      storeId,
      listInclusiveYmd(range.meta.dateFrom, range.meta.dateTo),
    );

    const [grossProfit, payables, stockAlerts, capital] = await Promise.all([
      this.grossProfitForRange(
        storeId,
        range.startUtc,
        range.endUtc,
        zone,
        frozenCostsByDay,
      ),
      this.payablesByDay(storeId, zone),
      this.stockAlerts(storeId),
      this.capitalLive(storeId, zone),
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

    const cashAvailable = await this.cashAvailableToday(
      storeId,
      zone,
      timezoneSource,
      cfg,
      {
        dateFrom: range.meta.dateFrom,
        dateTo: range.meta.dateTo,
        realProfit: realProfit.realProfit,
      },
    );

    this.logger.log(
      `KPI snapshot store=${storeId} preset=${range.preset ?? 'custom'} ` +
        `tz=${range.meta.timezone}(${timezoneSource}) ` +
        `from=${range.meta.dateFrom} to=${range.meta.dateTo} ` +
        `utc=[${range.startUtc.toISOString()},${range.endUtc.toISOString()}) ` +
        `gross=${grossProfit.grossProfit} real=${realProfit.realProfit} ` +
        `deduct=${realProfit.deductions.total} ` +
        `cashAvail=${cashAvailable.amount} suggest=${cashAvailable.suggestedWithdraw}`,
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
      capital,
      cashAvailable,
      payables,
      stockAlerts,
    };
  }

  /**
   * Foto del día: inventario/deuda **ahora**; P&L, merma, compras y abonos de `dateYmd`.
   * LAZY no pisa una fila existente (la foto oficial es el cierre de caja).
   */
  async upsertCapitalSnapshot(
    storeId: string,
    dateYmd: string,
    source: CapitalSnapshotSource,
  ) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { timezone: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const zone = storeZone(store.timezone);
    const todayYmd = DateTime.now().setZone(zone).toISODate()!;
    if (dateYmd > todayYmd) {
      throw new BadRequestException(
        'date cannot be in the future (store timezone)',
      );
    }

    const date = calendarDateUtcMidnight(dateYmd);
    if (source === 'LAZY') {
      const existing = await this.prisma.storeCapitalSnapshot.findUnique({
        where: { storeId_date: { storeId, date } },
      });
      if (existing) {
        return this.toPublicCapitalSnapshot(existing);
      }
    }

    const photo = await this.computeCapitalPhoto(storeId, dateYmd, zone);
    const row = await this.prisma.storeCapitalSnapshot.upsert({
      where: { storeId_date: { storeId, date } },
      create: {
        storeId,
        date,
        source,
        capturedAt: new Date(),
        ...photo,
      },
      update: {
        source,
        capturedAt: new Date(),
        ...photo,
      },
    });

    this.logger.log(
      `Capital snapshot ${source} store=${storeId} date=${dateYmd} ` +
        `equity=${photo.netInventoryEquity} real=${photo.realProfit}`,
    );
    return this.toPublicCapitalSnapshot(row);
  }

  /** Default = ayer Caracas. Inventario/deuda se fotografían ahora. */
  async runCapitalSnapshot(storeId: string, dateYmd?: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { timezone: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    const zone = storeZone(store.timezone);
    const today = DateTime.now().setZone(zone).startOf('day');
    const date = dateYmd?.trim()
      ? dateYmd.trim()
      : today.minus({ days: 1 }).toISODate()!;
    const snapshot = await this.upsertCapitalSnapshot(storeId, date, 'MANUAL');
    return {
      storeId,
      timezone: zone,
      date,
      source: 'MANUAL' as const,
      snapshot,
    };
  }

  /**
   * Cierre de caja: upsert de **hoy** (zona tienda). El caller no debe fallar el close.
   */
  async captureTodayOnCashClose(storeId: string): Promise<{
    date: string;
    ok: true;
    netInventoryEquity: string;
  }> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { timezone: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    const date = DateTime.now().setZone(storeZone(store.timezone)).toISODate()!;
    const snapshot = await this.upsertCapitalSnapshot(
      storeId,
      date,
      'CASH_CLOSE',
    );
    return {
      date,
      ok: true,
      netInventoryEquity: snapshot.netInventoryEquity,
    };
  }

  async capitalSeries(storeId: string, query: KpisCapitalSeriesQueryDto) {
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
        `Store ${storeId} has null/empty timezone; capital-series uses UTC`,
      );
    }

    const zone = storeZone(store.timezone);
    const { dateFrom, dateTo, preset } = resolveCapitalSeriesCalendarRange({
      storeTimezone: store.timezone,
      preset: query.preset,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });

    const yesterday = DateTime.now()
      .setZone(zone)
      .minus({ days: 1 })
      .toISODate()!;
    let lazyYesterday = false;
    try {
      const before = await this.prisma.storeCapitalSnapshot.findUnique({
        where: {
          storeId_date: {
            storeId,
            date: calendarDateUtcMidnight(yesterday),
          },
        },
        select: { id: true },
      });
      if (!before) {
        await this.upsertCapitalSnapshot(storeId, yesterday, 'LAZY');
        lazyYesterday = true;
      }
    } catch (err) {
      this.logger.warn(
        `Lazy capital snapshot for yesterday failed store=${storeId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    const prevDay = DateTime.fromISO(dateFrom, { zone: 'utc' })
      .minus({ days: 1 })
      .toISODate()!;
    const rows = await this.prisma.storeCapitalSnapshot.findMany({
      where: {
        storeId,
        date: {
          gte: calendarDateUtcMidnight(prevDay),
          lte: calendarDateUtcMidnight(dateTo),
        },
      },
      orderBy: { date: 'asc' },
    });

    const byDate = new Map(rows.map((r) => [ymdFromPrismaDate(r.date), r]));
    const cfg = resolveRealProfitConfig(
      (settings as { realProfitConfig?: unknown }).realProfitConfig,
    );

    const daysInRange = listInclusiveYmd(dateFrom, dateTo);
    const missingDates = daysInRange.filter((d) => !byDate.has(d));

    const items: Array<{
      date: string;
      inventoryCapital: string;
      payablesDue: string;
      netInventoryEquity: string;
      realProfit: string;
      lossCostFunctional: string;
      purchasesFunctional: string;
      supplierPayments: string;
      deltaEquity: string | null;
      source: string;
      capturedAt: string;
    }> = [];

    for (const ymd of daysInRange) {
      const row = byDate.get(ymd);
      if (!row) continue;

      const prev = byDate.get(
        DateTime.fromISO(ymd, { zone: 'utc' }).minus({ days: 1 }).toISODate()!,
      );
      const deltaEquity =
        prev != null
          ? decimalToReportString(
              row.netInventoryEquity.minus(prev.netInventoryEquity),
            )
          : null;

      let realProfit = decimalToReportString(row.realProfit);
      let lossCostFunctional = decimalToReportString(row.lossCostFunctional);
      try {
        const recomputed = await this.recomputeRealProfitForDay(
          storeId,
          ymd,
          zone,
          timezoneSource,
          cfg,
        );
        realProfit = recomputed.realProfit;
        lossCostFunctional = recomputed.lossCostFunctional;
      } catch (err) {
        this.logger.warn(
          `Recompute realProfit for ${ymd} failed store=${storeId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }

      items.push({
        date: ymd,
        inventoryCapital: decimalToReportString(row.inventoryCapital),
        payablesDue: decimalToReportString(row.payablesDue),
        netInventoryEquity: decimalToReportString(row.netInventoryEquity),
        realProfit,
        lossCostFunctional,
        purchasesFunctional: decimalToReportString(row.purchasesFunctional),
        supplierPayments: decimalToReportString(row.supplierPayments),
        deltaEquity,
        source: row.source,
        capturedAt: row.capturedAt.toISOString(),
      });
    }

    return {
      storeId,
      currencyCode: settings.functionalCurrency.code,
      timezone: zone,
      timezoneSource,
      from: dateFrom,
      to: dateTo,
      ...(preset ? { preset } : {}),
      lazyYesterday,
      missingDates,
      items,
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

    const lossAgg = await this.prisma.stockMovement.aggregate({
      where: {
        storeId,
        type: 'OUT_LOSS',
        createdAt: { gte: startUtc, lt: endUtc },
      },
      _sum: { totalCostFunctional: true },
      _count: { _all: true },
    });
    const lossCost = lossAgg._sum.totalCostFunctional ?? new Prisma.Decimal(0);
    const lossCount = lossAgg._count._all;

    const commissionRows = await this.prisma.salePayment.findMany({
      where: {
        sale: {
          storeId,
          status: REPORT_SALE_STATUS,
          createdAt: { gte: startUtc, lt: endUtc },
        },
      },
      select: {
        id: true,
        commissionFunctional: true,
      } as { id: true; commissionFunctional: true },
    });
    let paymentCommissions = new Prisma.Decimal(0);
    for (const row of commissionRows as Array<{
      commissionFunctional: Prisma.Decimal | null;
    }>) {
      if (row.commissionFunctional != null) {
        paymentCommissions = paymentCommissions.plus(row.commissionFunctional);
      }
    }
    const paymentCommissionCount = commissionRows.length;

    const payrollOneDay = sumEmployeeDaily(cfg);
    const fixedOneDay = sumFixedDaily(cfg);
    const payroll = payrollOneDay.mul(daysDec);
    const fixed = fixedOneDay.mul(daysDec);

    const grossProfit = new Prisma.Decimal(gross.grossProfit);
    const totalDeductions = bagCost
      .plus(wrapCost)
      .plus(payroll)
      .plus(fixed)
      .plus(lossCost)
      .plus(paymentCommissions);
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
        losses: {
          amount: decimalToReportString(lossCost),
          movementCount: lossCount,
        },
        paymentCommissions: {
          amount: decimalToReportString(paymentCommissions),
          paymentCount: paymentCommissionCount,
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
          'realProfit = grossProfit - bags - charcuterieWrap - payroll*days - fixed*days - losses - paymentCommissions',
        warnings,
      },
    };
  }

  /**
   * Capital operativo ahora: inventario a costo − deuda abierta + merma de hoy (Caracas).
   */
  private async capitalLive(storeId: string, zone: string) {
    const today = DateTime.now().setZone(zone).toISODate();
    const todayBounds = resolveSaleListUtcRange(zone, today!, today!);

    const [equity, lossToday] = await Promise.all([
      this.inventoryEquityNow(storeId),
      this.prisma.stockMovement.aggregate({
        where: {
          storeId,
          type: 'OUT_LOSS',
          createdAt: { gte: todayBounds.startUtc, lt: todayBounds.endUtc },
        },
        _sum: { totalCostFunctional: true },
        _count: { _all: true },
      }),
    ]);

    const lossCostToday =
      lossToday._sum.totalCostFunctional ?? new Prisma.Decimal(0);

    return {
      inventoryCapital: decimalToReportString(equity.inventoryCapital),
      payablesDue: decimalToReportString(equity.payablesDue),
      netInventoryEquity: decimalToReportString(equity.netInventoryEquity),
      lossCostToday: decimalToReportString(lossCostToday),
      lossMovementCountToday: lossToday._count._all,
    };
  }

  /**
   * Disponible para sacar (siempre **hoy** en zona tienda, no sigue preset).
   * No registra retiro; solo guía de caja.
   */
  private async cashAvailableToday(
    storeId: string,
    zone: string,
    timezoneSource: 'store' | 'fallback_utc',
    cfg: RealProfitConfig,
    rangeReal: { dateFrom: string; dateTo: string; realProfit: string },
  ) {
    const todayYmd = DateTime.now().setZone(zone).toISODate()!;
    const estimate = await this.estimateCashForDay(storeId, todayYmd, zone);

    let realProfitToday = rangeReal.realProfit;
    if (rangeReal.dateFrom !== todayYmd || rangeReal.dateTo !== todayYmd) {
      const bounds = resolveSaleListUtcRange(zone, todayYmd, todayYmd);
      const gross = await this.grossProfitForRange(
        storeId,
        bounds.startUtc,
        bounds.endUtc,
        zone,
        await this.loadFrozenCostMapsForDays(storeId, [todayYmd]),
      );
      const real = await this.realProfitForRange(
        storeId,
        bounds.startUtc,
        bounds.endUtc,
        todayYmd,
        todayYmd,
        gross,
        cfg,
        {
          timezone: bounds.meta.timezone,
          timezoneSource,
          rangeInterpretation: bounds.meta.rangeInterpretation,
          preset: 'today',
        },
      );
      realProfitToday = real.realProfit;
    }

    const realDec = new Prisma.Decimal(realProfitToday);
    const realNonNeg = realDec.gt(0) ? realDec : new Prisma.Decimal(0);
    const suggested = Prisma.Decimal.min(realNonNeg, estimate.amount);

    return {
      asOf: todayYmd,
      cashCollected: decimalToReportString(estimate.cashCollected),
      supplierPayments: decimalToReportString(estimate.supplierPayments),
      cashNet: decimalToReportString(estimate.cashNet),
      replenishReservePercent: estimate.replenishReservePercent,
      replenishReserve: decimalToReportString(estimate.replenishReserve),
      amount: decimalToReportString(estimate.amount),
      realProfitToday: decimalToReportString(realDec),
      suggestedWithdraw: decimalToReportString(suggested),
      explain: {
        cashLikeMethods: estimate.cashLikeMethods,
        formula:
          'suggestedWithdraw = min(max(0, realProfitToday), max(0, cashCollected - supplierPayments - reserve))',
        note: 'Solo guía de caja; no registra el retiro del dueño ni mueve inventario.',
      },
    };
  }

  private async estimateCashForDay(
    storeId: string,
    dateYmd: string,
    zone: string,
  ) {
    const bounds = resolveSaleListUtcRange(zone, dateYmd, dateYmd);
    const reservePct = new Prisma.Decimal(GASTO_REPLENISH_RESERVE_PERCENT);

    const methodMap = await this.paymentMethods.activeCommissionMap(storeId);
    const cashLikeMethods: string[] = [];
    methodMap.forEach(
      (
        m: {
          code: string;
          commissionPercent: Prisma.Decimal;
          isCashLike: boolean;
          name: string;
        },
        code: string,
      ) => {
        if (m.isCashLike) {
          cashLikeMethods.push(code);
        }
      },
    );

    const [payments, supplierAgg, settings] = await Promise.all([
      cashLikeMethods.length === 0
        ? Promise.resolve([])
        : this.prisma.salePayment.findMany({
            where: {
              method: { in: cashLikeMethods },
              sale: {
                storeId,
                status: REPORT_SALE_STATUS,
                createdAt: { gte: bounds.startUtc, lt: bounds.endUtc },
              },
            },
            select: {
              amount: true,
              currencyCode: true,
              amountDocumentCurrency: true,
              amountFunctional: true,
              sale: {
                select: {
                  documentCurrencyCode: true,
                  functionalCurrencyCode: true,
                  fxBaseCurrencyCode: true,
                  fxQuoteCurrencyCode: true,
                  fxRateQuotePerBase: true,
                },
              },
            } as {
              amount: true;
              currencyCode: true;
              amountDocumentCurrency: true;
              amountFunctional: true;
              sale: {
                select: {
                  documentCurrencyCode: true;
                  functionalCurrencyCode: true;
                  fxBaseCurrencyCode: true;
                  fxQuoteCurrencyCode: true;
                  fxRateQuotePerBase: true;
                };
              };
            },
          }),
      this.prisma.purchasePayment.aggregate({
        where: {
          storeId,
          reversedAt: null,
          paidAt: { gte: bounds.startUtc, lt: bounds.endUtc },
        },
        _sum: { amountFunctional: true },
      }),
      this.prisma.businessSettings.findUnique({
        where: { storeId },
        include: { functionalCurrency: true },
      }),
    ]);

    const funcCode =
      settings?.functionalCurrency.code.toUpperCase() ?? 'USD';

    let cashCollected = new Prisma.Decimal(0);
    for (const p of payments) {
      cashCollected = cashCollected.plus(
        this.salePaymentAmountFunctional(p, funcCode),
      );
    }

    const supplierPayments =
      supplierAgg._sum.amountFunctional ?? new Prisma.Decimal(0);
    const cashNet = cashCollected.minus(supplierPayments);
    const replenishReserve = cashNet.gt(0)
      ? cashNet.mul(reservePct).div(100)
      : new Prisma.Decimal(0);
    const amount = Prisma.Decimal.max(
      0,
      cashNet.minus(replenishReserve),
    );

    return {
      cashLikeMethods,
      cashCollected,
      supplierPayments,
      cashNet,
      replenishReservePercent: decimalToReportString(reservePct),
      replenishReserve,
      amount,
    };
  }

  private salePaymentAmountFunctional(
    p: {
      amount: Prisma.Decimal;
      currencyCode: string;
      amountDocumentCurrency: Prisma.Decimal;
      amountFunctional: Prisma.Decimal | null;
      sale: {
        documentCurrencyCode: string | null;
        functionalCurrencyCode: string | null;
        fxBaseCurrencyCode: string | null;
        fxQuoteCurrencyCode: string | null;
        fxRateQuotePerBase: Prisma.Decimal | null;
      };
    },
    funcCode: string,
  ): Prisma.Decimal {
    if (p.amountFunctional != null) {
      return p.amountFunctional;
    }
    const saleFunc =
      p.sale.functionalCurrencyCode?.toUpperCase() ?? funcCode;
    if (p.currencyCode.toUpperCase() === saleFunc) {
      return p.amount;
    }
    const docCode = (
      p.sale.documentCurrencyCode?.toUpperCase() ?? saleFunc
    );
    if (docCode === saleFunc) {
      return p.amountDocumentCurrency;
    }
    const base = p.sale.fxBaseCurrencyCode?.toUpperCase();
    const quote = p.sale.fxQuoteCurrencyCode?.toUpperCase();
    const rate = p.sale.fxRateQuotePerBase;
    if (!base || !quote || rate == null) {
      return p.amountDocumentCurrency;
    }
    return convertAmountDocumentToFunctional(
      p.amountDocumentCurrency,
      docCode,
      saleFunc,
      base,
      quote,
      rate,
    );
  }

  private async inventoryEquityLines(storeId: string): Promise<{
    inventoryCapital: Prisma.Decimal;
    skuLines: FrozenSkuCostLine[];
  }> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        storeId,
        quantity: { gt: 0 },
        product: { active: true },
      },
      select: {
        quantity: true,
        product: {
          select: { id: true, sku: true, name: true, cost: true },
        },
      },
    });

    let inventoryCapital = new Prisma.Decimal(0);
    const skuLines: FrozenSkuCostLine[] = [];
    for (const row of items) {
      const valued = inventoryValuationFunctional(
        row.quantity,
        row.product.cost,
        null,
      );
      inventoryCapital = inventoryCapital.plus(valued.totalCost);
      skuLines.push({
        productId: row.product.id,
        sku: row.product.sku,
        name: row.product.name,
        quantity: decimalToReportString(row.quantity),
        unitCostFunctional: decimalToReportString(valued.unitCost),
        totalCostFunctional: decimalToReportString(valued.totalCost),
      });
    }
    return { inventoryCapital, skuLines };
  }

  private async inventoryEquityNow(storeId: string) {
    const [inv, payAgg] = await Promise.all([
      this.inventoryEquityLines(storeId),
      this.prisma.purchase.aggregate({
        where: {
          storeId,
          status: 'RECEIVED',
          paymentStatus: { in: ['CREDIT', 'PARTIAL'] },
          amountDueFunctional: { gt: 0 },
        },
        _sum: { amountDueFunctional: true },
      }),
    ]);

    const payablesDue =
      payAgg._sum.amountDueFunctional ?? new Prisma.Decimal(0);
    return {
      inventoryCapital: inv.inventoryCapital,
      skuLines: inv.skuLines,
      payablesDue,
      netInventoryEquity: inv.inventoryCapital.minus(payablesDue),
    };
  }

  private async loadFrozenCostMapsForDays(
    storeId: string,
    days: string[],
  ): Promise<Map<string, Map<string, Prisma.Decimal>>> {
    const unique = [...new Set(days.filter((d) => d.trim() !== ''))];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.storeCapitalSnapshot.findMany({
      where: {
        storeId,
        date: { in: unique.map((d) => calendarDateUtcMidnight(d)) },
      },
      select: { date: true, inventorySkuCosts: true },
    });
    const result = new Map<string, Map<string, Prisma.Decimal>>();
    for (const row of rows) {
      result.set(
        ymdFromPrismaDate(row.date),
        frozenCostMapFromSnapshot(row.inventorySkuCosts),
      );
    }
    return result;
  }

  private async computeCapitalPhoto(
    storeId: string,
    dateYmd: string,
    zone: string,
  ) {
    const settings = await this.prisma.businessSettings.findUnique({
      where: { storeId },
    });
    if (!settings) {
      throw new NotFoundException('Business settings not found for this store');
    }

    const timezoneSource =
      zone === 'UTC' ? ('fallback_utc' as const) : ('store' as const);
    const bounds = resolveSaleListUtcRange(zone, dateYmd, dateYmd);

    const [equity, gross, purchasesRows, paymentsAgg] = await Promise.all([
      this.inventoryEquityNow(storeId),
      this.grossProfitForRange(
        storeId,
        bounds.startUtc,
        bounds.endUtc,
        zone,
        await this.loadFrozenCostMapsForDays(storeId, [dateYmd]),
      ),
      this.prisma.purchase.findMany({
        where: {
          storeId,
          status: 'RECEIVED',
          dateReceived: { gte: bounds.startUtc, lt: bounds.endUtc },
        },
        select: { totalFunctional: true, total: true },
      }),
      this.prisma.purchasePayment.aggregate({
        where: {
          storeId,
          reversedAt: null,
          paidAt: { gte: bounds.startUtc, lt: bounds.endUtc },
        },
        _sum: { amountFunctional: true },
      }),
    ]);

    const cfg = resolveRealProfitConfig(
      (settings as { realProfitConfig?: unknown }).realProfitConfig,
    );
    const real = await this.realProfitForRange(
      storeId,
      bounds.startUtc,
      bounds.endUtc,
      dateYmd,
      dateYmd,
      gross,
      cfg,
      {
        timezone: bounds.meta.timezone,
        timezoneSource,
        rangeInterpretation: bounds.meta.rangeInterpretation,
        preset: null,
      },
    );

    let purchasesFunctional = new Prisma.Decimal(0);
    for (const p of purchasesRows) {
      purchasesFunctional = purchasesFunctional.plus(
        p.totalFunctional ?? p.total,
      );
    }
    const supplierPayments =
      paymentsAgg._sum.amountFunctional ?? new Prisma.Decimal(0);
    const lossCost = new Prisma.Decimal(real.deductions.losses.amount);
    const paymentCommissions = new Prisma.Decimal(
      real.deductions.paymentCommissions.amount,
    );

    const cashEst = await this.estimateCashForDay(storeId, dateYmd, zone);
    const realDec = new Prisma.Decimal(real.realProfit);
    const realNonNeg = realDec.gt(0) ? realDec : new Prisma.Decimal(0);
    const suggested = Prisma.Decimal.min(realNonNeg, cashEst.amount);

    return {
      inventoryCapital: equity.inventoryCapital,
      payablesDue: equity.payablesDue,
      netInventoryEquity: equity.netInventoryEquity,
      inventorySkuCosts: frozenSkuCostsPayload(
        equity.skuLines,
      ) as unknown as Prisma.InputJsonValue,
      netSales: new Prisma.Decimal(gross.netSales),
      cogs: new Prisma.Decimal(gross.cogs),
      grossProfit: new Prisma.Decimal(gross.grossProfit),
      realProfit: realDec,
      realProfitDeductions: real.deductions as unknown as Prisma.InputJsonValue,
      purchasesFunctional,
      supplierPayments,
      lossCostFunctional: lossCost,
      paymentCommissions,
      cashBalanceEst: cashEst.cashNet,
      cashAvailableEst: suggested,
    };
  }

  private async recomputeRealProfitForDay(
    storeId: string,
    dateYmd: string,
    zone: string,
    timezoneSource: 'store' | 'fallback_utc',
    cfg: RealProfitConfig,
  ) {
    const bounds = resolveSaleListUtcRange(zone, dateYmd, dateYmd);
    const frozen = await this.loadFrozenCostMapsForDays(storeId, [dateYmd]);
    const gross = await this.grossProfitForRange(
      storeId,
      bounds.startUtc,
      bounds.endUtc,
      zone,
      frozen,
    );
    const real = await this.realProfitForRange(
      storeId,
      bounds.startUtc,
      bounds.endUtc,
      dateYmd,
      dateYmd,
      gross,
      cfg,
      {
        timezone: bounds.meta.timezone,
        timezoneSource,
        rangeInterpretation: bounds.meta.rangeInterpretation,
        preset: null,
      },
    );
    return {
      realProfit: real.realProfit,
      lossCostFunctional: real.deductions.losses.amount,
    };
  }

  private toPublicCapitalSnapshot(row: {
    date: Date;
    inventoryCapital: Prisma.Decimal;
    payablesDue: Prisma.Decimal;
    netInventoryEquity: Prisma.Decimal;
    netSales: Prisma.Decimal;
    cogs: Prisma.Decimal;
    grossProfit: Prisma.Decimal;
    realProfit: Prisma.Decimal;
    lossCostFunctional: Prisma.Decimal;
    purchasesFunctional: Prisma.Decimal;
    supplierPayments: Prisma.Decimal;
    paymentCommissions: Prisma.Decimal | null;
    cashBalanceEst: Prisma.Decimal | null;
    cashAvailableEst: Prisma.Decimal | null;
    source: string;
    capturedAt: Date;
  }) {
    return {
      date: ymdFromPrismaDate(row.date),
      inventoryCapital: decimalToReportString(row.inventoryCapital),
      payablesDue: decimalToReportString(row.payablesDue),
      netInventoryEquity: decimalToReportString(row.netInventoryEquity),
      netSales: decimalToReportString(row.netSales),
      cogs: decimalToReportString(row.cogs),
      grossProfit: decimalToReportString(row.grossProfit),
      realProfit: decimalToReportString(row.realProfit),
      lossCostFunctional: decimalToReportString(row.lossCostFunctional),
      purchasesFunctional: decimalToReportString(row.purchasesFunctional),
      supplierPayments: decimalToReportString(row.supplierPayments),
      paymentCommissions:
        row.paymentCommissions != null
          ? decimalToReportString(row.paymentCommissions)
          : null,
      cashBalanceEst:
        row.cashBalanceEst != null
          ? decimalToReportString(row.cashBalanceEst)
          : null,
      cashAvailableEst:
        row.cashAvailableEst != null
          ? decimalToReportString(row.cashAvailableEst)
          : null,
      source: row.source,
      capturedAt: row.capturedAt.toISOString(),
    };
  }

  /** Ganancia bruta + margen % del período, con serie diaria. */
  private async grossProfitForRange(
    storeId: string,
    startUtc: Date,
    endUtc: Date,
    zone: string,
    frozenCostsByDay: Map<string, Map<string, Prisma.Decimal>> = new Map(),
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
        unitCostFunctional: true,
        sale: { select: { createdAt: true } },
        product: {
          select: {
            id: true,
            cost: true,
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
        saleLine: { select: { unitCostFunctional: true } },
        product: {
          select: {
            id: true,
            cost: true,
            price: true,
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
      const day = DateTime.fromJSDate(sl.sale.createdAt, { zone: 'utc' })
        .setZone(zone)
        .toISODate()!;
      const catalogFallback = frozenUnitCostForProduct(
        frozenCostsByDay.get(day),
        sl.product.id,
        sl.product.cost,
      );
      const cost = saleLineCogsFunctional(
        sl.quantity,
        sl.unitCostFunctional,
        catalogFallback,
      );
      netSales = netSales.plus(revenue);
      cogs = cogs.plus(cost);
      bump(day, revenue, cost);
    }

    for (const rl of returnLines) {
      const revenue =
        rl.lineTotalFunctional ??
        rl.quantity.mul(
          rl.unitPriceFunctional ?? rl.product.price,
        );
      const day = DateTime.fromJSDate(rl.saleReturn.createdAt, { zone: 'utc' })
        .setZone(zone)
        .toISODate()!;
      const catalogFallback = frozenUnitCostForProduct(
        frozenCostsByDay.get(day),
        rl.product.id,
        rl.product.cost,
      );
      const cost = returnLineCogs(rl, catalogFallback);
      netSales = netSales.minus(revenue);
      cogs = cogs.minus(cost);
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
