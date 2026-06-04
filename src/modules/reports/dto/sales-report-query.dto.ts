import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { REPORT_PRESETS } from '../../../common/dates/report-date-presets';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class SalesReportQueryDto {
  @ApiPropertyOptional({
    enum: REPORT_PRESETS,
    description:
      'Rango predefinido en zona de la tienda. Si se envía, tiene prioridad sobre dateFrom/dateTo.',
  })
  @IsOptional()
  @IsString()
  @IsIn([...REPORT_PRESETS])
  preset?: string;

  @ApiPropertyOptional({ example: '2026-06-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'dateFrom must be YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-06-07' })
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'dateTo must be YYYY-MM-DD' })
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Filtra ventas (y devoluciones de esas ventas) por `Sale.deviceId`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;
}
