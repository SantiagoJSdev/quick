/** Shape of `payload` for `/sync/pull` supplier ops (`SUPPLIER_*` past tense). */
export function supplierSyncPullPayload(supplier: {
  id: string;
  storeId: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): { supplierId: string; fields: Record<string, unknown> } {
  return {
    supplierId: supplier.id,
    fields: {
      storeId: supplier.storeId,
      name: supplier.name,
      taxId: supplier.taxId,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      notes: supplier.notes,
      active: supplier.active,
      createdAt: supplier.createdAt.toISOString(),
      updatedAt: supplier.updatedAt.toISOString(),
    },
  };
}
