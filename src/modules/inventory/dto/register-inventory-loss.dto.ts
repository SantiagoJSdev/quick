import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterInventoryLossDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({ example: '1', description: 'Cantidad positiva a dar de baja.' })
  @IsNumberString()
  quantity!: string;

  @ApiProperty({
    example: 'Podrido',
    description: 'Podrido | Vencido | Rotura | Autoconsumo | Otro',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  reason!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Idempotencia: mismo opId no duplica merma.',
  })
  @IsOptional()
  @IsUUID('4')
  opId?: string;
}
