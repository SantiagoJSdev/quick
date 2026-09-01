-- Snapshots de catálogo por línea de compra (revertir costo/precio en VOID).
ALTER TABLE "PurchaseLine"
  ADD COLUMN "catalogCostBeforeFunctional" DECIMAL(65,30),
  ADD COLUMN "catalogPriceBefore" DECIMAL(65,30);
