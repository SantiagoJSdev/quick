import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateDashboardAccessToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashDashboardAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function verifyDashboardAccessToken(
  presented: string,
  storedHash: string | null | undefined,
): boolean {
  if (!presented?.trim() || !storedHash?.trim()) {
    return false;
  }
  const computed = hashDashboardAccessToken(presented.trim());
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(storedHash.trim(), 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
