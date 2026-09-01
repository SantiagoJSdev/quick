import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  operationalUnitCostFunctional,
} from '../../common/inventory/operational-unit-cost';
import { inventoryItemTotalsFromCatalog } from '../../common/inventory/inventory-item-totals';
import { applyCatalogCostFromAdjust } from '../../common/products/sync-catalog-from-purchase';
import { PrismaService } from '../../prisma/prisma.service';
import type { InventoryAdjustDto } from './dto/inventory-adjust.dto';

export type AdjustTxResult =
  | { status: 'applied'; movementId: string }
  | {
      status: 'skipped';
      movementId: string;
      reason: 'duplicate_op_id';
    };

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  listForStore(storeId: string) {
    return this.prisma.inventoryItem.findMany({
      where: { storeId },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            active: true,
            currency: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getLine(storeId: string, productId: string) {
    const row = await this.prisma.inventoryItem.findUnique({
      where: { productId_storeId: { productId, storeId } },
      include: {
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            active: true,
            price: true,
            cost: true,
            currency: true,
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundException(
        'Inventory line not found for this product and store',
      );
    }
    return row;
  }

  listMovements(storeId: string, productId?: string, limit = 100) {
    const take = Math.min(500, Math.max(1, limit));
    return this.prisma.stockMovement.findMany({
      where: { storeId, ...(productId ? { productId } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        product: { select: { id: true, sku: true, name: true } },
      },
    });
  }

  adjust(storeId: string, dto: InventoryAdjustDto) {
    return this.prisma.$transaction((tx) =>
      this.applyAdjustTx(tx, storeId, dto),
    );
  }

  /**
   * Ajuste atómico (misma transacción que sync/push si se invoca desde ahí).
   */
  async applyAdjustTx(
    tx: Prisma.TransactionClient,
    storeId: string,
    dto: InventoryAdjustDto,
  ): Promise<AdjustTxResult> {
    const qtyMag = new Prisma.Decimal(dto.quantity);
    if (!qtyMag.isFinite() || qtyMag.lte(0)) {
      throw new BadRequestException('quantity must be a positive decimal');
    }

    if (dto.opId) {
      const dup = await tx.stockMovement.findUnique({
        where: { opId: dto.opId },
      });
      if (dup) {
        if (dup.storeId !== storeId || dup.productId !== dto.productId) {
          throw new BadRequestException(
            'opId already used for another movement',
          );
        }
        return {
          status: 'skipped',
          movementId: dup.id,
          reason: 'duplicate_op_id',
        };
      }
    }

    const product = await tx.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    let catalogProduct = product;

    if (dto.type === 'IN_ADJUST' && dto.unitCostFunctional?.trim()) {
      const explicit = new Prisma.Decimal(dto.unitCostFunctional);
      if (explicit.isFinite() && explicit.gt(0)) {
        await applyCatalogCostFromAdjust(tx, {
          productId: dto.productId,
          unitCostFunctional: explicit,
        });
        catalogProduct = await tx.product.findUniqueOrThrow({
          where: { id: dto.productId },
        });
      }
    }

    let item = await tx.inventoryItem.findUnique({
      where: { productId_storeId: { productId: dto.productId, storeId } },
    });

    if (!item) {
      item = await tx.inventoryItem.create({
        data: {
          productId: dto.productId,
          storeId,
          quantity: new Prisma.Decimal(0),
          reserved: new Prisma.Decimal(0),
          minStock: new Prisma.Decimal(0),
          averageUnitCostFunctional: new Prisma.Decimal(0),
          totalCostFunctional: new Prisma.Decimal(0),
        },
      });
    }

    if (dto.type === 'OUT_ADJUST') {
      const available = item.quantity.minus(item.reserved);
      if (available.lt(qtyMag)) {
        throw new BadRequestException(
          'Insufficient stock (quantity minus reserved)',
        );
      }
    }

    let newQty: Prisma.Decimal;
    let unitCostForMove: Prisma.Decimal;
    let totalCostForMove: Prisma.Decimal;

    if (dto.type === 'IN_ADJUST') {
      const unitIn = this.resolveInAdjustUnitCost(dto, item, catalogProduct);

      if (!unitIn.isFinite() || unitIn.lte(0)) {
        throw new BadRequestException({
          code: 'INVALID_UNIT_COST_FOR_IN_ADJUST',
          message: 'Costo unitario inválido para IN_ADJUST.',
        });
      }

      newQty = item.quantity.plus(qtyMag);
      unitCostForMove = unitIn;
      totalCostForMove = qtyMag.mul(unitIn);
    } else {
      const unitCost = operationalUnitCostFunctional(catalogProduct.cost, null);
      newQty = item.quantity.minus(qtyMag);
      unitCostForMove = unitCost;
      totalCostForMove = unitCost.mul(qtyMag);
    }

    const valued = inventoryItemTotalsFromCatalog(newQty, catalogProduct.cost);

    const movement = await tx.stockMovement.create({
      data: {
        opId: dto.opId ?? null,
        productId: dto.productId,
        storeId,
        type: dto.type,
        quantity: qtyMag,
        unitCostFunctional: unitCostForMove,
        totalCostFunctional: totalCostForMove,
        costAtMoment:
          dto.type === 'IN_ADJUST' && catalogProduct.cost.gt(0)
            ? catalogProduct.cost
            : null,
        reason: dto.reason ?? null,
      },
    });

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: newQty,
        totalCostFunctional: valued.totalCost,
        averageUnitCostFunctional: valued.unitCost,
        lastAdjustedAt: new Date(),
      },
    });

    return { status: 'applied', movementId: movement.id };
  }

  /**
   * Salida por venta (`OUT_SALE`). Costo = `Product.cost` (catálogo).
   * `opId` opcional (p. ej. `${syncOpId}:${productId}`) para idempotencia.
   * Si la política de tienda lo permite, el stock puede quedar negativo.
   */
  async applyOutSaleLineTx(
    tx: Prisma.TransactionClient,
    params: {
      storeId: string;
      productId: string;
      quantity: Prisma.Decimal;
      saleId: string;
      opId?: string | null;
      priceAtMomentDocument?: Prisma.Decimal | null;
      /** COGS unitario congelado (offline / foto al cobro). Si se omite, usa `Product.cost`. */
      unitCostFunctional?: Prisma.Decimal | null;
      /** Override: si false, siempre strict. Si omitido, lee BusinessSettings + Product. */
      allowNegativeStock?: boolean;
    },
  ): Promise<{
    movementId: string;
    stockConflict: boolean;
    availableBefore: string;
    quantityAfter: string;
  }> {
    const { storeId, productId, quantity: qtyMag, saleId } = params;
    if (!qtyMag.isFinite() || qtyMag.lte(0)) {
      throw new BadRequestException('Invalid sale line quantity');
    }

    if (params.opId) {
      const dup = await tx.stockMovement.findUnique({
        where: { opId: params.opId },
      });
      if (dup) {
        if (dup.storeId !== storeId || dup.productId !== productId) {
          throw new BadRequestException(
            'opId already used for another movement',
          );
        }
        const itemAfter = await tx.inventoryItem.findUnique({
          where: { productId_storeId: { productId, storeId } },
        });
        return {
          movementId: dup.id,
          stockConflict: false,
          availableBefore: '0',
          quantityAfter: itemAfter?.quantity.toString() ?? '0',
        };
      }
    }

    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const settings = await tx.businessSettings.findUnique({
      where: { storeId },
    });

    const storeAllows =
      params.allowNegativeStock !== undefined
        ? params.allowNegativeStock
        : (settings?.allowNegativeStockAtPos ?? true);
    const blockRestricted =
      settings?.blockRestrictedProductsWithoutStock ?? true;
    const productBlocks = product.blockSaleWithoutStock === true;
    const effectiveAllowNegative =
      storeAllows && !(blockRestricted && productBlocks);

    let item = await tx.inventoryItem.findUnique({
      where: { productId_storeId: { productId, storeId } },
    });

    if (!item) {
      item = await tx.inventoryItem.create({
        data: {
          productId,
          storeId,
          quantity: new Prisma.Decimal(0),
          reserved: new Prisma.Decimal(0),
          minStock: new Prisma.Decimal(0),
          averageUnitCostFunctional: new Prisma.Decimal(0),
          totalCostFunctional: new Prisma.Decimal(0),
        },
      });
    }

    const available = item.quantity.minus(item.reserved);
    const stockConflict = available.lt(qtyMag);
    if (stockConflict && !effectiveAllowNegative) {
      throw new BadRequestException(
        'Insufficient stock (quantity minus reserved)',
      );
    }

    const unitCost =
      params.unitCostFunctional != null &&
      params.unitCostFunctional.isFinite() &&
      params.unitCostFunctional.gt(0)
        ? params.unitCostFunctional
        : operationalUnitCostFunctional(product.cost, null);
    const newQty = item.quantity.minus(qtyMag);
    const totalCostForMove = unitCost.mul(qtyMag);
    const valued = inventoryItemTotalsFromCatalog(newQty, product.cost);

    const movement = await tx.stockMovement.create({
      data: {
        opId: params.opId ?? null,
        productId,
        storeId,
        type: 'OUT_SALE',
        quantity: qtyMag,
        unitCostFunctional: unitCost,
        totalCostFunctional: totalCostForMove,
        costAtMoment: unitCost.gt(0) ? unitCost : null,
        priceAtMoment: params.priceAtMomentDocument ?? null,
        referenceId: saleId,
        reason: null,
      },
    });

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: newQty,
        totalCostFunctional: valued.totalCost,
        averageUnitCostFunctional: valued.unitCost,
        lastAdjustedAt: new Date(),
      },
    });

    return {
      movementId: movement.id,
      stockConflict,
      availableBefore: available.toString(),
      quantityAfter: newQty.toString(),
    };
  }

  /**
   * Entrada por compra recibida (`IN_PURCHASE`). Catálogo se actualiza en PurchasesService.
   */
  async applyInPurchaseLineTx(
    tx: Prisma.TransactionClient,
    params: {
      storeId: string;
      productId: string;
      quantity: Prisma.Decimal;
      purchaseId: string;
      opId?: string | null;
      unitCostFunctional: Prisma.Decimal;
      lineTotalFunctional: Prisma.Decimal;
      unitCostDocument?: Prisma.Decimal | null;
      lineTotalDocument?: Prisma.Decimal | null;
    },
  ): Promise<{ movementId: string }> {
    const {
      storeId,
      productId,
      quantity: qtyMag,
      purchaseId,
      unitCostFunctional,
      lineTotalFunctional,
    } = params;
    if (!qtyMag.isFinite() || qtyMag.lte(0)) {
      throw new BadRequestException('Invalid purchase line quantity');
    }
    if (!unitCostFunctional.isFinite() || unitCostFunctional.lt(0)) {
      throw new BadRequestException('Invalid unit cost (functional)');
    }

    if (params.opId) {
      const dup = await tx.stockMovement.findUnique({
        where: { opId: params.opId },
      });
      if (dup) {
        if (dup.storeId !== storeId || dup.productId !== productId) {
          throw new BadRequestException(
            'opId already used for another movement',
          );
        }
        return { movementId: dup.id };
      }
    }

    // Producto ya validado por el caller (purchase create); FK protege el create.
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    let item = await tx.inventoryItem.findUnique({
      where: { productId_storeId: { productId, storeId } },
    });

    if (!item) {
      item = await tx.inventoryItem.create({
        data: {
          productId,
          storeId,
          quantity: new Prisma.Decimal(0),
          reserved: new Prisma.Decimal(0),
          minStock: new Prisma.Decimal(0),
          averageUnitCostFunctional: new Prisma.Decimal(0),
          totalCostFunctional: new Prisma.Decimal(0),
        },
      });
    }

    const newQty = item.quantity.plus(qtyMag);
    const valued = inventoryItemTotalsFromCatalog(newQty, product.cost);

    const movement = await tx.stockMovement.create({
      data: {
        opId: params.opId ?? null,
        productId,
        storeId,
        type: 'IN_PURCHASE',
        quantity: qtyMag,
        unitCostFunctional,
        totalCostFunctional: lineTotalFunctional,
        costAtMoment: params.unitCostDocument ?? null,
        referenceId: purchaseId,
        reason: null,
      },
    });

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: newQty,
        totalCostFunctional: valued.totalCost,
        averageUnitCostFunctional: valued.unitCost,
        lastAdjustedAt: new Date(),
      },
    });

    return { movementId: movement.id };
  }

  /**
   * Entrada por devolución de venta (`IN_RETURN`). Movimiento al COGS original;
   * totales de ítem espejan `Product.cost` (catálogo).
   */
  async applyInSaleReturnLineTx(
    tx: Prisma.TransactionClient,
    params: {
      storeId: string;
      productId: string;
      quantity: Prisma.Decimal;
      saleReturnId: string;
      opId?: string | null;
      unitCostFunctional: Prisma.Decimal;
      lineTotalFunctional: Prisma.Decimal;
      priceAtMomentDocument?: Prisma.Decimal | null;
    },
  ): Promise<{ movementId: string }> {
    const {
      storeId,
      productId,
      quantity: qtyMag,
      saleReturnId,
      unitCostFunctional,
      lineTotalFunctional,
    } = params;
    if (!qtyMag.isFinite() || qtyMag.lte(0)) {
      throw new BadRequestException('Invalid return line quantity');
    }
    if (!unitCostFunctional.isFinite() || unitCostFunctional.lt(0)) {
      throw new BadRequestException('Invalid restock unit cost (functional)');
    }

    if (params.opId) {
      const dup = await tx.stockMovement.findUnique({
        where: { opId: params.opId },
      });
      if (dup) {
        if (dup.storeId !== storeId || dup.productId !== productId) {
          throw new BadRequestException(
            'opId already used for another movement',
          );
        }
        return { movementId: dup.id };
      }
    }

    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    let item = await tx.inventoryItem.findUnique({
      where: { productId_storeId: { productId, storeId } },
    });

    if (!item) {
      item = await tx.inventoryItem.create({
        data: {
          productId,
          storeId,
          quantity: new Prisma.Decimal(0),
          reserved: new Prisma.Decimal(0),
          minStock: new Prisma.Decimal(0),
          averageUnitCostFunctional: new Prisma.Decimal(0),
          totalCostFunctional: new Prisma.Decimal(0),
        },
      });
    }

    const newQty = item.quantity.plus(qtyMag);
    const valued = inventoryItemTotalsFromCatalog(newQty, product.cost);

    const movement = await tx.stockMovement.create({
      data: {
        opId: params.opId ?? null,
        productId,
        storeId,
        type: 'IN_RETURN',
        quantity: qtyMag,
        unitCostFunctional,
        totalCostFunctional: lineTotalFunctional,
        priceAtMoment: params.priceAtMomentDocument ?? null,
        referenceId: saleReturnId,
        reason: null,
      },
    });

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: newQty,
        totalCostFunctional: valued.totalCost,
        averageUnitCostFunctional: valued.unitCost,
        lastAdjustedAt: new Date(),
      },
    });

    return { movementId: movement.id };
  }

  /**
   * Salida al anular compra (`OUT_PURCHASE_VOID`). Solo debe llamarse con qty ya
   * calculada como reversible (≤ available). Idempotente por opId.
   */
  async applyOutPurchaseVoidLineTx(
    tx: Prisma.TransactionClient,
    params: {
      storeId: string;
      productId: string;
      quantity: Prisma.Decimal;
      purchaseId: string;
      opId?: string | null;
    },
  ) {
    const { storeId, productId, quantity: qtyMag } = params;
    if (!qtyMag.isFinite() || qtyMag.lte(0)) {
      throw new BadRequestException('void quantity must be > 0');
    }

    if (params.opId) {
      const dup = await tx.stockMovement.findUnique({
        where: { opId: params.opId },
      });
      if (dup) {
        if (dup.storeId !== storeId || dup.productId !== productId) {
          throw new BadRequestException(
            'opId already used for another movement',
          );
        }
        return { movementId: dup.id, status: 'skipped' as const };
      }
    }

    let item = await tx.inventoryItem.findUnique({
      where: { productId_storeId: { productId, storeId } },
    });
    if (!item) {
      throw new BadRequestException('No inventory line for product/store');
    }

    const available = item.quantity.minus(item.reserved);
    if (available.lt(qtyMag)) {
      throw new BadRequestException(
        'Insufficient stock for purchase void reverse',
      );
    }

    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const unitCost = operationalUnitCostFunctional(product.cost, null);
    const newQty = item.quantity.minus(qtyMag);
    const valued = inventoryItemTotalsFromCatalog(newQty, product.cost);

    const movement = await tx.stockMovement.create({
      data: {
        opId: params.opId ?? null,
        productId,
        storeId,
        type: 'OUT_PURCHASE_VOID',
        quantity: qtyMag,
        unitCostFunctional: unitCost,
        totalCostFunctional: unitCost.mul(qtyMag),
        referenceId: params.purchaseId,
        reason: 'PURCHASE_VOID',
      },
    });

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: newQty,
        totalCostFunctional: valued.totalCost,
        averageUnitCostFunctional: valued.unitCost,
        lastAdjustedAt: new Date(),
      },
    });

    return { movementId: movement.id, status: 'applied' as const };
  }

  registerLoss(
    storeId: string,
    dto: {
      productId: string;
      quantity: string;
      reason: string;
      opId?: string;
    },
  ) {
    return this.prisma.$transaction((tx) =>
      this.applyOutLossTx(tx, storeId, dto),
    );
  }

  /**
   * Baja por merma (`OUT_LOSS`). Costo = `Product.cost` (catálogo); promedio solo
   * si catálogo = 0. No deja qty por debajo de reserved (misma regla que OUT_ADJUST).
   */
  async applyOutLossTx(
    tx: Prisma.TransactionClient,
    storeId: string,
    dto: {
      productId: string;
      quantity: string;
      reason: string;
      opId?: string;
    },
  ) {
    const qtyMag = new Prisma.Decimal(dto.quantity);
    if (!qtyMag.isFinite() || qtyMag.lte(0)) {
      throw new BadRequestException('quantity must be a positive decimal');
    }

    if (dto.opId) {
      const dup = await tx.stockMovement.findUnique({
        where: { opId: dto.opId },
      });
      if (dup) {
        if (dup.storeId !== storeId || dup.productId !== dto.productId) {
          throw new BadRequestException(
            'opId already used for another movement',
          );
        }
        if (dup.type !== 'OUT_LOSS') {
          throw new BadRequestException(
            'opId already used for another movement',
          );
        }
        return {
          status: 'skipped' as const,
          movementId: dup.id,
          productId: dto.productId,
          quantity: dup.quantity.toString(),
          unitCostFunctional: dup.unitCostFunctional?.toString() ?? '0',
          totalCostFunctional: dup.totalCostFunctional?.toString() ?? '0',
        };
      }
    }

    const product = await tx.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, sku: true, name: true, cost: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const item = await tx.inventoryItem.findUnique({
      where: { productId_storeId: { productId: dto.productId, storeId } },
    });
    if (!item) {
      throw new BadRequestException('No inventory line for product/store');
    }

    const available = item.quantity.minus(item.reserved);
    if (available.lt(qtyMag)) {
      throw new BadRequestException(
        `Insufficient stock for loss (available ${available.toString()})`,
      );
    }

    const unitCost = operationalUnitCostFunctional(product.cost, null);
    const lineCost = unitCost.mul(qtyMag);
    const newQty = item.quantity.minus(qtyMag);
    const valued = inventoryItemTotalsFromCatalog(newQty, product.cost);

    const movement = await tx.stockMovement.create({
      data: {
        opId: dto.opId ?? null,
        productId: dto.productId,
        storeId,
        type: 'OUT_LOSS',
        quantity: qtyMag,
        unitCostFunctional: unitCost,
        totalCostFunctional: lineCost,
        costAtMoment: product.cost.gt(0) ? product.cost : null,
        reason: dto.reason.trim().slice(0, 240),
      },
    });

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: newQty,
        totalCostFunctional: valued.totalCost,
        averageUnitCostFunctional: valued.unitCost,
        lastAdjustedAt: new Date(),
      },
    });

    return {
      status: 'applied' as const,
      movementId: movement.id,
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      quantity: qtyMag.toString(),
      unitCostFunctional: unitCost.toString(),
      totalCostFunctional: lineCost.toString(),
      quantityAfter: newQty.toString(),
    };
  }

  /**
   * Costo unitario para IN_ADJUST (solo catálogo; sin promedio ponderado):
   * - body explícito → ese valor (y actualiza `Product.cost` antes);
   * - si no → `Product.cost` si > 0;
   * - stock ≤ 0 y catálogo = 0 → error claro.
   */
  private resolveInAdjustUnitCost(
    dto: Pick<InventoryAdjustDto, 'unitCostFunctional'>,
    item: {
      quantity: Prisma.Decimal;
    },
    product: { cost: Prisma.Decimal },
  ): Prisma.Decimal {
    if (dto.unitCostFunctional?.trim()) {
      return new Prisma.Decimal(dto.unitCostFunctional);
    }
    const catalogCost = product.cost;
    if (catalogCost != null && catalogCost.gt(0)) {
      return catalogCost;
    }
    if (item.quantity.lte(0)) {
      throw new BadRequestException({
        code: 'UNIT_COST_REQUIRED_FOR_ZERO_STOCK',
        message: 'Indicá costo unitario al reingresar stock con cantidad 0.',
      });
    }
    throw new BadRequestException({
      code: 'INVALID_UNIT_COST_FOR_IN_ADJUST',
      message:
        'Product.cost es 0; indicá unitCostFunctional o actualizá el catálogo.',
    });
  }
}
