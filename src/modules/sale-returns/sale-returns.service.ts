import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { convertAmountDocumentToFunctional } from '../../common/fx/convert-amount';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreFxSnapshotService } from '../exchange-rates/store-fx-snapshot.service';
import { InventoryService } from '../inventory/inventory.service';
import type { CreateSaleReturnDto } from './dto/create-sale-return.dto';

/**
 * Devoluciones: importes comerciales en documento (proporcionales a la venta).
 * Funcional comercial: `INHERIT_*` reutiliza la paridad implícita de la venta;
 * `SPOT_ON_RETURN` aplica `convertAmountDocumentToFunctional` con tasa del día
 * (sin redondeo intermedio; ver `convert-amount.ts`). COGS de inventario sigue
 * saliendo de `OUT_SALE` de la venta original (no cambia con SPOT).
 */
@Injectable()
export class SaleReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly storeFx: StoreFxSnapshotService,
  ) {}

  /**
   * COGS reingresado: promedio ponderado de `OUT_SALE` de esa venta y producto.
   */
  private async resolveRestockCostFunctional(
    tx: Prisma.TransactionClient,
    originalSaleId: string,
    productId: string,
    returnQty: Prisma.Decimal,
  ): Promise<{ unitCogs: Prisma.Decimal; lineTotalCogs: Prisma.Decimal }> {
    const moves = await tx.stockMovement.findMany({
      where: {
        referenceId: originalSaleId,
        productId,
        type: 'OUT_SALE',
      },
    });
    if (moves.length === 0) {
      throw new BadRequestException(
        'No hay salidas OUT_SALE para este producto en la venta original; no se puede valorizar la devolución',
      );
    }
    let sumQ = new Prisma.Decimal(0);
    let sumC = new Prisma.Decimal(0);
    for (const m of moves) {
      sumQ = sumQ.plus(m.quantity);
      const tc =
        m.totalCostFunctional ??
        (m.unitCostFunctional != null
          ? m.unitCostFunctional.mul(m.quantity)
          : new Prisma.Decimal(0));
      sumC = sumC.plus(tc);
    }
    if (sumQ.lte(0)) {
      throw new BadRequestException('Cantidades de movimiento inválidas');
    }
    const unitCogs = sumC.div(sumQ);
    const lineTotalCogs = unitCogs.mul(returnQty);
    return { unitCogs, lineTotalCogs };
  }

  private lineSoldDocument(saleLine: {
    quantity: Prisma.Decimal;
    price: Prisma.Decimal;
    discount: Prisma.Decimal | null;
    lineTotalDocument: Prisma.Decimal | null;
  }): Prisma.Decimal {
    if (saleLine.lineTotalDocument != null) {
      return saleLine.lineTotalDocument;
    }
    const disc = saleLine.discount ?? new Prisma.Decimal(0);
    return saleLine.quantity.mul(saleLine.price).minus(disc);
  }

  private lineSoldFunctional(saleLine: {
    quantity: Prisma.Decimal;
    lineTotalFunctional: Prisma.Decimal | null;
    lineTotalDocument: Prisma.Decimal | null;
    price: Prisma.Decimal;
    discount: Prisma.Decimal | null;
  }): Prisma.Decimal {
    if (saleLine.lineTotalFunctional != null) {
      return saleLine.lineTotalFunctional;
    }
    return this.lineSoldDocument(saleLine);
  }

  async create(storeId: string, dto: CreateSaleReturnDto) {
    return this.prisma.$transaction((tx) =>
      this.createSaleReturnTx(tx, storeId, dto),
    );
  }

  async createSaleReturnTx(
    tx: Prisma.TransactionClient,
    storeId: string,
    dto: CreateSaleReturnDto,
  ) {
    const returnId = dto.id ?? randomUUID();

    if (dto.id) {
      const existing = await tx.saleReturn.findFirst({
        where: { id: returnId, storeId },
      });
      if (existing) {
        return tx.saleReturn.findUniqueOrThrow({
          where: { id: returnId },
          include: { lines: true },
        });
      }
    }

    const original = await tx.sale.findFirst({
      where: { id: dto.originalSaleId, storeId },
      include: { saleLines: true },
    });
    if (!original) {
      throw new NotFoundException('Original sale not found for this store');
    }
    if (original.status !== 'CONFIRMED') {
      throw new BadRequestException(
        'Solo se permiten devoluciones sobre ventas CONFIRMED',
      );
    }

    const docCode = original.documentCurrencyCode?.trim().toUpperCase();
    const funCode = original.functionalCurrencyCode?.trim().toUpperCase();
    if (!docCode || !funCode) {
      throw new BadRequestException(
        'La venta original no tiene moneda documento/funcional; no se puede devolver',
      );
    }

    const useSpot = dto.fxPolicy === 'SPOT_ON_RETURN';
    const spotFx = useSpot
      ? await this.storeFx.resolveFxSnapshot(
          storeId,
          docCode,
          funCode,
          dto.fxSnapshot,
        )
      : null;

    const lineById = new Map(original.saleLines.map((l) => [l.id, l]));
    const lineCreates: Prisma.SaleReturnLineCreateWithoutSaleReturnInput[] =
      [];
    let totalDoc = new Prisma.Decimal(0);
    let totalFuncCommercial = new Prisma.Decimal(0);

    for (const req of dto.lines) {
      const sl = lineById.get(req.saleLineId);
      if (!sl) {
        throw new BadRequestException(
          `saleLineId ${req.saleLineId} no pertenece a la venta original`,
        );
      }

      const retQty = new Prisma.Decimal(req.quantity);
      if (!retQty.isFinite() || retQty.lte(0)) {
        throw new BadRequestException('quantity must be a positive decimal');
      }
      if (retQty.gt(sl.quantity)) {
        throw new BadRequestException(
          'Cantidad devuelta supera la vendida en la línea',
        );
      }

      const prevAgg = await tx.saleReturnLine.aggregate({
        where: { saleLineId: sl.id },
        _sum: { quantity: true },
      });
      const alreadyReturned = prevAgg._sum.quantity ?? new Prisma.Decimal(0);
      if (alreadyReturned.plus(retQty).gt(sl.quantity)) {
        throw new BadRequestException(
          'Suma de devoluciones previas + esta cantidad supera lo vendido en la línea',
        );
      }

      const soldDoc = this.lineSoldDocument(sl);
      const soldFunc = this.lineSoldFunctional(sl);
      const lineTotalDocument = soldDoc.mul(retQty).div(sl.quantity);
      let lineTotalFunctionalCommercial: Prisma.Decimal;
      if (useSpot && spotFx) {
        lineTotalFunctionalCommercial =
          docCode === funCode
            ? lineTotalDocument
            : convertAmountDocumentToFunctional(
                lineTotalDocument,
                docCode,
                funCode,
                spotFx.fxBaseCurrencyCode,
                spotFx.fxQuoteCurrencyCode,
                spotFx.fxRateQuotePerBase,
              );
      } else {
        lineTotalFunctionalCommercial = soldFunc
          .mul(retQty)
          .div(sl.quantity);
      }
      const unitPriceDocument = lineTotalDocument.div(retQty);
      const unitPriceFunctionalCommercial =
        lineTotalFunctionalCommercial.div(retQty);

      const { unitCogs, lineTotalCogs } = await this.resolveRestockCostFunctional(
        tx,
        original.id,
        sl.productId,
        retQty,
      );

      const movementOpId =
        dto.opId != null && dto.opId.length > 0
          ? `${dto.opId}:${sl.id}`
          : null;

      await this.inventory.applyInSaleReturnLineTx(tx, {
        storeId,
        productId: sl.productId,
        quantity: retQty,
        saleReturnId: returnId,
        opId: movementOpId,
        unitCostFunctional: unitCogs,
        lineTotalFunctional: lineTotalCogs,
        priceAtMomentDocument: unitPriceDocument,
      });

      lineCreates.push({
        saleLine: { connect: { id: sl.id } },
        product: { connect: { id: sl.productId } },
        quantity: retQty,
        unitPriceDocument,
        unitPriceFunctional: unitPriceFunctionalCommercial,
        lineTotalDocument,
        lineTotalFunctional: lineTotalFunctionalCommercial,
      });

      totalDoc = totalDoc.plus(lineTotalDocument);
      totalFuncCommercial = totalFuncCommercial.plus(
        lineTotalFunctionalCommercial,
      );
    }

    const fxPolicyRow = useSpot ? 'SPOT_ON_RETURN' : 'INHERIT_ORIGINAL_SALE';

    return tx.saleReturn.create({
      data: {
        id: returnId,
        storeId,
        originalSaleId: original.id,
        status: 'CONFIRMED',
        total: totalDoc,
        documentCurrencyCode: original.documentCurrencyCode,
        functionalCurrencyCode: original.functionalCurrencyCode,
        fxBaseCurrencyCode: useSpot
          ? spotFx!.fxBaseCurrencyCode
          : original.fxBaseCurrencyCode,
        fxQuoteCurrencyCode: useSpot
          ? spotFx!.fxQuoteCurrencyCode
          : original.fxQuoteCurrencyCode,
        fxRateQuotePerBase: useSpot
          ? spotFx!.fxRateQuotePerBase
          : original.fxRateQuotePerBase,
        exchangeRateDate: useSpot
          ? spotFx!.exchangeRateDate
          : original.exchangeRateDate,
        fxSource: useSpot ? spotFx!.fxSource : original.fxSource,
        totalDocument: totalDoc,
        totalFunctional: totalFuncCommercial,
        fxPolicy: fxPolicyRow,
        lines: { create: lineCreates },
      },
      include: {
        lines: { include: { product: { select: { sku: true, name: true } } } },
        originalSale: {
          select: { id: true, createdAt: true, totalDocument: true },
        },
      },
    });
  }

  findOne(storeId: string, returnId: string) {
    return this.prisma.saleReturn.findFirst({
      where: { id: returnId, storeId },
      include: {
        lines: {
          include: {
            product: { select: { sku: true, name: true } },
            saleLine: { select: { id: true, quantity: true, price: true } },
          },
        },
        originalSale: {
          select: {
            id: true,
            createdAt: true,
            totalDocument: true,
            totalFunctional: true,
          },
        },
      },
    });
  }
}
