import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class OpenCashSessionDto {
  @ApiProperty({
    description: 'deviceId estable del terminal (mismo que sync/ventas)',
    example: '68a65e72-5e2a-4712-baa0-53281390d156',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  deviceId!: string;

  @ApiPropertyOptional({
    example: '100.00',
    description: 'Efectivo en caja al abrir (string decimal)',
  })
  @IsOptional()
  @IsNumberString()
  openingCash?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  appVersion?: string;
}

export class CashSessionPendingSaleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  saleId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  opId?: string;

  @ApiPropertyOptional({ example: '12.50' })
  @IsOptional()
  @IsNumberString()
  total?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdAt?: string;
}

export class CloseCashSessionDto {
  @ApiProperty({
    enum: ['ONLINE', 'OFFLINE'],
    description:
      'ONLINE si hubo sync al cerrar; OFFLINE si cierra con cola local pendiente de transmitir',
  })
  @IsIn(['ONLINE', 'OFFLINE'])
  closeMode!: 'ONLINE' | 'OFFLINE';

  @ApiPropertyOptional({
    example: '250.00',
    description: 'Efectivo contado físicamente',
  })
  @IsOptional()
  @IsNumberString()
  countedCash?: string;

  @ApiPropertyOptional({ type: [CashSessionPendingSaleDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CashSessionPendingSaleDto)
  pendingSales?: CashSessionPendingSaleDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
