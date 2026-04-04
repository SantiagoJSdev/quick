/** Deterministic JSON for idempotency / payload equality checks. */
export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(v: unknown): unknown {
  if (v === null || typeof v !== 'object') {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(normalize);
  }
  const o = v as Record<string, unknown>;
  const sortedKeys = Object.keys(o).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    out[k] = normalize(o[k]);
  }
  return out;
}
