import { Prisma } from '@prisma/client';

const productOutboxInclude = {
  category: true,
  tax: true,
  supplier: true,
} as const;

export type ProductForOutbox = Prisma.ProductGetPayload<{
  include: typeof productOutboxInclude;
}>;

export { productOutboxInclude };

export function buildProductOutboxPayload(
  product: ProductForOutbox,
): Prisma.InputJsonValue {
  return {
    product: {
      id: product.id,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      description: product.description,
      image: product.image,
      type: product.type,
      pricingMode: product.pricingMode,
      marginPercentOverride: product.marginPercentOverride?.toString() ?? null,
      unit: product.unit,
      currency: product.currency,
      price: product.price.toString(),
      cost: product.cost.toString(),
      active: product.active,
      updatedAt: product.updatedAt.toISOString(),
      category: product.category
        ? { id: product.category.id, name: product.category.name }
        : null,
      tax: product.tax
        ? {
            id: product.tax.id,
            name: product.tax.name,
            rate: product.tax.rate.toString(),
          }
        : null,
      supplier: product.supplier
        ? { id: product.supplier.id, name: product.supplier.name }
        : null,
    },
  };
}
