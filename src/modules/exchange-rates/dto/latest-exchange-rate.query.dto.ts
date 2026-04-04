import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class LatestExchangeRateQueryDto {
  @IsString()
  @MaxLength(8)
  baseCurrencyCode: string;

  @IsString()
  @MaxLength(8)
  quoteCurrencyCode: string;

  /** Fecha efectiva (ISO date). Por defecto: hoy UTC. */
  @IsOptional()
  @IsDateString()
  effectiveOn?: string;
}
