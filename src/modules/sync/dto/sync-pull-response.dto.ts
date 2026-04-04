import { ApiProperty } from '@nestjs/swagger';

export class SyncPullOpItemDto {
  @ApiProperty()
  serverVersion!: number;

  @ApiProperty({
    example: 'PRODUCT_UPDATED',
    enum: [
      'PRODUCT_CREATED',
      'PRODUCT_UPDATED',
      'PRODUCT_DEACTIVATED',
    ],
  })
  opType!: string;

  @ApiProperty({ example: '2026-04-04T12:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({
    description: 'For product ops: `{ productId, fields }` with string decimals in `fields`.',
    type: 'object',
    additionalProperties: true,
  })
  payload!: Record<string, unknown>;
}

export class SyncPullResponseDto {
  @ApiProperty()
  serverTime!: string;

  @ApiProperty()
  fromVersion!: number;

  @ApiProperty({
    description:
      'New watermark: persist as lastServerVersion for the next pull (even if ops is empty).',
  })
  toVersion!: number;

  @ApiProperty({ type: [SyncPullOpItemDto] })
  ops!: SyncPullOpItemDto[];

  @ApiProperty()
  hasMore!: boolean;
}
