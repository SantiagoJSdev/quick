import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BusinessSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByStoreId(storeId: string) {
    const row = await this.prisma.businessSettings.findUnique({
      where: { storeId },
      include: {
        functionalCurrency: true,
        defaultSaleDocCurrency: true,
        store: { select: { id: true, name: true, type: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Business settings not found for this store');
    }
    return row;
  }
}
