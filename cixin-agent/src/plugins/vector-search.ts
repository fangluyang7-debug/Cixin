import { setImmediate } from 'node:timers/promises';
import { ToolImplementation } from '../contracts/fleet';
import { Backend, DuplicatePolicy, InferenceLocation, Interruptibility, ModelTier, PrivacyPolicy, TaskType } from '../scheduler/api/SchedulerTypes';
import { finite, invariant } from '../runtime/util';

export function vectorSearchTool(): ToolImplementation {
  const id = 'catalog.vector_search';
  const profile = { id: 'cpu-exact', qualityLevelId: 'exact', modelTier: ModelTier.HIGH_ACCURACY,
    backend: Backend.CPU, workerCount: 1 as const, allowWarmup: false, supportsForeground: true,
    supportsBackground: true, estimatedQualityLevel: ModelTier.HIGH_ACCURACY,
    safeUnderPressure: true, qualityValidated: true, lowRisk: true };
  return {
    descriptor: {
      toolId: id, version: '1.0.0', description: 'Exact cosine search over caller-provided vectors',
      inputType: 'cixin.vector-query.v1', outputType: 'cixin.vector-results.v1',
      preconditions: ['finite matching dimensions', 'nonzero vectors'], postconditions: ['full exact scan'],
      quality: { minimumScore: 1 }, constraints: { privacy: 'internal', locality: 'local_preferred',
        allowLocal: true, allowCloud: false }, resourceHints: { computeClass: 'general_cpu', estimatedMemoryMb: 16 },
      execution: { supportsPause: false, supportsRetry: true, maxAttempts: 1, compensationActions: [] },
      defaultWeights: { latency: 0.5, quality: 0.3, energy: 0.1, reliability: 0.1 },
    },
    template: {
      capability: id, concurrentSafe: false, taskType: TaskType.USER_INITIATED,
      inferenceLocation: InferenceLocation.LOCAL_DEVICE, interruptibility: Interruptibility.CANCEL_RESTART,
      duplicatePolicy: DuplicatePolicy.KEEP_ALL, privacyPolicy: PrivacyPolicy.LOCAL_ONLY, timeoutMs: 10000,
      resourceHints: { modelVersion: 'cosine-exact-v1', expectedMemoryMb: 16 },
      qualityLevels: [{ id: 'exact', modelTier: ModelTier.HIGH_ACCURACY, estimatedLatencyMs: 20,
        estimatedMemoryMb: 16, supportedBackends: [Backend.CPU], supportedThreadCounts: [1] }],
      manifest: { profiles: [profile], defaultProfileId: profile.id, fallbackProfileId: profile.id, profileTransitions: [] },
    },
    modelDigest: 'builtin-cosine-exact-v1', runtimeVersion: 'cixin-vector-v1',
    probe: async () => ({ available: true }),
    executor: {
      capability: id, inferenceLocation: InferenceLocation.LOCAL_DEVICE,
      supports: plan => plan.executionProfile?.id === profile.id && plan.executionProfile.backend === Backend.CPU,
      async execute(raw, plan, signal) {
        const input = raw as { query: number[]; vectors: Array<{ id: string; values: number[] }>; limit?: number };
        const validVector = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.length <= 4096 &&
          v.every(x => finite(x, -1e6, 1e6)) && v.some(x => x !== 0);
        invariant(input && validVector(input.query) && Array.isArray(input.vectors) && input.vectors.length <= 10000, 'INVALID_VECTOR_INPUT');
        const limit = input.limit ?? 10;
        invariant(Number.isInteger(limit) && finite(limit, 1, 1000), 'INVALID_LIMIT');
        const qnorm = Math.sqrt(input.query.reduce((sum, x) => sum + x * x, 0));
        const output: Array<{ id: string; score: number }> = [];
        const ids = new Set<string>();
        for (let i = 0; i < input.vectors.length; i++) {
          if (i % 128 === 0) { await setImmediate(); invariant(!signal.isCancellationRequested, 'TASK_CANCELLED'); }
          const row = input.vectors[i];
          invariant(row && typeof row.id === 'string' && !ids.has(row.id) && validVector(row.values) &&
            row.values.length === input.query.length, 'INVALID_VECTOR_ROW');
          ids.add(row.id);
          const norm = Math.sqrt(row.values.reduce((sum, x) => sum + x * x, 0));
          const dot = row.values.reduce((sum, x, index) => sum + x * input.query[index], 0);
          output.push({ id: row.id, score: dot / (norm * qnorm) });
        }
        output.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
        return { output: output.slice(0, limit), telemetry: {
          profileId: profile.id, actualModelTier: profile.modelTier, actualBackend: profile.backend,
          actualThreads: 1, workerCount: 1, modelVersion: 'cosine-exact-v1', executionPath: 'cpu_exact',
        } };
      },
      async dispose() {},
    },
  };
}
