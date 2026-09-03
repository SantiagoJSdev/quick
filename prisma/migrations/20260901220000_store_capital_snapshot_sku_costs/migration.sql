-- Costos por SKU congelados al capturar la foto diaria (KPI histórico).
ALTER TABLE "StoreCapitalSnapshot" ADD COLUMN "inventorySkuCosts" JSONB;
