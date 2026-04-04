import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    let newTotal: Prisma.Decimal;
    let newAvg: Prisma.Decimal;
    let unitCostForMove: Prisma.Decimal;
    let totalCostForMove: Prisma.Decimal;

    if (dto.type === 'IN_ADJUST') {
      const unitIn = dto.unitCostFunctional
        ? new Prisma.Decimal(dto.unitCostFunctional)
        : item.quantity.gt(0)
          ? item.averageUnitCostFunctional
          : product.cost;

      if (!unitIn.isFinite() || unitIn.lt(0)) {
        throw new BadRequestException('Invalid unit cost for IN adjust');
      }

      const lineTotal = qtyMag.mul(unitIn);
      newQty = item.quantity.plus(qtyMag);
      newTotal = item.totalCostFunctional.plus(lineTotal);
      newAvg = newQty.gt(0) ? newTotal.div(newQty) : new Prisma.Decimal(0);
      unitCostForMove = unitIn;
      totalCostForMove = lineTotal;
    } else {
      const avg = item.quantity.gt(0)
        ? item.averageUnitCostFunctional
        : new Prisma.Decimal(0);
      newQty = item.quantity.minus(qtyMag);
      newTotal = avg.mul(newQty);
      newAvg = newQty.gt(0) ? avg : new Prisma.Decimal(0);
      unitCostForMove = avg;
      totalCostForMove = avg.mul(qtyMag);
    }

    const movement = await tx.stockMovement.create({
      data: {
        opId: dto.opId ?? null,
        productId: dto.productId,
        storeId,
        type: dto.type,
        quantity: qtyMag,
        unitCostFunctional: unitCostForMove,
        totalCostFunctional: totalCostForMove,
        reason: dto.reason ?? null,
      },
    });

    await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: newQty,
        totalCostFunctional: newTotal,
        averageUnitCostFunctional: newAvg,
        lastAdjustedAt: new Date(),
      },
    });

    return { status: 'applied', movementId: movement.id };
  }
}
