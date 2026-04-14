import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ProductPricingMode, ProductType } from '@prisma/client';

export class UpdateProductDto {
  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @ValidateIf((_, v) => v === null || typeof v === 'string')
  @IsString()
  image?: string | null;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsNumberString()
  price?: string;

  @IsOptional()
  @IsNumberString()
  cost?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsUUID()
  taxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsEnum(ProductPricingMode)
  pricingMode?: ProductPricingMode;

  @IsOptional()
  @IsNumberString()
  marginPercentOverride?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Si es true: tras aplicar el resto del body, persiste `price` igual al `suggestedPrice` M7 (mismo cálculo que en la respuesta), salvo `MANUAL_PRICE` o costo/margen que no permitan sugerido — en ese caso el flag se ignora. No combinar con `price` en el mismo request.',
  })
  @IsOptional()
  @IsBoolean()
  applySuggestedListPrice?: boolean;
}

