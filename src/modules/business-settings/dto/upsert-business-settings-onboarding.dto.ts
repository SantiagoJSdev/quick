import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpsertBusinessSettingsOnboardingDto {
  @ApiProperty({ example: 'USD', description: 'Código ISO en Currency' })
  @IsString()
  @MinLength(3)
  @MaxLength(10)
  functionalCurrencyCode!: string;

  @ApiProperty({ example: 'VES' })
  @IsString()
  @MinLength(3)
  @MaxLength(10)
  defaultSaleDocCurrencyCode!: string;
}
