import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncAckedSupplierDto {
  @ApiPropertyOptional({
    description:
      'Solo en `SUPPLIER_CREATE`: id provisional del cliente (UUID v4) mapeado a `supplierId` del servidor.',
  })
  clientSupplierId?: string;

  @ApiProperty({ description: 'Id definitivo del proveedor en servidor' })
  supplierId!: string;
}

export class SyncAckedItemDto {
  @ApiProperty()
  opId!: string;

  @ApiProperty()
  serverVersion!: number;

  @ApiPropertyOptional({
    type: SyncAckedSupplierDto,
    description:
      'Presente en ack de `SUPPLIER_CREATE`, `SUPPLIER_UPDATE`, `SUPPLIER_DEACTIVATE`.',
  })
  supplier?: SyncAckedSupplierDto;
}

export class SyncSkippedItemDto {
  @ApiProperty()
  opId!: string;

  @ApiProperty({ example: 'already_applied' })
  reason!: string;
}

export class SyncFailedItemDto {
  @ApiProperty()
  opId!: string;

  @ApiProperty({ example: 'not_implemented' })
  reason!: string;

  @ApiProperty({ required: false })
  details?: string;
}

export class SyncPushResponseDto {
  @ApiProperty({ example: '2026-03-26T18:00:02.000Z' })
  serverTime!: string;

  @ApiProperty({ type: [SyncAckedItemDto] })
  acked!: SyncAckedItemDto[];

  @ApiProperty({ type: [SyncSkippedItemDto] })
  skipped!: SyncSkippedItemDto[];

  @ApiProperty({ type: [SyncFailedItemDto] })
  failed!: SyncFailedItemDto[];
}
