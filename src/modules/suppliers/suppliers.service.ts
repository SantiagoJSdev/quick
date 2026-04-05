import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateSupplierDto } from './dto/create-supplier.dto';
import type { SuppliersListQueryDto } from './dto/suppliers-list-query.dto';
import type { UpdateSupplierDto } from './dto/update-supplier.dto';
import {
  decodeSupplierListCursor,
  encodeSupplierListCursor,
} from './suppliers-list-cursor';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(storeId: string, dto: CreateSupplierDto) {
    const name = dto.name.trim();
    const taxId = dto.taxId?.trim() || null;
    const phone = dto.phone?.trim() || null;
    const email = dto.email?.trim() || null;
    const address = dto.address?.trim() || null;
    const notes = dto.notes?.trim() || null;

    return this.prisma.supplier.create({
      data: {
        storeId,
        name,
        taxId,
        phone,
        email,
        address,
        notes,
        active: true,
      },
    });
  }

  async list(storeId: string, query: SuppliersListQueryDto) {
    if (query.format === 'array' && query.cursor?.trim()) {
      throw new BadRequestException(
        'format=array does not support cursor; omit cursor or use format=object (default)',
      );
    }

    const limit = query.limit ?? 50;
    const activeMode = query.active ?? 'true';
    const search = query.q?.trim();

    const cursorDecoded = query.cursor?.trim()
      ? decodeSupplierListCursor(query.cursor.trim())
      : null;

    const andParts: Prisma.SupplierWhereInput[] = [{ storeId }];
    if (activeMode !== 'all') {
      andParts.push({ active: activeMode === 'true' });
    }
    if (search) {
      andParts.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { taxId: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      });
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

    const rows = await this.prisma.supplier.findMany({
      where: { AND: andParts },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last != null ? encodeSupplierListCursor(last) : null;

    return {
      items: page,
      nextCursor,
      meta: {
        limit,
        hasMore,
        activeFilter: activeMode,
      },
    };
  }

  async findOne(storeId: string, id: string) {
    const row = await this.prisma.supplier.findFirst({
      where: { id, storeId },
    });
    if (!row) {
      throw new NotFoundException('Supplier not found');
    }
    return row;
  }

  async update(storeId: string, id: string, dto: UpdateSupplierDto) {
    await this.findOne(storeId, id);

    const data: Prisma.SupplierUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name.trim();
    }
    if (dto.phone !== undefined) {
      data.phone = dto.phone.trim() || null;
    }
    if (dto.email !== undefined) {
      data.email = dto.email.trim() || null;
    }
    if (dto.address !== undefined) {
      data.address = dto.address.trim() || null;
    }
    if (dto.taxId !== undefined) {
      data.taxId = dto.taxId.trim() || null;
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes.trim() || null;
    }
    if (dto.active !== undefined) {
      data.active = dto.active;
    }

    return this.prisma.supplier.update({
      where: { id },
      data,
    });
  }

  /** Soft delete: `active = false` (mantiene historial de compras). */
  async softDelete(storeId: string, id: string) {
    return this.update(storeId, id, { active: false });
  }
}
