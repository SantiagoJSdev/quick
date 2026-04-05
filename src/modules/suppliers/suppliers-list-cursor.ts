import { BadRequestException } from '@nestjs/common';

export type SupplierListCursor = { createdAt: Date; id: string };

export function encodeSupplierListCursor(row: {
  createdAt: Date;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({ t: row.createdAt.toISOString(), i: row.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeSupplierListCursor(raw: string): SupplierListCursor {
  let parsed: unknown;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    parsed = JSON.parse(json) as { t?: string; i?: string };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { t?: unknown }).t !== 'string' ||
    typeof (parsed as { i?: unknown }).i !== 'string'
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  const createdAt = new Date((parsed as { t: string }).t);
  if (Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException('Invalid cursor timestamp');
  }
  return { createdAt, id: (parsed as { i: string }).i };
}
