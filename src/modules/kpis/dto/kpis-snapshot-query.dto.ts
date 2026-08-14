import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { REPORT_PRESETS } from '../../../common/dates/report-date-presets';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class KpisSnapshotQueryDto {
  @ApiPropertyOptional({
    enum: REPORT_PRESETS,
    description:
      'Rango para ganancia/margen (zona tienda). Default `today`. Deuda y stock son snapshot actual.',
  })
  @IsOptional()
  @IsString()
  @IsIn([...REPORT_PRESETS])
  preset?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'dateFrom must be YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-08-13' })
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'dateTo must be YYYY-MM-DD' })
  dateTo?: string;
}
