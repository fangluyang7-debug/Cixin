// hidebug.SystemMemInfo declares every memory field in KB in the SDK API contract.
export function memoryKilobytesToMb(value: number | bigint): number | null {
  const numeric: number = Number(value);
  return !Number.isFinite(numeric) || numeric < 0 ? null : Math.round(numeric / 1024);
}
