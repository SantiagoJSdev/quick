-- AlterTable: columnas nuevas (storeId primero nullable para backfill)
ALTER TABLE "Supplier" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Supplier" ADD COLUMN "notes" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "storeId" TEXT;

UPDATE "Supplier"
SET "storeId" = (SELECT id FROM "Store" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "storeId" IS NULL;

ALTER TABLE "Supplier" ALTER COLUMN "storeId" SET NOT NULL;

CREATE INDEX "Supplier_storeId_active_idx" ON "Supplier"("storeId", "active");
CREATE INDEX "Supplier_storeId_name_idx" ON "Supplier"("storeId", "name");

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
