-- Paso 2: foto diaria de patrimonio (1 fila por tienda por día calendario)
CREATE TABLE "StoreCapitalSnapshot" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "inventoryCapital" DECIMAL(65,30) NOT NULL,
    "payablesDue" DECIMAL(65,30) NOT NULL,
    "netInventoryEquity" DECIMAL(65,30) NOT NULL,
    "netSales" DECIMAL(65,30) NOT NULL,
    "cogs" DECIMAL(65,30) NOT NULL,
    "grossProfit" DECIMAL(65,30) NOT NULL,
    "realProfit" DECIMAL(65,30) NOT NULL,
    "realProfitDeductions" JSONB,
    "purchasesFunctional" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "supplierPayments" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lossCostFunctional" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paymentCommissions" DECIMAL(65,30),
    "cashBalanceEst" DECIMAL(65,30),
    "cashAvailableEst" DECIMAL(65,30),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCapitalSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StoreCapitalSnapshot_storeId_date_key" ON "StoreCapitalSnapshot"("storeId", "date");
CREATE INDEX "StoreCapitalSnapshot_storeId_date_idx" ON "StoreCapitalSnapshot"("storeId", "date");

ALTER TABLE "StoreCapitalSnapshot" ADD CONSTRAINT "StoreCapitalSnapshot_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
