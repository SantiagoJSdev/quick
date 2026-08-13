import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumberString,
  IsObject,
  IsOptional,
  MaxLength,
} from 'class-validator';

export class PatchBusinessSettingsDto {
  @ApiPropertyOptional({
    example: '15',
    description:
      'Margen por defecto de la tienda en porcentaje (ej. "15" = 15%). Rango 0–999.',
  })
  @IsOptional()
  @IsNumberString()
  @MaxLength(20)
  defaultMarginPercent?: string;

  @ApiPropertyOptional({
    description:
      'Permitir ventas POS aunque el stock quede negativo (default true).',
  })
  @IsOptional()
  @IsBoolean()
  allowNegativeStockAtPos?: boolean;

  @ApiPropertyOptional({
    description: 'Emitir warnings / marcar Sale cuando hay conflicto de stock.',
  })
  @IsOptional()
  @IsBoolean()
  warnOnNegativeStock?: boolean;

  @ApiPropertyOptional({
    description:
      'Si true, productos con blockSaleWithoutStock rechazan venta sin stock.',
  })
  @IsOptional()
  @IsBoolean()
  blockRestrictedProductsWithoutStock?: boolean;

  @ApiPropertyOptional({
    description:
      'Cierre de caja: preferir sync exitoso (soft warning en summary).',
  })
  @IsOptional()
  @IsBoolean()
  requireSuccessfulSyncAtClose?: boolean;

  @ApiPropertyOptional({
    description:
      'Config ganancia real (bolsas, platos, nómina, fijos). Ver docs/api/KPIS.md',
  })
  @IsOptional()
  @IsObject()
  realProfitConfig?: Record<string, unknown>;
}
