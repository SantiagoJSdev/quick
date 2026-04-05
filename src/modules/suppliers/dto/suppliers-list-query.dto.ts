import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SuppliersListQueryDto {
  @ApiPropertyOptional({
    description: 'Busca en name, taxId, phone (case-insensitive, contiene).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false', 'all'],
    default: 'true',
    description:
      '`true`: solo activos (default). `false`: solo inactivos. `all`: ambos.',
  })
  @IsOptional()
  @IsIn(['true', 'false', 'all'])
  active?: 'true' | 'false' | 'all';

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @ApiPropertyOptional({ enum: ['object', 'array'], default: 'object' })
  @IsOptional()
  @IsIn(['object', 'array'])
  format?: 'object' | 'array';
}
