import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateSupplierDto {
  @ApiProperty({ example: 'Distribuidora Norte' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: '+58 412-0000000' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  phone?: string;

  @ApiPropertyOptional({ example: 'pedidos@ejemplo.com' })
  @IsOptional()
  @ValidateIf((_, v) => v != null && String(v).trim() !== '')
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 'J-00000000-0', description: 'RIF / CUIT / NIT' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
