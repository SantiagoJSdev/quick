import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/** How to resolve catalog data: Mongo read model, Postgres, or auto (Mongo then Postgres on failure). */
export const PRODUCT_READ_SOURCES = ['auto', 'mongo', 'postgres'] as const;
export type ProductReadSource = (typeof PRODUCT_READ_SOURCES)[number];

export class ProductsQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  includeInactive?: boolean;

  @IsOptional()
  @IsIn(PRODUCT_READ_SOURCES)
  source?: ProductReadSource;
}

/** Query for `GET /products/:id` (read path only). */
export class ProductIdQueryDto {
  @IsOptional()
  @IsIn(PRODUCT_READ_SOURCES)
  source?: ProductReadSource;
}

