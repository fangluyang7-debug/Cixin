import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function finite(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
export function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function byteLength(value: unknown): number { return Buffer.byteLength(JSON.stringify(value) ?? 'null'); }

// One process owns each directory. Atomic replacement records state before dispatch.
// Inputs and credentials are intentionally not written to the audit store.
export class JsonStore<T extends { updatedAt: number }> {
  constructor(private readonly directory: string) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  put(key: string, value: T): void {
    invariant(identifier(key), 'INVALID_STORE_KEY');
    const file = join(this.directory, `${key}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  get(key: string): T | undefined {
    invariant(identifier(key), 'INVALID_STORE_KEY');
    try { return JSON.parse(readFileSync(join(this.directory, `${key}.json`), 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  all(): Array<[string, T]> {
    return readdirSync(this.directory).filter(name => name.endsWith('.json')).map(name => {
      const key = name.slice(0, -5);
      return [key, this.get(key)!];
    });
  }
}
