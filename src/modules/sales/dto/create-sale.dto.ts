import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  MinLength,
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

  @ApiPropertyOptional({
    example: '1.25',
    description:
      'COGS unitario en moneda funcional al cobro. Obligatorio en sync offline; si se omite online, usa Product.cost del servidor.',
  })
  @IsOptional()
  @IsNumberString()
  unitCostFunctional?: string;
}

export class SalePaymentInputDto {
  @ApiProperty({
    example: 'CASH_USD',
    description:
      'Código del catálogo GET /payment-methods (CASH_USD, CASH_VES, DEBITO_BDV, DEBITO_BNC, PAGO_MOVIL).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  method!: string;

  @ApiProperty({
    example: '12.00',
    description: 'Monto del pago en `currencyCode`.',
  })
  @IsNumberString()
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  currencyCode!: string;

  @ApiPropertyOptional({ type: FxSnapshotDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FxSnapshotDto)
  fxSnapshot?: FxSnapshotDto;
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

  @ApiPropertyOptional({
    type: [SalePaymentInputDto],
    description:
      'Detalle opcional de cobro mixto. No altera inventario; sirve para trazabilidad/reporte.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentInputDto)
  payments?: SalePaymentInputDto[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({
    description:
      'Identificador estable del terminal (ej. UUID de instalación). Si se envía, el servidor registra o actualiza el POS para esta tienda (`lastSeen`) y enlaza la venta. Si el mismo `deviceId` ya está en otra tienda → 409.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;

  @ApiPropertyOptional({
    example: '1.2.0',
    description:
      'Opcional. Versión de la app; se guarda en el registro del dispositivo al confirmar la venta.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  appVersion?: string;

  @ApiPropertyOptional({
    description:
      'Para idempotencia de movimientos en sync: `StockMovement.opId` = `${opId}:${productId}` por línea.',
  })
  @IsOptional()
  @IsUUID('4')
  opId?: string;

  @ApiPropertyOptional({
    example: 'POS_SYNC',
    description: 'Origen de la venta: POS_SYNC | POS_REST | API',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  saleOrigin?: string;

  @ApiPropertyOptional({ type: FxSnapshotDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FxSnapshotDto)
  fxSnapshot?: FxSnapshotDto;
}
