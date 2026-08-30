-- Paso 3: catálogo de métodos de pago + comisión foto en SalePayment
CREATE TABLE "StorePaymentMethod" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commissionPercent" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "isCashLike" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorePaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorePaymentMethod_storeId_code_key" ON "StorePaymentMethod"("storeId", "code");
CREATE INDEX "StorePaymentMethod_storeId_active_idx" ON "StorePaymentMethod"("storeId", "active");

ALTER TABLE "StorePaymentMethod" ADD CONSTRAINT "StorePaymentMethod_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalePayment" ADD COLUMN "amountFunctional" DECIMAL(65,30);
ALTER TABLE "SalePayment" ADD COLUMN "commissionPercentApplied" DECIMAL(10,4);
ALTER TABLE "SalePayment" ADD COLUMN "commissionFunctional" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Seed Quick Market (y cualquier Store existente) con constantes KPI_GASTOS_CONSTANTES §4
INSERT INTO "StorePaymentMethod" ("id", "storeId", "code", "name", "commissionPercent", "isCashLike", "active", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."id", v.code, v.name, v.pct, v.cash, true, v.ord, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Store" s
CROSS JOIN (
  VALUES
    ('CASH_USD', 'Efectivo USD', 0::numeric, true, 10),
    ('CASH_VES', 'Efectivo VES', 0::numeric, true, 20),
    ('DEBITO_BDV', 'Débito Banco de Venezuela', 2.1::numeric, false, 30),
    ('DEBITO_BNC', 'Débito BNC', 2.0::numeric, false, 40)
) AS v(code, name, pct, cash, ord)
ON CONFLICT ("storeId", "code") DO NOTHING;
