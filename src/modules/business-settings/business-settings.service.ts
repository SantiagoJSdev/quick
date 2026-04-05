import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BusinessSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertByCurrencyCodes(
    storeId: string,
    functionalCurrencyCode: string,
    defaultSaleDocCurrencyCode: string,
  ) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store) {
      throw new NotFoundException(
        'Store not found. Create the store first with PUT /api/v1/stores/:storeId',
      );
    }

    const funcCode = functionalCurrencyCode.trim().toUpperCase();
    const docCode = defaultSaleDocCurrencyCode.trim().toUpperCase();

    const [func, doc] = await Promise.all([
      this.prisma.currency.findUnique({ where: { code: funcCode } }),
      this.prisma.currency.findUnique({ where: { code: docCode } }),
    ]);
    if (!func) {
      throw new NotFoundException(`Currency not found: ${funcCode}`);
    }
    if (!doc) {
      throw new NotFoundException(`Currency not found: ${docCode}`);
    }

    await this.prisma.businessSettings.upsert({
      where: { storeId },
      create: {
        storeId,
        functionalCurrencyId: func.id,
        defaultSaleDocCurrencyId: doc.id,
      },
      update: {
        functionalCurrencyId: func.id,
        defaultSaleDocCurrencyId: doc.id,
      },
    });

    return this.findByStoreId(storeId);
  }

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
