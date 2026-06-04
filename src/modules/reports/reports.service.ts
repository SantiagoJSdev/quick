import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  avgTicketNet,
  decimalToReportString,
  REPORT_SALE_STATUS,
  returnRateString,
  saleFunctionalAmount,
} from '../../common/reports/report-amounts';
import { resolveReportUtcRange } from '../../common/dates/report-date-presets';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsPaymentsService } from './reports-payments.service';
import type { ReportSalesFilter } from './reports.types';
import type { SalesReportQueryDto } from './dto/sales-report-query.dto';

type StoreReportContext = {
  storeId: string;
  timezone: string | null;
  functionalCurrencyCode: string;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: ReportsPaymentsService,
  ) {}

  private async loadStoreContext(storeId: string): Promise<StoreReportContext> {
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

    return {
      storeId,
      timezone: store.timezone,
      functionalCurrencyCode: settings.functionalCurrency.code,
    };
  }

  private buildFilter(
    ctx: StoreReportContext,
    query: SalesReportQueryDto,
  ): ReportSalesFilter & {
    meta: ReturnType<typeof resolveReportUtcRange>['meta'];
    preset?: string;
  } {
    const deviceTrim =
      query.deviceId != null && query.deviceId.trim() !== ''
        ? query.deviceId.trim()
        : undefined;

    const range = resolveReportUtcRange({
      storeTimezone: ctx.timezone,
      preset: query.preset,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });

    return {
      storeId: ctx.storeId,
      status: REPORT_SALE_STATUS,
      startUtc: range.startUtc,
      endUtc: range.endUtc,
      deviceId: deviceTrim,
      meta: range.meta,
      preset: range.preset,
    };
  }

  async getSalesSummary(storeId: string, query: SalesReportQueryDto) {
    const ctx = await this.loadStoreContext(storeId);
    const filter = this.buildFilter(ctx, query);
    const { gross, tickets } = await this.aggregateSales(filter);
    const returns = await this.aggregateReturns(filter);
    const net = gross.minus(returns);

    return {
      storeId,
      currencyCode: ctx.functionalCurrencyCode,
      from: filter.meta.dateFrom,
      to: filter.meta.dateTo,
      timezone: filter.meta.timezone,
      rangeInterpretation: filter.meta.rangeInterpretation,
      ...(filter.preset ? { preset: filter.preset } : {}),
      grossSales: decimalToReportString(gross),
      returns: decimalToReportString(returns),
      netSales: decimalToReportString(net),
      tickets,
      avgTicket: avgTicketNet(net, tickets),
      returnRate: returnRateString(gross, returns),
    };
  }

  async getSalesTimeSeries(storeId: string, query: SalesReportQueryDto) {
    const ctx = await this.loadStoreContext(storeId);
    const filter = this.buildFilter(ctx, query);
    const zone =
      ctx.timezone && ctx.timezone.trim() !== ''
        ? ctx.timezone.trim()
        : 'UTC';

    const sales = await this.prisma.sale.findMany({
      where: this.saleWhere(filter),
      select: {
        createdAt: true,
        total: true,
        totalFunctional: true,
      },
    });

    const returns = await this.prisma.saleReturn.findMany({
      where: this.returnWhere(filter),
      select: {
        createdAt: true,
        total: true,
        totalFunctional: true,
      },
    });

    const buckets = new Map<
      string,
      {
        grossSales: Prisma.Decimal;
        returns: Prisma.Decimal;
        tickets: number;
      }
    >();

    const ensure = (bucket: string) => {
      let row = buckets.get(bucket);
      if (!row) {
        row = {
          grossSales: new Prisma.Decimal(0),
          returns: new Prisma.Decimal(0),
          tickets: 0,
        };
        buckets.set(bucket, row);
      }
      return row;
    };

    for (const s of sales) {
      const bucket = DateTime.fromJSDate(s.createdAt)
        .setZone(zone)
        .toISODate()!;
      const row = ensure(bucket);
      row.grossSales = row.grossSales.plus(saleFunctionalAmount(s));
      row.tickets += 1;
    }

    for (const r of returns) {
      const bucket = DateTime.fromJSDate(r.createdAt)
        .setZone(zone)
        .toISODate()!;
      const row = ensure(bucket);
      row.returns = row.returns.plus(saleFunctionalAmount(r));
    }

    const points = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, row]) => {
        const net = row.grossSales.minus(row.returns);
        return {
          bucket,
          grossSales: decimalToReportString(row.grossSales),
          returns: decimalToReportString(row.returns),
          netSales: decimalToReportString(net),
          tickets: row.tickets,
        };
      });

    return {
      meta: {
        timezone: filter.meta.timezone,
        from: filter.meta.dateFrom,
        to: filter.meta.dateTo,
        rangeInterpretation: filter.meta.rangeInterpretation,
        groupBy: 'day' as const,
        ...(filter.preset ? { preset: filter.preset } : {}),
      },
      points,
    };
  }

  async getSalesPayments(storeId: string, query: SalesReportQueryDto) {
    const ctx = await this.loadStoreContext(storeId);
    const filter = this.buildFilter(ctx, query);
    const items = await this.payments.breakdownByMethod(
      filter,
      ctx.functionalCurrencyCode,
    );

    return {
      storeId,
      currencyCode: ctx.functionalCurrencyCode,
      from: filter.meta.dateFrom,
      to: filter.meta.dateTo,
      timezone: filter.meta.timezone,
      ...(filter.preset ? { preset: filter.preset } : {}),
      items,
    };
  }

  async getSalesByDevice(storeId: string, query: SalesReportQueryDto) {
    const ctx = await this.loadStoreContext(storeId);
    const filter = this.buildFilter(ctx, query);

    const sales = await this.prisma.sale.findMany({
      where: this.saleWhere(filter),
      select: {
        deviceId: true,
        total: true,
        totalFunctional: true,
      },
    });

    const returns = await this.prisma.saleReturn.findMany({
      where: this.returnWhere(filter),
      select: {
        createdAt: true,
        total: true,
        totalFunctional: true,
        originalSale: { select: { deviceId: true } },
      },
    });

    const byDevice = new Map<
      string,
      { gross: Prisma.Decimal; returns: Prisma.Decimal; tickets: number }
    >();

    const ensureDev = (deviceId: string) => {
      let row = byDevice.get(deviceId);
      if (!row) {
        row = {
          gross: new Prisma.Decimal(0),
          returns: new Prisma.Decimal(0),
          tickets: 0,
        };
        byDevice.set(deviceId, row);
      }
      return row;
    };

    for (const s of sales) {
      const key = s.deviceId ?? '_unknown';
      const row = ensureDev(key);
      row.gross = row.gross.plus(saleFunctionalAmount(s));
      row.tickets += 1;
    }

    for (const r of returns) {
      const key = r.originalSale.deviceId ?? '_unknown';
      const row = ensureDev(key);
      row.returns = row.returns.plus(saleFunctionalAmount(r));
    }

    const items = [...byDevice.entries()]
      .map(([deviceId, row]) => ({
        deviceId: deviceId === '_unknown' ? null : deviceId,
        grossSales: decimalToReportString(row.gross),
        returns: decimalToReportString(row.returns),
        netSales: decimalToReportString(row.gross.minus(row.returns)),
        tickets: row.tickets,
      }))
      .sort((a, b) =>
        (a.deviceId ?? '').localeCompare(b.deviceId ?? ''),
      );

    return {
      storeId,
      currencyCode: ctx.functionalCurrencyCode,
      from: filter.meta.dateFrom,
      to: filter.meta.dateTo,
      items,
    };
  }

  /** Payload consolidado para pantalla kiosk. */
  async getDeviceDashboardPayload(
    deviceId: string,
    query: SalesReportQueryDto,
  ) {
    const trimmed = deviceId.trim();
    const dev = await this.prisma.pOSDevice.findUnique({
      where: { deviceId: trimmed },
    });
    if (!dev) {
      throw new NotFoundException('POS device not found');
    }

    const summary = await this.getSalesSummary(dev.storeId, query);
    const payments = await this.getSalesPayments(dev.storeId, query);
    const series = await this.getSalesTimeSeries(dev.storeId, query);

    await this.prisma.pOSDevice.update({
      where: { deviceId: trimmed },
      data: { lastHeartbeatAt: new Date() },
    });

    return {
      device: {
        id: dev.id,
        deviceId: dev.deviceId,
        storeId: dev.storeId,
        dashboardEnabled: dev.dashboardEnabled,
        deviceMode: dev.deviceMode,
        dashboardView: dev.dashboardView,
      },
      filters: {
        preset: query.preset ?? 'today',
        storeId: dev.storeId,
        from: summary.from,
        to: summary.to,
        timezone: summary.timezone,
      },
      summary: {
        grossSales: summary.grossSales,
        returns: summary.returns,
        netSales: summary.netSales,
        tickets: summary.tickets,
        avgTicket: summary.avgTicket,
        currencyCode: summary.currencyCode,
      },
      payments: payments.items,
      series: series.points,
    };
  }

  private saleWhere(filter: ReportSalesFilter): Prisma.SaleWhereInput {
    return {
      storeId: filter.storeId,
      status: filter.status,
      createdAt: { gte: filter.startUtc, lte: filter.endUtc },
      ...(filter.deviceId ? { deviceId: filter.deviceId } : {}),
    };
  }

  private returnWhere(filter: ReportSalesFilter): Prisma.SaleReturnWhereInput {
    return {
      storeId: filter.storeId,
      status: filter.status,
      createdAt: { gte: filter.startUtc, lte: filter.endUtc },
      ...(filter.deviceId
        ? { originalSale: { deviceId: filter.deviceId } }
        : {}),
    };
  }

  private async aggregateSales(filter: ReportSalesFilter) {
    const rows = await this.prisma.sale.findMany({
      where: this.saleWhere(filter),
      select: { total: true, totalFunctional: true },
    });
    let gross = new Prisma.Decimal(0);
    for (const r of rows) {
      gross = gross.plus(saleFunctionalAmount(r));
    }
    return { gross, tickets: rows.length };
  }

  private async aggregateReturns(filter: ReportSalesFilter) {
    const rows = await this.prisma.saleReturn.findMany({
      where: this.returnWhere(filter),
      select: { total: true, totalFunctional: true },
    });
    let sum = new Prisma.Decimal(0);
    for (const r of rows) {
      sum = sum.plus(saleFunctionalAmount(r));
    }
    return sum;
  }
}
