import { createHash } from 'crypto';

export function stableJson(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return JSON.stringify(null);
  }
  const json = JSON.stringify(value);
  return json === undefined ? '"__undefined__"' : json;
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
