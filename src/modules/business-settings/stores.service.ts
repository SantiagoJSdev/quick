import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpsertStoreDto } from './dto/upsert-store.dto';

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsert(storeId: string, dto: UpsertStoreDto) {
    const existed = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });
    const store = await this.prisma.store.upsert({
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
    if (!existed) {
      void this.warnIfNewStoreHasUnexpectedRows(storeId);
    }
    return store;
  }

  /** Defensa en profundidad: una tienda recién creada no debería tener catálogo ni stock. */
  private async warnIfNewStoreHasUnexpectedRows(storeId: string) {
    const [catalogOwned, inv, mov] = await Promise.all([
      this.prisma.product.count({ where: { catalogStoreId: storeId } }),
      this.prisma.inventoryItem.count({ where: { storeId } }),
      this.prisma.stockMovement.count({ where: { storeId } }),
    ]);
    if (catalogOwned > 0 || inv > 0 || mov > 0) {
      this.logger.warn(
        `Store ${storeId} was just created but already has catalogOwnedProducts=${catalogOwned}, inventoryLines=${inv}, stockMovements=${mov} (expected all zero)`,
      );
    }
  }
}
