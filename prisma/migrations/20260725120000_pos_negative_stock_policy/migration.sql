-- B1: POS stock policy + sale inventory flags

ALTER TABLE "BusinessSettings" ADD COLUMN "allowNegativeStockAtPos" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BusinessSettings" ADD COLUMN "warnOnNegativeStock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BusinessSettings" ADD COLUMN "blockRestrictedProductsWithoutStock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "BusinessSettings" ADD COLUMN "requireSuccessfulSyncAtClose" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Product" ADD COLUMN "blockSaleWithoutStock" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Sale" ADD COLUMN "inventoryValidationMode" TEXT;
ALTER TABLE "Sale" ADD COLUMN "stockConflictDetected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Sale" ADD COLUMN "saleOrigin" TEXT;
