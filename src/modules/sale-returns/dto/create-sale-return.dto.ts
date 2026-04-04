import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { FxSnapshotDto } from '../../exchange-rates/dto/fx-snapshot.dto';

export const SALE_RETURN_FX_POLICIES = [
  'INHERIT_ORIGINAL_SALE',
  'SPOT_ON_RETURN',
] as const;

export class CreateSaleReturnLineDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Línea de la venta original (`SaleLine.id`)',
  })
  @IsUUID('4')
  saleLineId!: string;

  @ApiProperty({ example: '1' })
  @IsNumberString()
  quantity!: string;
}

export class CreateSaleReturnDto {
  @ApiPropertyOptional({
    description:
      'UUID de devolución fijado por el cliente (idempotencia / offline).',
  })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  originalSaleId!: string;

  @ApiProperty({ type: [CreateSaleReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleReturnLineDto)
  lines!: CreateSaleReturnLineDto[];

  @ApiPropertyOptional({
    description:
      'Sync: `StockMovement.opId` = `${opId}:${saleLineId}` por línea.',
  })
  @IsOptional()
  @IsUUID('4')
  opId?: string;

  @ApiPropertyOptional({
    enum: SALE_RETURN_FX_POLICIES,
    default: 'INHERIT_ORIGINAL_SALE',
    description:
      '`INHERIT_ORIGINAL_SALE` (defecto): totales funcionales comerciales proporcionales a la venta (misma paridad histórica). `SPOT_ON_RETURN`: importe en moneda documento sigue siendo proporcional; el funcional se recalcula con la tasa vigente (o `fxSnapshot` / POS_OFFLINE).',
  })
  @IsOptional()
  @IsIn([...SALE_RETURN_FX_POLICIES])
  fxPolicy?: (typeof SALE_RETURN_FX_POLICIES)[number];

  @ApiPropertyOptional({
    type: FxSnapshotDto,
    description:
      'Solo con `fxPolicy: SPOT_ON_RETURN`. Misma semántica que en ventas: opcional en online; obligatorio coherente en offline (`POS_OFFLINE`).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FxSnapshotDto)
  fxSnapshot?: FxSnapshotDto;
}
