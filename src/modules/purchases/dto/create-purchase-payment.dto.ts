import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreatePurchasePaymentDto {
  @ApiProperty({ example: '25.00', description: 'Abono en moneda funcional' })
  @IsNumberString()
  amountFunctional!: string;

  @ApiPropertyOptional({ example: 'CASH', description: 'CASH | TRANSFER | OTHER' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'Idempotencia (sync / reintento). Si ya existe, se devuelve el mismo abono.',
  })
  @IsOptional()
  @IsUUID('4')
  opId?: string;

  @ApiPropertyOptional({
    example: '2026-08-06T15:00:00.000Z',
    description: 'Momento del pago; default now()',
  })
  @IsOptional()
  @IsString()
  paidAt?: string;
}
