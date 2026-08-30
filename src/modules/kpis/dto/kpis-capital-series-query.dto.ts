import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { CAPITAL_SERIES_PRESETS } from '../capital-snapshot.util';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class KpisCapitalSeriesQueryDto {
  @ApiPropertyOptional({
    enum: CAPITAL_SERIES_PRESETS,
    description:
      '`week` = últimos 7 días calendario de la tienda. `month` = mes en curso hasta hoy.',
  })
  @IsOptional()
  @IsString()
  @IsIn([...CAPITAL_SERIES_PRESETS])
  preset?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'dateFrom must be YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-08-14' })
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'dateTo must be YYYY-MM-DD' })
  dateTo?: string;
}
