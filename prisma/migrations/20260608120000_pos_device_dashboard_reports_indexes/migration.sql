-- CreateEnum
CREATE TYPE "PosDeviceMode" AS ENUM ('POS', 'DASHBOARD', 'HYBRID');

-- CreateEnum
CREATE TYPE "DashboardView" AS ENUM ('SALES_SUMMARY');

-- AlterTable
ALTER TABLE "POSDevice" ADD COLUMN     "dashboardEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deviceMode" "PosDeviceMode" NOT NULL DEFAULT 'POS',
ADD COLUMN     "dashboardView" "DashboardView" NOT NULL DEFAULT 'SALES_SUMMARY',
ADD COLUMN     "dashboardAccessTokenHash" TEXT,
ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Sale_storeId_status_createdAt_idx" ON "Sale"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturn_storeId_status_createdAt_idx" ON "SaleReturn"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SalePayment_saleId_method_idx" ON "SalePayment"("saleId", "method");
