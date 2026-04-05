import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { convertAmountDocumentToFunctional } from '../../common/fx/convert-amount';
import { PrismaService } from '../../prisma/prisma.service';
import type { ResolvedFxSnapshot } from '../exchange-rates/store-fx-snapshot.service';
import { StoreFxSnapshotService } from '../exchange-rates/store-fx-snapshot.service';
import { InventoryService } from '../inventory/inventory.service';
import { PosDeviceService } from '../pos-device/pos-device.service';
import type { CreateSaleDto } from './dto/create-sale.dto';
import type { SalesListQueryDto } from './dto/sales-list-query.dto';
import { decodeSaleListCursor, encodeSaleListCursor } from './sales-list-cursor';
import { resolveSaleListUtcRange } from './sales-list-range';

/** Totales en funcional vía `convertAmountDocumentToFunctional` (Decimal sin redondeo intermedio). */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeFx: StoreFxSnapshotService,
    private readonly inventory: InventoryService,
    private readonly posDevice: PosDeviceService,
  ) {}

  /** Confirmación de venta + líneas + `OUT_SALE` + descuento inventario (una transacción). */
  async create(storeId: string, dto: CreateSaleDto) {
    const settings = await this.prisma.businessSettings.findUnique({
      where: { storeId },
      include: {
        functionalCurrency: true,
        defaultSaleDocCurrency: true,
      },
    });
    if (!settings) {
      throw new NotFoundException('Business settings not found for this store');
    }

    const funcCode = settings.functionalCurrency.code.toUpperCase();
    const docCode = (
      dto.documentCurrencyCode ??
      settings.defaultSaleDocCurrency?.code ??
      funcCode
    ).toUpperCase();

    const fx = await this.storeFx.resolveFxSnapshot(
      storeId,
      docCode,
      funcCode,
      dto.fxSnapshot,
    );

    return this.prisma.$transaction((tx) =>
      this.createSaleTx(tx, storeId, dto, fx),
    );
  }

  /**
   * Para `sync/push` dentro de una transacción ya abierta. `fx` debe estar resuelto antes (p. ej. con `StoreFxSnapshotService.resolveFxSnapshot`).
   */
  async createSaleTx(
    tx: Prisma.TransactionClient,
    storeId: string,
    dto: CreateSaleDto,
    fx: ResolvedFxSnapshot,
  ) {
    const settings = await tx.businessSettings.findUnique({
      where: { storeId },
      include: {
        functionalCurrency: true,
        defaultSaleDocCurrency: true,
      },
    });
    if (!settings) {
      throw new NotFoundException('Business settings not found for this store');
    }

    const funcCode = settings.functionalCurrency.code.toUpperCase();
    const docCode = (
      dto.documentCurrencyCode ??
      settings.defaultSaleDocCurrency?.code ??
      funcCode
    ).toUpperCase();

    const saleId = dto.id ?? randomUUID();

    if (dto.id) {
      const existing = await tx.sale.findFirst({
        where: { id: saleId, storeId },
      });
      if (existing) {
        return tx.sale.findUniqueOrThrow({
          where: { id: saleId },
          include: { saleLines: true },
        });
      }
    }

    if (dto.userId) {
      const user = await tx.user.findUnique({ where: { id: dto.userId } });
      if (!user) {
        throw new NotFoundException('User not found');
      }
    }

    const rate = fx.fxRateQuotePerBase;
    const lineCreates: Prisma.SaleLineCreateWithoutSaleInput[] = [];
    let totalDoc = new Prisma.Decimal(0);
    let totalFunc = new Prisma.Decimal(0);

    for (const line of dto.lines) {
      const product = await tx.product.findUnique({
        where: { id: line.productId },
      });
      if (!product || !product.active) {
        throw new BadRequestException(
          `Product ${line.productId} not found or inactive`,
        );
      }

      const qty = new Prisma.Decimal(line.quantity);
      const price = new Prisma.Decimal(line.price);
      const disc = line.discount
        ? new Prisma.Decimal(line.discount)
        : new Prisma.Decimal(0);

      const lineTotalDocument = qty.mul(price).minus(disc);
      if (lineTotalDocument.lt(0)) {
        throw new BadRequestException('Line total cannot be negative');
      }

      const lineTotalFunctional = convertAmountDocumentToFunctional(
        lineTotalDocument,
        docCode,
        funcCode,
        fx.fxBaseCurrencyCode,
        fx.fxQuoteCurrencyCode,
        rate,
      );
      const unitPriceFunctional = lineTotalFunctional.div(qty);
      const discountFunctional = disc.gt(0)
        ? convertAmountDocumentToFunctional(
            disc,
            docCode,
            funcCode,
            fx.fxBaseCurrencyCode,
            fx.fxQuoteCurrencyCode,
            rate,
          )
        : new Prisma.Decimal(0);

      const movementOpId =
        dto.opId != null && dto.opId.length > 0
          ? `${dto.opId}:${line.productId}`
          : null;

      await this.inventory.applyOutSaleLineTx(tx, {
        storeId,
        productId: line.productId,
        quantity: qty,
        saleId,
        opId: movementOpId,
        priceAtMomentDocument: price,
      });

      lineCreates.push({
        product: { connect: { id: line.productId } },
        quantity: qty,
        price,
        discount: disc.gt(0) ? disc : null,
        total: lineTotalDocument,
        unitPriceDocument: price,
        unitPriceFunctional,
        lineTotalDocument,
        lineTotalFunctional,
        discountDocument: disc.gt(0) ? disc : null,
        discountFunctional: disc.gt(0) ? discountFunctional : null,
      });

      totalDoc = totalDoc.plus(lineTotalDocument);
      totalFunc = totalFunc.plus(lineTotalFunctional);
    }

    let deviceId: string | null = null;
    if (dto.deviceId != null && dto.deviceId.trim() !== '') {
      deviceId = await this.posDevice.touchOrRegister(
        tx,
        storeId,
        dto.deviceId,
        { appVersion: dto.appVersion },
      );
    }

    return tx.sale.create({
      data: {
        id: saleId,
        storeId,
        deviceId,
        userId: dto.userId ?? null,
        total: totalDoc,
        status: 'CONFIRMED',
        documentCurrencyCode: docCode,
        functionalCurrencyCode: funcCode,
        fxBaseCurrencyCode: fx.fxBaseCurrencyCode,
        fxQuoteCurrencyCode: fx.fxQuoteCurrencyCode,
        fxRateQuotePerBase: fx.fxRateQuotePerBase,
        exchangeRateDate: fx.exchangeRateDate,
        fxSource: fx.fxSource,
        totalDocument: totalDoc,
        totalFunctional: totalFunc,
        saleLines: { create: lineCreates },
      },
      include: { saleLines: true },
    });
  }

  findOne(storeId: string, saleId: string) {
    return this.prisma.sale.findFirst({
      where: { id: saleId, storeId },
      include: { saleLines: { include: { product: { select: { sku: true, name: true } } } } },
    });
  }

  /**
   * Historial paginado por `createdAt` + `id` (desc). Fechas calendario en `Store.timezone`.
   */
  async listHistory(storeId: string, query: SalesListQueryDto) {
    if (query.format === 'array' && query.cursor?.trim()) {
      throw new BadRequestException(
        'format=array does not support cursor pagination; omit cursor or use format=object (default)',
      );
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { timezone: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const { startUtc, endUtc, meta } = resolveSaleListUtcRange(
      store.timezone,
      query.dateFrom,
      query.dateTo,
    );

    const limit = query.limit ?? 50;
    const deviceTrim =
      query.deviceId != null && query.deviceId.trim() !== ''
        ? query.deviceId.trim()
        : undefined;

    const cursorDecoded = query.cursor?.trim()
      ? decodeSaleListCursor(query.cursor.trim())
      : null;

    const andParts: Prisma.SaleWhereInput[] = [
      { storeId },
      { createdAt: { gte: startUtc, lte: endUtc } },
    ];
    if (deviceTrim) {
      andParts.push({ deviceId: deviceTrim });
    }
    if (cursorDecoded) {
      andParts.push({
        OR: [
          { createdAt: { lt: cursorDecoded.createdAt } },
          {
            AND: [
              { createdAt: cursorDecoded.createdAt },
              { id: { lt: cursorDecoded.id } },
            ],
          },
        ],
      });
    }

    const rows = await this.prisma.sale.findMany({
      where: { AND: andParts },
      select: {
        id: true,
        createdAt: true,
        documentCurrencyCode: true,
        totalDocument: true,
        totalFunctional: true,
        deviceId: true,
        status: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last != null ? encodeSaleListCursor(last) : null;

    return {
      items: page,
      nextCursor,
      meta: {
        ...meta,
        limit,
        hasMore,
        ...(deviceTrim ? { deviceIdFilter: deviceTrim } : {}),
      },
    };
  }
}
