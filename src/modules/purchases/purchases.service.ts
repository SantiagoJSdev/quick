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
import type { CreatePurchaseDto } from './dto/create-purchase.dto';

/** Totales en funcional vía `convertAmountDocumentToFunctional` (Decimal sin redondeo intermedio). */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeFx: StoreFxSnapshotService,
    private readonly inventory: InventoryService,
  ) {}

  async create(storeId: string, dto: CreatePurchaseDto) {
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
      this.createPurchaseTx(tx, storeId, dto, fx),
    );
  }

  /**
   * Para `sync/push` dentro de una transacción ya abierta.
   */
  async createPurchaseTx(
    tx: Prisma.TransactionClient,
    storeId: string,
    dto: CreatePurchaseDto,
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

    const purchaseId = dto.id ?? randomUUID();

    if (dto.id) {
      const existing = await tx.purchase.findFirst({
        where: { id: purchaseId, storeId },
      });
      if (existing) {
        return tx.purchase.findUniqueOrThrow({
          where: { id: purchaseId },
          include: { lines: true },
        });
      }
    }

    const supplier = await tx.supplier.findUnique({
      where: { id: dto.supplierId },
    });
    if (!supplier || supplier.storeId !== storeId) {
      throw new NotFoundException('Supplier not found');
    }
    if (!supplier.active) {
      throw new BadRequestException('Supplier is inactive');
    }

    const rate = fx.fxRateQuotePerBase;
    const lineCreates: Prisma.PurchaseLineCreateWithoutPurchaseInput[] = [];
    let totalDoc = new Prisma.Decimal(0);
    let totalFunc = new Prisma.Decimal(0);
    const now = new Date();

    for (const line of dto.lines) {
      const product = await tx.product.findUnique({
        where: { id: line.productId },
      });
      if (!product) {
        throw new BadRequestException(`Product ${line.productId} not found`);
      }

      const qty = new Prisma.Decimal(line.quantity);
      const unitCostDoc = new Prisma.Decimal(line.unitCost);
      const lineTotalDocument = qty.mul(unitCostDoc);
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
      const unitCostFunctional = lineTotalFunctional.div(qty);

      const movementOpId =
        dto.opId != null && dto.opId.length > 0
          ? `${dto.opId}:${line.productId}`
          : null;

      await this.inventory.applyInPurchaseLineTx(tx, {
        storeId,
        productId: line.productId,
        quantity: qty,
        purchaseId,
        opId: movementOpId,
        unitCostFunctional,
        lineTotalFunctional,
        unitCostDocument: unitCostDoc,
        lineTotalDocument,
      });

      lineCreates.push({
        product: { connect: { id: line.productId } },
        quantity: qty,
        unitCost: unitCostDoc,
        totalCost: lineTotalDocument,
        unitCostDocument: unitCostDoc,
        unitCostFunctional,
        lineTotalDocument,
        lineTotalFunctional,
      });

      totalDoc = totalDoc.plus(lineTotalDocument);
      totalFunc = totalFunc.plus(lineTotalFunctional);
    }

    return tx.purchase.create({
      data: {
        id: purchaseId,
        storeId,
        supplierId: dto.supplierId,
        status: 'RECEIVED',
        total: totalDoc,
        dateReceived: now,
        documentCurrencyCode: docCode,
        functionalCurrencyCode: funcCode,
        fxBaseCurrencyCode: fx.fxBaseCurrencyCode,
        fxQuoteCurrencyCode: fx.fxQuoteCurrencyCode,
        fxRateQuotePerBase: fx.fxRateQuotePerBase,
        exchangeRateDate: fx.exchangeRateDate,
        fxSource: fx.fxSource,
        totalDocument: totalDoc,
        totalFunctional: totalFunc,
        lines: { create: lineCreates },
      },
      include: { lines: true },
    });
  }

  findOne(storeId: string, purchaseId: string) {
    return this.prisma.purchase.findFirst({
      where: { id: purchaseId, storeId },
      include: {
        lines: {
          include: {
            product: { select: { sku: true, name: true } },
          },
        },
        supplier: {
          select: { id: true, name: true, taxId: true, active: true },
        },
      },
    });
  }
}
