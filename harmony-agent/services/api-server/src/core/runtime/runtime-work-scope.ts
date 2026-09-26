import { AsyncLocalStorage } from 'node:async_hooks';

export interface RuntimeWorkMeasurements {
  storageReadMs: number;
  storageWriteMs: number;
  modelMs: number;
}
interface WorkScope { signal: AbortSignal; measurements: RuntimeWorkMeasurements; }
const scopes = new AsyncLocalStorage<WorkScope>();

export class RuntimeWorkScope {
  static run<T>(signal: AbortSignal, measurements: RuntimeWorkMeasurements, work: () => Promise<T>): Promise<T> {
    return scopes.run({ signal, measurements }, work);
  }
  static checkpoint(): void { scopes.getStore()?.signal.throwIfAborted(); }
  static signal(timeoutMs: number): AbortSignal {
    const current = scopes.getStore()?.signal;
    return current ? AbortSignal.any([current, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  }
  static async measure<T>(segment: keyof RuntimeWorkMeasurements, work: () => Promise<T>): Promise<T> {
    const scope = scopes.getStore();
    scope?.signal.throwIfAborted();
    const began = performance.now();
    try { const result = await work(); scope?.signal.throwIfAborted(); return result; }
    finally { if (scope) scope.measurements[segment] += performance.now() - began; }
  }
}
