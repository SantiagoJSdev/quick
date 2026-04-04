import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ProductsQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

