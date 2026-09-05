export function toJsonString(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export function toJsonArrayString(value: unknown[]): string {
  return JSON.stringify(value ?? []);
}

export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
