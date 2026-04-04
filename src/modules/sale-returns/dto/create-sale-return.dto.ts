import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

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
}
