import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class RunCapitalSnapshotDto {
  @ApiPropertyOptional({
    example: '2026-08-17',
    description:
      'Día Caracas YYYY-MM-DD. Default = ayer. Inventario/deuda se fotografían ahora.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}
