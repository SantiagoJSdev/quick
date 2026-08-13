import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PURCHASE_PAYMENT_STATUSES } from './create-purchase.dto';

export class PurchasesListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  supplierId?: string;

  @ApiPropertyOptional({ enum: [...PURCHASE_PAYMENT_STATUSES, 'OPEN'] })
  @IsOptional()
  @IsIn([...PURCHASE_PAYMENT_STATUSES, 'OPEN'])
  paymentStatus?: (typeof PURCHASE_PAYMENT_STATUSES)[number] | 'OPEN';

  @ApiPropertyOptional({
    enum: ['RECEIVED', 'VOID'],
    description:
      'Filtrar por status documental. Default: excluye VOID salvo includeVoided.',
  })
  @IsOptional()
  @IsIn(['RECEIVED', 'VOID'])
  status?: 'RECEIVED' | 'VOID';

  @ApiPropertyOptional({
    description: 'Si true, incluye facturas anuladas en el listado.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeVoided?: boolean;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
