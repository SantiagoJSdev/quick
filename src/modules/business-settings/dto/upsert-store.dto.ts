import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const STORE_TYPES = ['main', 'branch'] as const;

export class UpsertStoreDto {
  @ApiProperty({ example: 'Sucursal Centro' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ enum: STORE_TYPES, example: 'main' })
  @IsString()
  @IsIn([...STORE_TYPES])
  type!: (typeof STORE_TYPES)[number];
}
