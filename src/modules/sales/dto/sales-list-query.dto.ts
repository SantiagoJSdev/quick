import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class SalesListQueryDto {
  @ApiPropertyOptional({
    example: '2026-04-01',
    description:
      'Inicio inclusive, calendario `YYYY-MM-DD` en la zona de la tienda (`Store.timezone`, o `UTC` si no hay).',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'dateFrom must be YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-04-07',
    description: 'Fin inclusive, `YYYY-MM-DD` en la misma zona que dateFrom.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'dateTo must be YYYY-MM-DD' })
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Filtra ventas con este `deviceId` (mismo que POST /sales / sync).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Cursor opaco devuelto en `nextCursor` (paginación keyset). No combinar con `format=array`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @ApiPropertyOptional({
    enum: ['object', 'array'],
    default: 'object',
    description:
      '`object`: `{ items, nextCursor, meta }` (recomendado, permite paginar). `array`: solo la lista JSON (sin `nextCursor`; no enviar `cursor`).',
  })
  @IsOptional()
  @IsIn(['object', 'array'])
  format?: 'object' | 'array';
}
