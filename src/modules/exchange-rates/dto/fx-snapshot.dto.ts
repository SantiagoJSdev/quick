import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** Snapshot FX enviado al confirmar documento (venta/compra) o en sync offline. */
export class FxSnapshotDto {
  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(10)
  baseCurrencyCode!: string;

  @ApiProperty({ example: 'VES' })
  @IsString()
  @MaxLength(10)
  quoteCurrencyCode!: string;

  @ApiProperty({ example: '36.50' })
  @IsNumberString()
  rateQuotePerBase!: string;

  @ApiProperty({ example: '2026-04-04' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveDate!: string;

  @ApiPropertyOptional({
    example: 'POS_OFFLINE',
    description:
      'Si es POS_OFFLINE se acepta la tasa del payload sin comparar al servidor.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  fxSource?: string;
}
