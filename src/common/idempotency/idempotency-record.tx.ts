import type { Prisma } from '@prisma/client';

/** Fila usada en `createWithStock` (subconjunto de columnas). */
export type IdempotencyRecordCached = {
  id: string;
  requestHash: string;
  responseJson: Prisma.JsonValue;
  expiresAt: Date;
};

/**
 * Acceso al delegate `idempotencyRecord` en `TransactionClient`.
 * Si `npx prisma generate` no actualizó tipos (p. ej. EPERM en Windows), `tx.idempotencyRecord` falla en TS aunque exista en runtime.
 */
export function idempotencyRecordTx(tx: Prisma.TransactionClient) {
  return (
    tx as unknown as {
      idempotencyRecord: {
        findUnique(args: {
          where: {
            storeId_scope_key: {
              storeId: string;
              scope: string;
              key: string;
            };
          };
        }): Promise<IdempotencyRecordCached | null>;
        create(args: {
          data: {
            storeId: string;
            scope: string;
            key: string;
            requestHash: string;
            responseJson: Prisma.InputJsonValue;
            expiresAt: Date;
          };
        }): Promise<unknown>;
        delete(args: { where: { id: string } }): Promise<unknown>;
      };
    }
  ).idempotencyRecord;
}
