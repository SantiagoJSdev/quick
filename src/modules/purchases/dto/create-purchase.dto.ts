import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { FxSnapshotDto } from '../../exchange-rates/dto/fx-snapshot.dto';

export const PURCHASE_PAYMENT_STATUSES = ['PAID', 'CREDIT', 'PARTIAL'] as const;
export type PurchasePaymentStatus = (typeof PURCHASE_PAYMENT_STATUSES)[number];

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

  @ApiPropertyOptional({
    example: 'FAC-2026-0042',
    description:
      'Referencia del documento del proveedor (factura, guía, nota de recepción, etc.).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierInvoiceReference?: string;

  @ApiPropertyOptional({
    enum: PURCHASE_PAYMENT_STATUSES,
    default: 'PAID',
    description:
      'PAID = ya pagada (contado). CREDIT = a crédito (deuda = total). PARTIAL = abono inicial.',
  })
  @IsOptional()
  @IsIn([...PURCHASE_PAYMENT_STATUSES])
  paymentStatus?: PurchasePaymentStatus;

  @ApiPropertyOptional({
    example: '50.00',
    description:
      'Abono inicial en moneda funcional si `paymentStatus=PARTIAL`. Ignorado en PAID/CREDIT.',
  })
  @IsOptional()
  @IsNumberString()
  initialAmountPaidFunctional?: string;

  @ApiPropertyOptional({
    example: '2026-08-15',
    description: 'Vencimiento (YYYY-MM-DD) si es crédito.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  dueDate?: string;

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
