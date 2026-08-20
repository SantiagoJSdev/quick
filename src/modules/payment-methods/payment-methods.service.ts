import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decimalToReportString } from '../../common/reports/report-amounts';
import { PrismaService } from '../../prisma/prisma.service';
import { GASTO_PAYMENT_METHODS } from '../kpis/gasto-constants';
import type {
  CreatePaymentMethodDto,
  PatchPaymentMethodDto,
} from './dto/payment-method.dto';

export type PaymentMethodPublic = {
  id: string;
  code: string;
  name: string;
  commissionPercent: string;
  isCashLike: boolean;
  active: boolean;
  sortOrder: number;
};

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Si la tienda no tiene catálogo, siembra GASTO_PAYMENT_METHODS. */
  async ensureDefaults(storeId: string): Promise<void> {
    const count = await this.prisma.storePaymentMethod.count({
      where: { storeId },
    });
    if (count > 0) return;

    await this.prisma.storePaymentMethod.createMany({
      data: GASTO_PAYMENT_METHODS.map((m, i) => ({
        storeId,
        code: m.code,
        name: m.name,
        commissionPercent: new Prisma.Decimal(m.commissionPercent),
        isCashLike: m.isCashLike,
        active: true,
        sortOrder: (i + 1) * 10,
      })),
      skipDuplicates: true,
    });
  }

  async listActive(storeId: string) {
    await this.ensureDefaults(storeId);
    const rows = await this.prisma.storePaymentMethod.findMany({
      where: { storeId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return { items: rows.map((r) => this.toPublic(r)) };
  }

  async listAdmin(storeId: string) {
    await this.ensureDefaults(storeId);
    const rows = await this.prisma.storePaymentMethod.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return { items: rows.map((r) => this.toPublic(r)) };
  }

  /** Mapa code → % / isCashLike (activos) para calcular comisión al cobrar. */
  async activeCommissionMap(storeId: string) {
    await this.ensureDefaults(storeId);
    const rows = await this.prisma.storePaymentMethod.findMany({
      where: { storeId, active: true },
      select: {
        code: true,
        commissionPercent: true,
        isCashLike: true,
        name: true,
      },
    });
    return new Map(rows.map((r) => [r.code, r]));
  }

  async create(storeId: string, dto: CreatePaymentMethodDto) {
    const code = dto.code.trim().toUpperCase();
    const pct = this.parsePercent(dto.commissionPercent);
    try {
      const row = await this.prisma.storePaymentMethod.create({
        data: {
          storeId,
          code,
          name: dto.name.trim(),
          commissionPercent: pct,
          isCashLike: dto.isCashLike ?? false,
          active: dto.active ?? true,
          sortOrder: dto.sortOrder ?? 100,
        },
      });
      return this.toPublic(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`Payment method code already exists: ${code}`);
      }
      throw err;
    }
  }

  async patch(storeId: string, id: string, dto: PatchPaymentMethodDto) {
    const existing = await this.prisma.storePaymentMethod.findFirst({
      where: { id, storeId },
    });
    if (!existing) {
      throw new NotFoundException('Payment method not found');
    }

    const data: Prisma.StorePaymentMethodUpdateInput = {};
    if (dto.name != null) data.name = dto.name.trim();
    if (dto.commissionPercent != null) {
      data.commissionPercent = this.parsePercent(dto.commissionPercent);
    }
    if (dto.isCashLike != null) data.isCashLike = dto.isCashLike;
    if (dto.active != null) data.active = dto.active;
    if (dto.sortOrder != null) data.sortOrder = dto.sortOrder;

    const row = await this.prisma.storePaymentMethod.update({
      where: { id },
      data,
    });
    return this.toPublic(row);
  }

  private parsePercent(raw: string): Prisma.Decimal {
    const pct = new Prisma.Decimal(raw);
    if (!pct.isFinite() || pct.lt(0) || pct.gt(100)) {
      throw new BadRequestException(
        'commissionPercent must be a decimal between 0 and 100',
      );
    }
    return pct;
  }

  private toPublic(row: {
    id: string;
    code: string;
    name: string;
    commissionPercent: Prisma.Decimal;
    isCashLike: boolean;
    active: boolean;
    sortOrder: number;
  }): PaymentMethodPublic {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      commissionPercent: decimalToReportString(row.commissionPercent),
      isCashLike: row.isCashLike,
      active: row.active,
      sortOrder: row.sortOrder,
    };
  }
}
