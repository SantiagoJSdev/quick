import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class InventoryAdjustDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({ enum: ['IN_ADJUST', 'OUT_ADJUST'] })
  @IsString()
  @IsIn(['IN_ADJUST', 'OUT_ADJUST'])
  type!: 'IN_ADJUST' | 'OUT_ADJUST';

  /** Cantidad positiva (magnitud del movimiento). */
  @ApiProperty({ example: '10' })
  @IsNumberString()
  quantity!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** Costo unitario en moneda funcional (entrada); si falta en IN, se usa costo medio actual o `Product.cost`. */
  @ApiPropertyOptional({ example: '2.50' })
  @IsOptional()
  @IsNumberString()
  unitCostFunctional?: string;

  @ApiPropertyOptional({
    description: 'Idempotencia offline / sync (único). Si ya existe un `StockMovement` con este `opId`, no se repite el ajuste.',
  })
  @IsOptional()
  @IsUUID('4')
  opId?: string;
}
