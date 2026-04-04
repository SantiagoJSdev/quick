-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "originalSaleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "total" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentCurrencyCode" TEXT,
    "functionalCurrencyCode" TEXT,
    "fxBaseCurrencyCode" TEXT,
    "fxQuoteCurrencyCode" TEXT,
    "fxRateQuotePerBase" DECIMAL(30,10),
    "exchangeRateDate" DATE,
    "fxSource" TEXT,
    "totalDocument" DECIMAL(65,30),
    "totalFunctional" DECIMAL(65,30),
    "fxPolicy" VARCHAR(40),

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturnLine" (
    "id" TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPriceDocument" DECIMAL(65,30),
    "unitPriceFunctional" DECIMAL(65,30),
    "lineTotalDocument" DECIMAL(65,30),
    "lineTotalFunctional" DECIMAL(65,30),

    CONSTRAINT "SaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SaleReturn_storeId_idx" ON "SaleReturn"("storeId");

-- CreateIndex
CREATE INDEX "SaleReturn_originalSaleId_idx" ON "SaleReturn"("originalSaleId");

-- CreateIndex
CREATE INDEX "SaleReturnLine_saleLineId_idx" ON "SaleReturnLine"("saleLineId");

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_originalSaleId_fkey" FOREIGN KEY ("originalSaleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReturnLine" ADD CONSTRAINT "SaleReturnLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
