-- Hora real de la venta declarada por el POS (offline). createdAt sigue siendo la hora del servidor.
ALTER TABLE "Sale" ADD COLUMN "clientSoldAt" TIMESTAMP(3);