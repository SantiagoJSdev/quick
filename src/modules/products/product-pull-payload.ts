import { Prisma } from '@prisma/client';

/** Flat fields for `/sync/pull` product ops (strings for decimals). */
export function productToSyncPullFields(product: {
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  image: string | null;
  type: string;
  categoryId: string | null;
  price: Prisma.Decimal;
  cost: Prisma.Decimal;
  currency: string;
  taxId: string | null;
  unit: string;
  supplierId: string | null;
  active: boolean;
}): Record<string, unknown> {
  return {
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    description: product.description,
    image: product.image,
    type: product.type,
    categoryId: product.categoryId,
    price: product.price.toString(),
    cost: product.cost.toString(),
    currency: product.currency,
    taxId: product.taxId,
    unit: product.unit,
    supplierId: product.supplierId,
    active: product.active,
  };
}

export function productSyncPullPayload(product: {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  image: string | null;
  type: string;
  categoryId: string | null;
  price: Prisma.Decimal;
  cost: Prisma.Decimal;
  currency: string;
  taxId: string | null;
  unit: string;
  supplierId: string | null;
  active: boolean;
}): { productId: string; fields: Record<string, unknown> } {
  return {
    productId: product.id,
    fields: productToSyncPullFields(product),
  };
}
