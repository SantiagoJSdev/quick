import {
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateExchangeRateDto {
  @IsString()
  @MaxLength(8)
  baseCurrencyCode: string;

  @IsString()
  @MaxLength(8)
  quoteCurrencyCode: string;

  /** 1 base = rateQuotePerBase quote */
  @IsNumberString()
  rateQuotePerBase: string;

  @IsDateString()
  effectiveDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
