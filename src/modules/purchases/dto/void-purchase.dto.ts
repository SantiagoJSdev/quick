import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class VoidPurchaseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Idempotencia: mismo opId no duplica void ni stock.',
  })
  @IsUUID('4')
  opId!: string;

  @ApiProperty({
    example: 'Factura duplicada / error de carga',
    minLength: 1,
    maxLength: 240,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Obligatorio true si el preview tiene líneas con quantitySkipped > 0.',
  })
  @IsOptional()
  @IsBoolean()
  confirmPartialStock?: boolean;
}
