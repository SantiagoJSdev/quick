import { ApiProperty } from '@nestjs/swagger';

export class SyncAckedItemDto {
  @ApiProperty()
  opId!: string;

  @ApiProperty()
  serverVersion!: number;
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
