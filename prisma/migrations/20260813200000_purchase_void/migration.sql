-- Anulación de factura proveedor
DO $$ BEGIN
  ALTER TYPE "StockMovementType" ADD VALUE 'OUT_PURCHASE_VOID';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Purchase"
  ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voidReason" TEXT,
  ADD COLUMN IF NOT EXISTS "voidOpId" TEXT,
  ADD COLUMN IF NOT EXISTS "voidMode" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Purchase_voidOpId_key" ON "Purchase"("voidOpId");
CREATE INDEX IF NOT EXISTS "Purchase_storeId_status_idx" ON "Purchase"("storeId", "status");

ALTER TABLE "PurchasePayment"
  ADD COLUMN IF NOT EXISTS "reversedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reversalNote" TEXT;
