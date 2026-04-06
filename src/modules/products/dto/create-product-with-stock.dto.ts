import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateProductDto } from './create-product.dto';

export class InitialStockDto {
  @ApiProperty({
    description: 'Cantidad inicial positiva (misma semántica que `POST /inventory/adjustments` IN_ADJUST).',
    example: '24',
  })
  @IsNumberString()
  quantity!: string;

  @ApiPropertyOptional({
    description:
      'Costo unitario en moneda funcional; si falta, se usa `Product.cost` del producto recién creado.',
  })
  @IsOptional()
  @IsNumberString()
  unitCostFunctional?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Idempotencia del movimiento de stock (no del producto). Mismo contrato que `InventoryAdjustDto.opId`.',
  })
  @IsOptional()
  @IsUUID('4')
  opId?: string;
}

export class CreateProductWithStockDto extends CreateProductDto {
  @ApiProperty({ type: () => InitialStockDto })
  @ValidateNested()
  @Type(() => InitialStockDto)
  initialStock!: InitialStockDto;
}
