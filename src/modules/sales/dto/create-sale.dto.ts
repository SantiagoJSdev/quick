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

export class CreateSaleLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  productId!: string;

  @ApiProperty({ example: '2' })
  @IsNumberString()
  quantity!: string;

  @ApiProperty({
    example: '25.00',
    description: 'Precio unitario en moneda del documento',
  })
  @IsNumberString()
  price!: string;

  @ApiPropertyOptional({ example: '0' })
  @IsOptional()
  @IsNumberString()
  discount?: string;
}

export class CreateSaleDto {
  @ApiPropertyOptional({
    description:
      'UUID de venta fijado por el cliente (idempotencia / offline). Si ya existe para esta tienda, se devuelve la misma venta.',
  })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiPropertyOptional({
    example: 'VES',
    description: 'Por defecto: moneda documento de `BusinessSettings` o moneda funcional.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  documentCurrencyCode?: string;

  @ApiProperty({ type: [CreateSaleLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleLineDto)
  lines!: CreateSaleLineDto[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ description: 'deviceId POS (debe existir para la tienda)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;

  @ApiPropertyOptional({
    description:
      'Para idempotencia de movimientos en sync: `StockMovement.opId` = `${opId}:${productId}` por línea.',
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
