-- CreateTable
CREATE TABLE "ProductSkuCounter" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "nextNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductSkuCounter_pkey" PRIMARY KEY ("id")
);
