-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "catalogStoreId" TEXT;

-- CreateIndex
CREATE INDEX "Product_catalogStoreId_idx" ON "Product"("catalogStoreId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_catalogStoreId_fkey" FOREIGN KEY ("catalogStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
