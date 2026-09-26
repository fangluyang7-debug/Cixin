import { AsyncLocalStorage } from 'node:async_hooks';

export interface RuntimeWorkMeasurements {
  storageReadMs: number;
  storageWriteMs: number;
  modelMs: number;
}
interface WorkScope { pending: Set<Promise<unknown>>; signal: AbortSignal; measurements: RuntimeWorkMeasurements; }
const scopes = new AsyncLocalStorage<WorkScope>();

export class RuntimeWorkScope {
  static run<T>(signal: AbortSignal, measurements: RuntimeWorkMeasurements, work: () => Promise<T>): Promise<T> {
    const scope: WorkScope = { signal, measurements, pending: new Set() };
    return scopes.run(scope, async () => {
      try { return await work(); }
      finally {
        // A business timeout must not detach database or explicitly tracked child work.
        while (scope.pending.size) await Promise.allSettled([...scope.pending]);
      }
    });
  }
  static track<T>(work: Promise<T>): Promise<T> {
    const scope = scopes.getStore();
    if (scope) {
      scope.pending.add(work);
      void work.then(() => scope.pending.delete(work), () => scope.pending.delete(work));
    }
    return work;
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
