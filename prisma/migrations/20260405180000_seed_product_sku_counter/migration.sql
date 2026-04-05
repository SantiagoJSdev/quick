-- Fila singleton para secuencia de SKU autogenerado (si la migración anterior no la insertó).
INSERT INTO "ProductSkuCounter" ("id", "nextNumber")
VALUES ('global', 0)
ON CONFLICT ("id") DO NOTHING;
