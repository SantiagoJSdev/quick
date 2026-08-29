import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CashSession } from '@prisma/client';
import { saleFunctionalAmount } from '../../common/reports/report-amounts';
import { PrismaService } from '../../prisma/prisma.service';
import { KpisService } from '../kpis/kpis.service';
import { PosDeviceService } from '../pos-device/pos-device.service';
import type {
  CloseCashSessionDto,
  OpenCashSessionDto,
} from './dto/cash-session.dto';

/** Máximo lookback para `clientOpenedAt` (apertura offline → sync tarde). */
const CLIENT_OPENED_AT_MAX_AGE_MS = 36 * 60 * 60 * 1000;
/** Holgura hacia el futuro (reloj del POS un poco adelantado). */
const CLIENT_OPENED_AT_FUTURE_SKEW_MS = 2 * 60 * 1000;

@Injectable()
export class CashSessionService {
  private readonly logger = new Logger(CashSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posDevice: PosDeviceService,
    private readonly kpis: KpisService,
  ) {}

  async open(storeId: string, dto: OpenCashSessionDto) {
    const deviceId = dto.deviceId.trim();
    if (!deviceId) {
      throw new BadRequestException('deviceId is required');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.posDevice.touchOrRegister(tx, storeId, deviceId, {
        appVersion: dto.appVersion,
      });
    });

    const openingCash = this.parseOpeningCashOptional(dto.openingCash);
    const clientOpenedAt = this.parseClientOpenedAtOptional(dto.clientOpenedAt);

    const existing = await this.prisma.cashSession.findFirst({
      where: { storeId, deviceId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    if (existing) {
      return this.claimOrReturnOpen(existing, openingCash, clientOpenedAt);
    }

    const row = await this.prisma.cashSession.create({
      data: {
        storeId,
        deviceId,
        status: 'OPEN',
        openingCash,
        ...(clientOpenedAt ? { openedAt: clientOpenedAt } : {}),
      },
    });
    return this.toPublic(row);
  }

  /**
   * OPEN existente:
   * - openingCash null/0 + body con monto ≥ 0 → escribe fondo (zombie claim).
   * - openingCash ya ≠ 0 → no pisa el fondo.
   * - En claim (fondo era 0/null), si viene clientOpenedAt → también ajusta openedAt.
   */
  private async claimOrReturnOpen(
    existing: CashSession,
    openingCash: Prisma.Decimal | null,
    clientOpenedAt: Date | null,
  ) {
    const currentIsZero =
      existing.openingCash == null || existing.openingCash.eq(0);
    const shouldClaimCash =
      currentIsZero && openingCash != null && openingCash.gte(0);
    const shouldClaimOpenedAt = currentIsZero && clientOpenedAt != null;

    if (!shouldClaimCash && !shouldClaimOpenedAt) {
      return this.toPublic(existing);
    }

    const updated = await this.prisma.cashSession.update({
      where: { id: existing.id },
      data: {
        ...(shouldClaimCash ? { openingCash } : {}),
        ...(shouldClaimOpenedAt ? { openedAt: clientOpenedAt } : {}),
      },
    });
    this.logger.log(
      `Cash session claim device=${existing.deviceId} id=${existing.id}` +
        (shouldClaimCash ? ` openingCash=${openingCash!.toString()}` : '') +
        (shouldClaimOpenedAt
          ? ` openedAt=${clientOpenedAt!.toISOString()}`
          : ''),
    );
    return this.toPublic(updated);
  }

  private parseOpeningCashOptional(
    raw: string | undefined,
  ): Prisma.Decimal | null {
    if (raw == null || raw.trim() === '') {
      return null;
    }
    const openingCash = new Prisma.Decimal(raw);
    if (!openingCash.isFinite() || openingCash.lt(0)) {
      throw new BadRequestException(
        'openingCash must be a non-negative decimal',
      );
    }
    return openingCash;
  }

  private parseClientOpenedAtOptional(raw: string | undefined): Date | null {
    if (raw == null || raw.trim() === '') {
      return null;
    }
    const trimmed = raw.trim();
    const ms = Date.parse(trimmed);
    if (!Number.isFinite(ms)) {
      throw new BadRequestException(
        'clientOpenedAt must be a valid ISO-8601 datetime',
      );
    }
    const opened = new Date(ms);
    const now = Date.now();
    if (ms > now + CLIENT_OPENED_AT_FUTURE_SKEW_MS) {
      throw new BadRequestException('clientOpenedAt cannot be in the future');
    }
    if (now - ms > CLIENT_OPENED_AT_MAX_AGE_MS) {
      throw new BadRequestException(
        'clientOpenedAt cannot be more than 36 hours in the past',
      );
    }
    return opened;
  }

  async findCurrent(storeId: string, deviceId: string) {
    const trimmed = deviceId.trim();
    const row = await this.prisma.cashSession.findFirst({
      where: { storeId, deviceId: trimmed, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    if (!row) {
      throw new NotFoundException('No open cash session for this device');
    }
    return this.toPublic(row);
  }

  async findOne(storeId: string, sessionId: string) {
    const row = await this.requireSession(storeId, sessionId);
    return this.toPublic(row);
  }

  async summary(storeId: string, sessionId: string) {
    const row = await this.requireSession(storeId, sessionId);
    const live = await this.computeSummary(storeId, row);
    const settings = await this.prisma.businessSettings.findUnique({
      where: { storeId },
    });

    const warnings: Array<{ code: string; message: string }> = [];
    if (row.status === 'CLOSED' && row.closeWarningsJson) {
      const stored = row.closeWarningsJson as Array<{
        code: string;
        message: string;
      }>;
      if (Array.isArray(stored)) {
        warnings.push(...stored);
      }
    } else if (
      settings?.requireSuccessfulSyncAtClose &&
      live.pendingCountDeclared === 0 &&
      live.syncFailedCount > 0
    ) {
      warnings.push({
        code: 'SYNC_FAILED_IN_RANGE',
        message:
          'There are failed sync operations in this session window; review before closing.',
      });
    }

    return {
      session: this.toPublic(row),
      summary: live,
      warnings,
      requireSuccessfulSyncAtClose:
        settings?.requireSuccessfulSyncAtClose ?? false,
    };
  }

  async close(storeId: string, sessionId: string, dto: CloseCashSessionDto) {
    const row = await this.requireSession(storeId, sessionId);
    if (row.status !== 'OPEN') {
      throw new ConflictException('Cash session is already closed');
    }

    const pendingSales = dto.pendingSales ?? [];
    const pendingCount = pendingSales.length;

    let countedCash: Prisma.Decimal | null = null;
    if (dto.countedCash != null && dto.countedCash.trim() !== '') {
      countedCash = new Prisma.Decimal(dto.countedCash);
      if (!countedCash.isFinite() || countedCash.lt(0)) {
        throw new BadRequestException('countedCash must be a non-negative decimal');
      }
    }

    const closedAt = new Date();
    const live = await this.computeSummary(storeId, row, closedAt, pendingCount);

    const settings = await this.prisma.businessSettings.findUnique({
      where: { storeId },
    });
    const warnings: Array<{ code: string; message: string }> = [];

    if (pendingCount > 0) {
      warnings.push({
        code: 'PENDING_SALES_DECLARED',
        message: `${pendingCount} sale(s) still pending on device; transmit when online.`,
      });
    }
    if (dto.closeMode === 'OFFLINE') {
      warnings.push({
        code: 'CLOSED_OFFLINE',
        message: 'Session closed offline; sync queue remains on device until ACK.',
      });
    }
    if (settings?.requireSuccessfulSyncAtClose && pendingCount > 0) {
      warnings.push({
        code: 'REQUIRE_SYNC_SOFT',
        message:
          'Store prefers successful sync at close, but offline/partial close is allowed.',
      });
    }
    if (live.syncFailedCount > 0) {
      warnings.push({
        code: 'SYNC_FAILED_IN_RANGE',
        message: `${live.syncFailedCount} failed sync op(s) in session window.`,
      });
    }
    if (live.negativeSkuCount > 0) {
      warnings.push({
        code: 'NEGATIVE_STOCK_SKUS',
        message: `${live.negativeSkuCount} SKU(s) with negative quantity.`,
      });
    }

    const updated = await this.prisma.cashSession.update({
      where: { id: row.id },
      data: {
        status: 'CLOSED',
        closedAt,
        closeMode: dto.closeMode,
        countedCash,
        notes: dto.notes?.trim() || null,
        pendingSalesJson: pendingSales as unknown as Prisma.InputJsonValue,
        pendingCount,
        ticketsCount: live.ticketsCount,
        salesTotalFunctional: new Prisma.Decimal(live.salesTotalFunctional),
        returnsTotalFunctional: new Prisma.Decimal(live.returnsTotalFunctional),
        stockConflictSalesCount: live.stockConflictSalesCount,
        negativeSkuCount: live.negativeSkuCount,
        syncFailedCount: live.syncFailedCount,
        closeWarningsJson: warnings as unknown as Prisma.InputJsonValue,
      },
    });

    let capitalPhoto:
      | { date: string; ok: true; netInventoryEquity: string }
      | { ok: false };
    try {
      capitalPhoto = await this.kpis.captureTodayOnCashClose(storeId);
    } catch (err) {
      this.logger.warn(
        `Capital snapshot after cash close failed store=${storeId} session=${sessionId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      capitalPhoto = { ok: false };
    }

    return {
      session: this.toPublic(updated),
      summary: live,
      warnings,
      capitalPhoto,
    };
  }

  private async requireSession(storeId: string, sessionId: string) {
    const row = await this.prisma.cashSession.findFirst({
      where: { id: sessionId, storeId },
    });
    if (!row) {
      throw new NotFoundException('Cash session not found');
    }
    return row;
  }

  private async computeSummary(
    storeId: string,
    session: {
      deviceId: string;
      openedAt: Date;
      closedAt: Date | null;
      pendingCount: number;
      status: string;
      ticketsCount: number | null;
      salesTotalFunctional: Prisma.Decimal | null;
      returnsTotalFunctional: Prisma.Decimal | null;
      stockConflictSalesCount: number | null;
      negativeSkuCount: number | null;
      syncFailedCount: number | null;
    },
    endOverride?: Date,
    pendingCountOverride?: number,
  ) {
    // Sesión ya cerrada: devolver snapshot congelado si existe.
    if (
      session.status === 'CLOSED' &&
      session.ticketsCount != null &&
      endOverride == null
    ) {
      return {
        openedAt: session.openedAt.toISOString(),
        closedAt: session.closedAt?.toISOString() ?? null,
        ticketsCount: session.ticketsCount,
        salesTotalFunctional:
          session.salesTotalFunctional?.toString() ?? '0',
        returnsTotalFunctional:
          session.returnsTotalFunctional?.toString() ?? '0',
        netSalesFunctional: (
          (session.salesTotalFunctional ?? new Prisma.Decimal(0)).minus(
            session.returnsTotalFunctional ?? new Prisma.Decimal(0),
          )
        ).toString(),
        stockConflictSalesCount: session.stockConflictSalesCount ?? 0,
        negativeSkuCount: session.negativeSkuCount ?? 0,
        syncFailedCount: session.syncFailedCount ?? 0,
        pendingCountDeclared: session.pendingCount,
      };
    }

    const end = endOverride ?? session.closedAt ?? new Date();
    const start = session.openedAt;

    const sales = await this.prisma.sale.findMany({
      where: {
        storeId,
        status: 'CONFIRMED',
        deviceId: session.deviceId,
        createdAt: { gte: start, lte: end },
      },
      select: {
        total: true,
        totalFunctional: true,
        stockConflictDetected: true,
      },
    });

    let salesTotal = new Prisma.Decimal(0);
    let stockConflictSalesCount = 0;
    for (const s of sales) {
      salesTotal = salesTotal.plus(saleFunctionalAmount(s));
      if (s.stockConflictDetected) {
        stockConflictSalesCount += 1;
      }
    }

    const returns = await this.prisma.saleReturn.findMany({
      where: {
        storeId,
        status: 'CONFIRMED',
        createdAt: { gte: start, lte: end },
      },
      select: { total: true, totalFunctional: true },
    });
    let returnsTotal = new Prisma.Decimal(0);
    for (const r of returns) {
      returnsTotal = returnsTotal.plus(saleFunctionalAmount(r));
    }

    const negativeSkuCount = await this.prisma.inventoryItem.count({
      where: { storeId, quantity: { lt: 0 } },
    });

    const syncFailedCount = await this.prisma.syncOperation.count({
      where: {
        storeId,
        deviceId: session.deviceId,
        status: 'failed',
        clientTimestamp: { gte: start, lte: end },
      },
    });

    const pendingCountDeclared =
      pendingCountOverride !== undefined
        ? pendingCountOverride
        : session.pendingCount;

    return {
      openedAt: start.toISOString(),
      closedAt: session.closedAt?.toISOString() ?? null,
      ticketsCount: sales.length,
      salesTotalFunctional: salesTotal.toString(),
      returnsTotalFunctional: returnsTotal.toString(),
      netSalesFunctional: salesTotal.minus(returnsTotal).toString(),
      stockConflictSalesCount,
      negativeSkuCount,
      syncFailedCount,
      pendingCountDeclared,
    };
  }

  private toPublic(row: {
    id: string;
    storeId: string;
    deviceId: string;
    status: string;
    openedAt: Date;
    closedAt: Date | null;
    openingCash: Prisma.Decimal | null;
    countedCash: Prisma.Decimal | null;
    closeMode: string | null;
    notes: string | null;
    pendingCount: number;
    pendingSalesJson: Prisma.JsonValue | null;
    ticketsCount: number | null;
    salesTotalFunctional: Prisma.Decimal | null;
    returnsTotalFunctional: Prisma.Decimal | null;
    stockConflictSalesCount: number | null;
    negativeSkuCount: number | null;
    syncFailedCount: number | null;
    closeWarningsJson: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      storeId: row.storeId,
      deviceId: row.deviceId,
      status: row.status,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      openingCash: row.openingCash?.toString() ?? null,
      countedCash: row.countedCash?.toString() ?? null,
      closeMode: row.closeMode,
      notes: row.notes,
      pendingCount: row.pendingCount,
      pendingSales: row.pendingSalesJson ?? [],
      ticketsCount: row.ticketsCount,
      salesTotalFunctional: row.salesTotalFunctional?.toString() ?? null,
      returnsTotalFunctional: row.returnsTotalFunctional?.toString() ?? null,
      stockConflictSalesCount: row.stockConflictSalesCount,
      negativeSkuCount: row.negativeSkuCount,
      syncFailedCount: row.syncFailedCount,
      closeWarnings: row.closeWarningsJson ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
