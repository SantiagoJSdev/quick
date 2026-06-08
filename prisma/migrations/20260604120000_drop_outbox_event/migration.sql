-- Drop transactional outbox (Mongo projection removed; PostgreSQL is the sole source of truth).
DROP TABLE IF EXISTS "OutboxEvent";
DROP TYPE IF EXISTS "OutboxStatus";
