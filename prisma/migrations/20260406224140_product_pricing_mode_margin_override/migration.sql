-- CreateEnum
CREATE TYPE "ProductPricingMode" AS ENUM ('USE_STORE_DEFAULT', 'USE_PRODUCT_OVERRIDE', 'MANUAL_PRICE');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "marginPercentOverride" DECIMAL(10,4),
ADD COLUMN     "pricingMode" "ProductPricingMode" NOT NULL DEFAULT 'USE_STORE_DEFAULT';
