import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SyncPullQueryDto {
  @ApiProperty({ example: 0, description: 'Last applied serverVersion from `/sync/pull` on the device' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  since!: number;

  @ApiPropertyOptional({ default: 500, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
