import {
  IsBoolean,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ProductType } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  @MaxLength(120)
  sku: string;

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

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

