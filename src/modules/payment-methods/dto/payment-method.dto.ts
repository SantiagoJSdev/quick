import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const CODE_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

export class CreatePaymentMethodDto {
  @ApiProperty({ example: 'DEBITO_BDV' })
  @IsString()
  @Matches(CODE_RE, {
    message: 'code must be UPPER_SNAKE (A-Z, 0-9, _; max 40)',
  })
  code!: string;

  @ApiProperty({ example: 'Débito Banco de Venezuela' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '2.1', description: '% sobre monto funcional' })
  @IsNumberString()
  commissionPercent!: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  isCashLike?: boolean;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class PatchPaymentMethodDto {
  @ApiPropertyOptional({ example: 'Débito BDV' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: '2.5' })
  @IsOptional()
  @IsNumberString()
  commissionPercent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCashLike?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}
