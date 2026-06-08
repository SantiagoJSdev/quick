import { Prisma } from '@prisma/client';

export const productRelationInclude = {
  category: true,
  tax: true,
  supplier: true,
} as const;

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof productRelationInclude;
}>;
