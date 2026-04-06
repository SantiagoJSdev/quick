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

export class CreateProductDto {
  @ApiPropertyOptional({
    description:
      'Referencia interna de catálogo/inventario. Si se omite o viene vacío, el servidor genera `SKU-000001`, `SKU-000002`, … (único). No confundir con código de barras.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  sku?: string;

  @ApiPropertyOptional({
    description:
      'Código escaneable en POS; único en BD solo si se informa (varios productos pueden tener barcode null).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  barcode?: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;

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

  @ApiPropertyOptional({
    enum: ProductPricingMode,
    default: ProductPricingMode.USE_STORE_DEFAULT,
  })
  @IsOptional()
  @IsEnum(ProductPricingMode)
  pricingMode?: ProductPricingMode;

  @ApiPropertyOptional({
    description:
      'Porcentaje de margen sobre costo (0–999). Tiene efecto principalmente con `USE_PRODUCT_OVERRIDE`.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsNumberString()
  marginPercentOverride?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

