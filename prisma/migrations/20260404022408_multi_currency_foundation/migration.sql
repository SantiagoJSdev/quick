-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "averageUnitCostFunctional" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "totalCostFunctional" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "documentCurrencyCode" TEXT,
ADD COLUMN     "exchangeRateDate" DATE,
ADD COLUMN     "functionalCurrencyCode" TEXT,
ADD COLUMN     "fxBaseCurrencyCode" TEXT,
ADD COLUMN     "fxQuoteCurrencyCode" TEXT,
ADD COLUMN     "fxRateQuotePerBase" DECIMAL(30,10),
ADD COLUMN     "fxSource" TEXT,
ADD COLUMN     "totalDocument" DECIMAL(65,30),
ADD COLUMN     "totalFunctional" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "PurchaseLine" ADD COLUMN     "lineTotalDocument" DECIMAL(65,30),
ADD COLUMN     "lineTotalFunctional" DECIMAL(65,30),
ADD COLUMN     "unitCostDocument" DECIMAL(65,30),
ADD COLUMN     "unitCostFunctional" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "documentCurrencyCode" TEXT,
ADD COLUMN     "exchangeRateDate" DATE,
ADD COLUMN     "functionalCurrencyCode" TEXT,
ADD COLUMN     "fxBaseCurrencyCode" TEXT,
ADD COLUMN     "fxQuoteCurrencyCode" TEXT,
ADD COLUMN     "fxRateQuotePerBase" DECIMAL(30,10),
ADD COLUMN     "fxSource" TEXT,
ADD COLUMN     "totalDocument" DECIMAL(65,30),
ADD COLUMN     "totalFunctional" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "SaleLine" ADD COLUMN     "discountDocument" DECIMAL(65,30),
ADD COLUMN     "discountFunctional" DECIMAL(65,30),
ADD COLUMN     "lineTotalDocument" DECIMAL(65,30),
ADD COLUMN     "lineTotalFunctional" DECIMAL(65,30),
ADD COLUMN     "unitPriceDocument" DECIMAL(65,30),
ADD COLUMN     "unitPriceFunctional" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "totalCostFunctional" DECIMAL(65,30),
ADD COLUMN     "unitCostFunctional" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "baseCurrencyId" TEXT NOT NULL,
    "quoteCurrencyId" TEXT NOT NULL,
    "rateQuotePerBase" DECIMAL(30,10) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSettings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "functionalCurrencyId" TEXT NOT NULL,
    "defaultSaleDocCurrencyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Currency_code_key" ON "Currency"("code");

-- CreateIndex
CREATE INDEX "ExchangeRate_storeId_baseCurrencyId_quoteCurrencyId_effecti_idx" ON "ExchangeRate"("storeId", "baseCurrencyId", "quoteCurrencyId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSettings_storeId_key" ON "BusinessSettings"("storeId");

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_baseCurrencyId_fkey" FOREIGN KEY ("baseCurrencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_quoteCurrencyId_fkey" FOREIGN KEY ("quoteCurrencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_functionalCurrencyId_fkey" FOREIGN KEY ("functionalCurrencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_defaultSaleDocCurrencyId_fkey" FOREIGN KEY ("defaultSaleDocCurrencyId") REFERENCES "Currency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
