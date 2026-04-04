import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { FxSnapshotDto } from '../../exchange-rates/dto/fx-snapshot.dto';

export class CreatePurchaseLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({ example: '10' })
  @IsNumberString()
  quantity!: string;

  @ApiProperty({
    example: '5.00',
    description: 'Costo unitario en moneda del documento de compra',
  })
  @IsNumberString()
  unitCost!: string;
}

export class CreatePurchaseDto {
  @ApiPropertyOptional({
    description:
      'UUID de compra fijado por el cliente (idempotencia / offline). Si ya existe para esta tienda, se devuelve la misma compra.',
  })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  supplierId!: string;

  @ApiPropertyOptional({
    example: 'VES',
    description:
      'Por defecto: moneda documento de venta por defecto en `BusinessSettings` o moneda funcional.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  documentCurrencyCode?: string;

  @ApiProperty({ type: [CreatePurchaseLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseLineDto)
  lines!: CreatePurchaseLineDto[];

  @ApiPropertyOptional({
    description:
      'Para sync: `StockMovement.opId` = `${opId}:${productId}` por línea.',
  })
  @IsOptional()
  @IsUUID('4')
  opId?: string;

  @ApiPropertyOptional({ type: FxSnapshotDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FxSnapshotDto)
  fxSnapshot?: FxSnapshotDto;
}
