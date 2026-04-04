import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

const SYNC_PUSH_OP_TYPES = ['SALE', 'INVENTORY_ADJUST', 'NOOP'] as const;
export type SyncPushOpType = (typeof SYNC_PUSH_OP_TYPES)[number];

export class SyncPushOpDto {
  @ApiProperty({ format: 'uuid', example: '9c1b39e8-2f4a-4c17-9a89-8b5e7cb4b9d7' })
  @IsUUID('4')
  opId!: string;

  @ApiProperty({ enum: SYNC_PUSH_OP_TYPES, example: 'NOOP' })
  @IsString()
  @IsIn([...SYNC_PUSH_OP_TYPES])
  opType!: string;

  @ApiProperty({ example: '2026-03-26T17:59:10.000Z' })
  @IsDateString()
  timestamp!: string;

  @ApiProperty({
    example: {},
    description: 'Op-specific payload; validated when the op type is implemented.',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}

export class SyncPushDto {
  @ApiProperty({ example: 'device-qa-001' })
  @IsString()
  deviceId!: string;

  @ApiPropertyOptional({ example: '2026-03-26T18:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  clientTime?: string;

  @ApiPropertyOptional({ example: 120, description: 'Last serverVersion seen by device' })
  @IsOptional()
  lastServerVersion?: number;

  @ApiProperty({ type: [SyncPushOpDto], maxItems: 200 })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SyncPushOpDto)
  ops!: SyncPushOpDto[];
}
