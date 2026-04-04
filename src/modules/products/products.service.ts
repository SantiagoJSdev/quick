import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  buildProductOutboxPayload,
  productOutboxInclude,
} from './product-outbox.payload';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...dto,
          price: this.toDecimal(dto.price),
          cost: this.toDecimal(dto.cost),
        },
        include: productOutboxInclude,
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: 'PRODUCT_CREATED',
          payload: buildProductOutboxPayload(product),
        },
      });

      return product;
    });
  }

  async findAll(includeInactive = false) {
    return this.prisma.product.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          ...dto,
          price: this.toDecimal(dto.price),
          cost: this.toDecimal(dto.cost),
        },
        include: productOutboxInclude,
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: 'PRODUCT_UPDATED',
          payload: buildProductOutboxPayload(product),
        },
      });

      return product;
    });
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    if (!existing.active) {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: { active: false },
        include: productOutboxInclude,
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: 'PRODUCT_DEACTIVATED',
          payload: buildProductOutboxPayload(product),
        },
      });

      return product;
    });
  }

  private toDecimal(value?: string) {
    if (value === undefined) {
      return undefined;
    }
    return new Prisma.Decimal(value);
  }
}
