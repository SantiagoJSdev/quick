/*
  Warnings:

  - You are about to drop the column `timestamp` on the `SyncOperation` table. All the data in the column will be lost.
  - Added the required column `clientTimestamp` to the `SyncOperation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `storeId` to the `SyncOperation` table without a default value. This is not possible if the table is not empty.
  - Made the column `opId` on table `SyncOperation` required. This step will fail if there are existing NULL values in that column.
  - Made the column `deviceId` on table `SyncOperation` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "SyncOperation" DROP CONSTRAINT "SyncOperation_deviceId_fkey";

-- AlterTable
ALTER TABLE "SyncOperation" DROP COLUMN "timestamp",
ADD COLUMN     "clientTimestamp" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "storeId" TEXT NOT NULL,
ALTER COLUMN "opId" SET NOT NULL,
ALTER COLUMN "deviceId" SET NOT NULL;

-- CreateTable
CREATE TABLE "StoreSyncState" (
    "storeId" TEXT NOT NULL,
    "serverVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSyncState_pkey" PRIMARY KEY ("storeId")
);

-- CreateIndex
CREATE INDEX "SyncOperation_storeId_clientTimestamp_idx" ON "SyncOperation"("storeId", "clientTimestamp");

-- AddForeignKey
ALTER TABLE "StoreSyncState" ADD CONSTRAINT "StoreSyncState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncOperation" ADD CONSTRAINT "SyncOperation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "POSDevice"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE;
