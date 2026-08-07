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
import type { CreatePurchasePaymentDto } from './dto/create-purchase-payment.dto';
import type {
  CreatePurchaseDto,
  PurchasePaymentStatus,
} from './dto/create-purchase.dto';
import type { PurchasesListQueryDto } from './dto/purchases-list-query.dto';

function parseDueDate(raw?: string): Date | null {
  if (!raw || !raw.trim()) return null;
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new BadRequestException('dueDate must be YYYY-MM-DD');
  }
  const d = new Date(`${t}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('dueDate is invalid');
  }
  return d;
}

function resolvePaymentFields(
  totalFunc: Prisma.Decimal,
  paymentStatus: PurchasePaymentStatus,
  initialPaidRaw?: string,
): {
  paymentStatus: PurchasePaymentStatus;
  amountPaidFunctional: Prisma.Decimal;
  amountDueFunctional: Prisma.Decimal;
  paidAt: Date | null;
} {
  const now = new Date();
  if (paymentStatus === 'PAID') {
    return {
      paymentStatus: 'PAID',
      amountPaidFunctional: totalFunc,
      amountDueFunctional: new Prisma.Decimal(0),
      paidAt: now,
    };
  }
  if (paymentStatus === 'CREDIT') {
    return {
      paymentStatus: 'CREDIT',
      amountPaidFunctional: new Prisma.Decimal(0),
      amountDueFunctional: totalFunc,
      paidAt: null,
    };
  }
  // PARTIAL
  const initial = new Prisma.Decimal(initialPaidRaw ?? '0');
  if (initial.lt(0)) {
    throw new BadRequestException('initialAmountPaidFunctional cannot be negative');
  }
  if (initial.gte(totalFunc)) {
    return {
      paymentStatus: 'PAID',
      amountPaidFunctional: totalFunc,
      amountDueFunctional: new Prisma.Decimal(0),
      paidAt: now,
    };
  }
  if (initial.eq(0)) {
    return {
      paymentStatus: 'CREDIT',
      amountPaidFunctional: new Prisma.Decimal(0),
      amountDueFunctional: totalFunc,
      paidAt: null,
    };
  }
  return {
    paymentStatus: 'PARTIAL',
    amountPaidFunctional: initial,
    amountDueFunctional: totalFunc.minus(initial),
    paidAt: null,
  };
}

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
          include: { lines: true, payments: true },
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

    const supplierInvoiceReference =
      dto.supplierInvoiceReference != null &&
      dto.supplierInvoiceReference.trim().length > 0
        ? dto.supplierInvoiceReference.trim().slice(0, 120)
        : null;

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

    const paymentStatus = (dto.paymentStatus ?? 'PAID') as PurchasePaymentStatus;
    const pay = resolvePaymentFields(
      totalFunc,
      paymentStatus,
      dto.initialAmountPaidFunctional,
    );
    const dueDate = parseDueDate(dto.dueDate);

    const purchase = await tx.purchase.create({
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
        supplierInvoiceReference,
        paymentStatus: pay.paymentStatus,
        amountPaidFunctional: pay.amountPaidFunctional,
        amountDueFunctional: pay.amountDueFunctional,
        dueDate,
        paidAt: pay.paidAt,
        lines: { create: lineCreates },
      },
      include: { lines: true, payments: true },
    });

    if (pay.amountPaidFunctional.gt(0) && pay.paymentStatus !== 'CREDIT') {
      await tx.purchasePayment.create({
        data: {
          id: randomUUID(),
          purchaseId: purchase.id,
          storeId,
          amountFunctional: pay.amountPaidFunctional,
          method: pay.paymentStatus === 'PAID' ? 'CASH' : 'CASH',
          note: 'initial',
          paidAt: pay.paidAt ?? now,
          opId: dto.opId ? `${dto.opId}:initial-payment` : null,
        },
      });
      return tx.purchase.findUniqueOrThrow({
        where: { id: purchase.id },
        include: { lines: true, payments: true },
      });
    }

    return purchase;
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
        payments: { orderBy: { paidAt: 'asc' } },
      },
    });
  }

  async list(storeId: string, query: PurchasesListQueryDto) {
    const limit = query.limit ?? 50;
    const where: Prisma.PurchaseWhereInput = { storeId };
    if (query.supplierId) {
      where.supplierId = query.supplierId;
    }
    if (query.paymentStatus === 'OPEN') {
      where.paymentStatus = { in: ['CREDIT', 'PARTIAL'] };
      where.amountDueFunctional = { gt: 0 };
    } else if (query.paymentStatus) {
      where.paymentStatus = query.paymentStatus;
    }

    const items = await this.prisma.purchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        supplier: { select: { id: true, name: true } },
        _count: { select: { lines: true, payments: true } },
      },
    });

    return { items, meta: { limit, count: items.length } };
  }

  async payablesSummary(storeId: string) {
    const rows = await this.prisma.purchase.groupBy({
      by: ['supplierId'],
      where: {
        storeId,
        paymentStatus: { in: ['CREDIT', 'PARTIAL'] },
        amountDueFunctional: { gt: 0 },
      },
      _sum: { amountDueFunctional: true, amountPaidFunctional: true, totalFunctional: true },
      _count: { _all: true },
    });

    if (rows.length === 0) {
      return { items: [], totalDueFunctional: '0' };
    }

    const supplierIds = rows.map((r) => r.supplierId);
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true, active: true },
    });
    const byId = new Map(suppliers.map((s) => [s.id, s]));

    const items = rows.map((r) => ({
      supplierId: r.supplierId,
      supplierName: byId.get(r.supplierId)?.name ?? '(desconocido)',
      active: byId.get(r.supplierId)?.active ?? false,
      openInvoices: r._count._all,
      amountDueFunctional: (r._sum.amountDueFunctional ?? new Prisma.Decimal(0)).toString(),
      amountPaidFunctional: (r._sum.amountPaidFunctional ?? new Prisma.Decimal(0)).toString(),
      totalFunctional: (r._sum.totalFunctional ?? new Prisma.Decimal(0)).toString(),
    }));

    items.sort((a, b) =>
      new Prisma.Decimal(b.amountDueFunctional)
        .minus(a.amountDueFunctional)
        .toNumber(),
    );

    const totalDue = items.reduce(
      (acc, i) => acc.plus(i.amountDueFunctional),
      new Prisma.Decimal(0),
    );

    return {
      items,
      totalDueFunctional: totalDue.toString(),
    };
  }

  async addPayment(
    storeId: string,
    purchaseId: string,
    dto: CreatePurchasePaymentDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.opId) {
        const existing = await tx.purchasePayment.findUnique({
          where: { opId: dto.opId },
        });
        if (existing) {
          return tx.purchase.findUniqueOrThrow({
            where: { id: existing.purchaseId },
            include: { lines: true, payments: true, supplier: true },
          });
        }
      }

      const purchase = await tx.purchase.findFirst({
        where: { id: purchaseId, storeId },
      });
      if (!purchase) {
        throw new NotFoundException('Purchase not found');
      }
      if (purchase.paymentStatus === 'PAID' || purchase.amountDueFunctional.lte(0)) {
        throw new BadRequestException('Purchase is already fully paid');
      }

      const amount = new Prisma.Decimal(dto.amountFunctional);
      if (amount.lte(0)) {
        throw new BadRequestException('amountFunctional must be > 0');
      }
      if (amount.gt(purchase.amountDueFunctional)) {
        throw new BadRequestException(
          `amountFunctional exceeds amount due (${purchase.amountDueFunctional.toString()})`,
        );
      }

      let paidAt = new Date();
      if (dto.paidAt) {
        const parsed = new Date(dto.paidAt);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestException('paidAt is invalid');
        }
        paidAt = parsed;
      }

      await tx.purchasePayment.create({
        data: {
          id: randomUUID(),
          purchaseId,
          storeId,
          amountFunctional: amount,
          method: (dto.method ?? 'CASH').trim().slice(0, 40) || 'CASH',
          note: dto.note?.trim().slice(0, 500) || null,
          paidAt,
          opId: dto.opId ?? null,
        },
      });

      const newPaid = purchase.amountPaidFunctional.plus(amount);
      const total = purchase.totalFunctional ?? purchase.total;
      const newDue = Prisma.Decimal.max(total.minus(newPaid), new Prisma.Decimal(0));
      const fullyPaid = newDue.lte(0);

      await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          amountPaidFunctional: newPaid,
          amountDueFunctional: newDue,
          paymentStatus: fullyPaid ? 'PAID' : 'PARTIAL',
          paidAt: fullyPaid ? paidAt : null,
        },
      });

      return tx.purchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: {
          lines: true,
          payments: { orderBy: { paidAt: 'asc' } },
          supplier: {
            select: { id: true, name: true, taxId: true, active: true },
          },
        },
      });
    });
  }
}
