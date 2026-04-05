import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpsertStoreDto } from './dto/upsert-store.dto';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  upsert(storeId: string, dto: UpsertStoreDto) {
    return this.prisma.store.upsert({
      where: { id: storeId },
      create: {
        id: storeId,
        name: dto.name.trim(),
        type: dto.type,
      },
      update: {
        name: dto.name.trim(),
        type: dto.type,
      },
    });
  }
}
