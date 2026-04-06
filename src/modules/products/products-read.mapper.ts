/** Stored shape in Mongo `products_read` (projection from outbox). */
export interface MongoProductReadDoc {
  _id: string;
  productId?: string;
  sku?: string;
  barcode?: string | null;
  name?: string;
  description?: string | null;
  image?: string | null;
  type?: string;
  pricingMode?: string;
  marginPercentOverride?: string | null;
  category?: { id?: string; name?: string } | null;
  price?: string;
  cost?: string | null;
  currency?: string;
  tax?: { id?: string; name?: string; rate?: string } | null;
  unit?: string;
  supplier?: { id?: string; name?: string } | null;
  active?: boolean;
  pg?: { updatedAt?: string };
}

/** Maps Mongo `products_read` document to the same flat shape as Prisma `Product` list responses. */
export function mongoProductReadToApiShape(
  doc: MongoProductReadDoc,
): Record<string, unknown> {
  const id = doc.productId ?? doc._id;
  const updatedAt = doc.pg?.updatedAt ?? new Date().toISOString();
  return {
    id,
    sku: doc.sku,
    barcode: doc.barcode ?? null,
    name: doc.name,
    description: doc.description ?? null,
    image: doc.image ?? null,
    type: doc.type,
    pricingMode: doc.pricingMode ?? 'USE_STORE_DEFAULT',
    marginPercentOverride: doc.marginPercentOverride ?? null,
    categoryId: doc.category?.id ?? null,
    price: doc.price,
    cost: doc.cost ?? null,
    currency: doc.currency,
    taxId: doc.tax?.id ?? null,
    unit: doc.unit,
    supplierId: doc.supplier?.id ?? null,
    active: doc.active ?? true,
    createdAt: updatedAt,
    updatedAt,
  };
}
