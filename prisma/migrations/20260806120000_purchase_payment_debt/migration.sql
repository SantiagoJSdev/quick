-- Factura proveedor: estado de pago / deuda + abonos
ALTER TABLE "Purchase"
  ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT NOT NULL DEFAULT 'PAID',
  ADD COLUMN IF NOT EXISTS "amountPaidFunctional" DECIMAL(65, 30) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "amountDueFunctional" DECIMAL(65, 30) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dueDate" DATE,
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);

-- Compras existentes: se consideran liquidadas (sin deuda histórica inventada)
UPDATE "Purchase"
SET
  "paymentStatus" = 'PAID',
  "amountPaidFunctional" = COALESCE("totalFunctional", "total", 0),
  "amountDueFunctional" = 0,
  "paidAt" = COALESCE("dateReceived", "createdAt")
WHERE "amountDueFunctional" = 0
  AND "paymentStatus" = 'PAID';

CREATE INDEX IF NOT EXISTS "Purchase_storeId_createdAt_idx"
  ON "Purchase"("storeId", "createdAt");
CREATE INDEX IF NOT EXISTS "Purchase_storeId_paymentStatus_idx"
  ON "Purchase"("storeId", "paymentStatus");
CREATE INDEX IF NOT EXISTS "Purchase_storeId_supplierId_paymentStatus_idx"
  ON "Purchase"("storeId", "supplierId", "paymentStatus");

CREATE TABLE IF NOT EXISTS "PurchasePayment" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "amountFunctional" DECIMAL(65, 30) NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'CASH',
  "note" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "opId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchasePayment_opId_key"
  ON "PurchasePayment"("opId");
CREATE INDEX IF NOT EXISTS "PurchasePayment_purchaseId_paidAt_idx"
  ON "PurchasePayment"("purchaseId", "paidAt");
CREATE INDEX IF NOT EXISTS "PurchasePayment_storeId_paidAt_idx"
  ON "PurchasePayment"("storeId", "paidAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PurchasePayment_purchaseId_fkey'
  ) THEN
    ALTER TABLE "PurchasePayment"
      ADD CONSTRAINT "PurchasePayment_purchaseId_fkey"
      FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PurchasePayment_storeId_fkey'
  ) THEN
    ALTER TABLE "PurchasePayment"
      ADD CONSTRAINT "PurchasePayment_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
