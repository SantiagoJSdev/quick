-- Pago Móvil: 0% comisión, no efectivo en caja (isCashLike = false)
INSERT INTO "StorePaymentMethod" ("id", "storeId", "code", "name", "commissionPercent", "isCashLike", "active", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."id", v.code, v.name, v.pct, v.cash, true, v.ord, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Store" s
CROSS JOIN (
  VALUES
    ('PAGO_MOVIL', 'Pago Móvil', 0::numeric, false, 50)
) AS v(code, name, pct, cash, ord)
ON CONFLICT ("storeId", "code") DO NOTHING;
