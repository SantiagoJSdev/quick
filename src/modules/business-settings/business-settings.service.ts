import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { PatchBusinessSettingsDto } from './dto/patch-business-settings.dto';

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

  /**
   * Actualización parcial (M7 + política stock POS).
   */
  async patch(storeId: string, dto: PatchBusinessSettingsDto) {
    await this.findByStoreId(storeId);

    const data: Prisma.BusinessSettingsUpdateInput = {};

    if (dto.defaultMarginPercent !== undefined) {
      const d = new Prisma.Decimal(dto.defaultMarginPercent);
      if (!d.isFinite() || d.lt(0) || d.gt(999)) {
        throw new BadRequestException(
          'defaultMarginPercent must be a decimal between 0 and 999',
        );
      }
      data.defaultMarginPercent = d;
    }
    if (dto.allowNegativeStockAtPos !== undefined) {
      data.allowNegativeStockAtPos = dto.allowNegativeStockAtPos;
    }
    if (dto.warnOnNegativeStock !== undefined) {
      data.warnOnNegativeStock = dto.warnOnNegativeStock;
    }
    if (dto.blockRestrictedProductsWithoutStock !== undefined) {
      data.blockRestrictedProductsWithoutStock =
        dto.blockRestrictedProductsWithoutStock;
    }
    if (dto.requireSuccessfulSyncAtClose !== undefined) {
      data.requireSuccessfulSyncAtClose = dto.requireSuccessfulSyncAtClose;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Provide at least one field to update (defaultMarginPercent or stock policy flags)',
      );
    }

    await this.prisma.businessSettings.update({
      where: { storeId },
      data,
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
