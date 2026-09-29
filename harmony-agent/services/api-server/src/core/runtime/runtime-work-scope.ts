import { AsyncLocalStorage } from 'node:async_hooks';

export interface RuntimeWorkMeasurements {
  attemptId?: string;
  placementDecisions?: Record<string, unknown>[];
  modelCalls?: Array<{ purpose: string; modelId: string }>;
  imageSearch?: { primaryCount: number; fallbackCount: number; fallbackUsed: boolean };
  storageReadMs: number;
  storageWriteMs: number;
  modelMs: number;
}
interface WorkScope { deadline?: number; ownerId?: string; pending: Set<Promise<unknown>>; signal: AbortSignal; measurements: RuntimeWorkMeasurements; }
const scopes = new AsyncLocalStorage<WorkScope>();

export class RuntimeWorkScope {
  static recordImageSearch(primaryCount: number, fallbackCount: number, fallbackUsed: boolean): void {
    const scope = scopes.getStore();
    if (scope && Number.isInteger(primaryCount) && primaryCount >= 0 && primaryCount <= 100 &&
        Number.isInteger(fallbackCount) && fallbackCount >= 0 && fallbackCount <= 100) {
      scope.measurements.imageSearch = { primaryCount, fallbackCount, fallbackUsed };
    }
  }
  static recordModelCall(purpose: string, modelId: string): void {
    const scope = scopes.getStore();
    if (scope && /^[a-z0-9_.-]{1,80}$/i.test(purpose) && /^[a-z0-9_.-]{1,120}$/i.test(modelId)) {
      (scope.measurements.modelCalls ??= []).push({ purpose, modelId });
    }
  }
  static settlement<T>(work: () => Promise<T>): Promise<T> { return scopes.exit(work); }
  static recordAttempt(attemptId:string):void { const scope=scopes.getStore(); if(scope)scope.measurements.attemptId=attemptId; }
  static recordPlacement(value: Record<string,unknown>): void { const scope=scopes.getStore(); if(scope) { const records=scope.measurements.placementDecisions ?? []; if(records.length<16) records.push(value); scope.measurements.placementDecisions=records; } }
  static ownerId(): string | undefined { return scopes.getStore()?.ownerId; }
  static run<T>(signal: AbortSignal, measurements: RuntimeWorkMeasurements, work: () => Promise<T>, ownerId?: string, remainingBudgetMs?: number): Promise<T> {
    const scope: WorkScope = { signal, measurements, pending: new Set(), ownerId, deadline: remainingBudgetMs === undefined ? undefined : performance.now() + remainingBudgetMs };
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
  static remainingBudget(fallback: number): number { const deadline = scopes.getStore()?.deadline; return deadline === undefined ? fallback : Math.max(0, deadline - performance.now()); }
  static checkpoint(): void { scopes.getStore()?.signal.throwIfAborted(); }
  static signal(timeoutMs: number): AbortSignal {
    const current = scopes.getStore()?.signal;
    return current ? AbortSignal.any([current, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  }
  static async measure<T>(segment: 'storageReadMs' | 'storageWriteMs' | 'modelMs', work: () => Promise<T>): Promise<T> {
    const scope = scopes.getStore();
    scope?.signal.throwIfAborted();
    const began = performance.now();
    try { const result = await work(); scope?.signal.throwIfAborted(); return result; }
    finally { if (scope) scope.measurements[segment] += performance.now() - began; }
  }
}
