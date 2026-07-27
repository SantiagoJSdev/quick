-- B2: Cash sessions (cierre de caja)

CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingCash" DECIMAL(65,30),
    "countedCash" DECIMAL(65,30),
    "closeMode" TEXT,
    "notes" TEXT,
    "pendingSalesJson" JSONB,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "ticketsCount" INTEGER,
    "salesTotalFunctional" DECIMAL(65,30),
    "returnsTotalFunctional" DECIMAL(65,30),
    "stockConflictSalesCount" INTEGER,
    "negativeSkuCount" INTEGER,
    "syncFailedCount" INTEGER,
    "closeWarningsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CashSession_storeId_deviceId_status_idx" ON "CashSession"("storeId", "deviceId", "status");
CREATE INDEX "CashSession_storeId_openedAt_idx" ON "CashSession"("storeId", "openedAt");

ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "POSDevice"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;
