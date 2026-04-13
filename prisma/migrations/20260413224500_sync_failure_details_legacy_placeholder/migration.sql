-- Filas fallidas anteriores a la columna `failureDetails`: texto orientativo para métricas y Postman.
UPDATE "SyncOperation"
SET "failureDetails" = 'Recorded before server persisted failure details. Inspect column `payload` on this row, or the POS logs for the original POST /sync/push `failed[].details`.'
WHERE "status" = 'failed'
  AND "failureDetails" IS NULL;
