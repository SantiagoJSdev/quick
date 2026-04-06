import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

/** JSON canónico (claves ordenadas) para comparar cuerpos en idempotencia. */
export function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (value instanceof Prisma.Decimal) {
    return JSON.stringify(value.toString());
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`,
  );
  return `{${parts.join(',')}}`;
}

export function requestBodySha256Hex(body: unknown): string {
  return createHash('sha256').update(stableStringify(body), 'utf8').digest('hex');
}

/**
 * Copia JSON-safe para guardar en `Json` (Decimal/Date → string ISO o decimal string).
 */
export function toJsonSafeForCache(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Prisma.Decimal) {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafeForCache);
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      out[k] = toJsonSafeForCache(o[k]);
    }
    return out;
  }
  return value;
}
