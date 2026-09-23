import {
  DeviceState, ExecutionProfile, MemoryPressure, QualityLevel, ResourcePrediction,
  TaskProfile, ThermalLevel
} from '../api/SchedulerTypes';

interface CostSample {
  meanMs: number;
  deviationMs: number;
  count: number;
  recent: number[];
  p50Ms: number;
  p95Ms: number;
}

// Updates happen after execution. The decision path reads one bounded bucket in O(1).
export class AdaptiveCostModel {
  private readonly buckets: Map<string, CostSample> = new Map<string, CostSample>();
  private readonly maxBuckets: number = 256;
  private readonly maxRecent: number = 50;

  public predict(task: TaskProfile, state: DeviceState, execution: ExecutionProfile,
    level: QualityLevel): ResourcePrediction {
    const scale: number = this.inputScale(task);
    const declared = task.template?.manifest?.profiles.find((item: ExecutionProfile) =>
      item.id === task.template!.manifest!.defaultProfileId);
    const declaredWorkers: number = declared?.workerCount ?? execution.workerCount;
    // Prior worker scaling is intentionally weak until measured; parallel speedup is not linear.
    const workerScale: number = Math.max(0.75, Math.min(1.5,
      Math.sqrt(declaredWorkers / execution.workerCount)));
    const batchScale: number = declared?.batchSize === undefined || execution.batchSize === undefined ? 1 :
      Math.max(0.25, Math.min(4, execution.batchSize / declared.batchSize));
    const dimensionScale: number = declared?.retrievalDimensions === undefined ||
      execution.retrievalDimensions === undefined ? 1 :
      0.5 + 0.5 * Math.max(0.0625, Math.min(1, execution.retrievalDimensions / declared.retrievalDimensions));
    const cpuLoad: number = state.systemCpuUsage === null ? 1.2 :
      1 + Math.max(0, Math.min(100, state.systemCpuUsage)) / 100;
    const heat: number = state.thermalLevel === ThermalLevel.HOT ? 1.8 :
      state.thermalLevel === ThermalLevel.WARM ? 1.2 : 1;
    const priorMs: number = Math.max(1, level.estimatedLatencyMs * scale * workerScale * batchScale *
      dimensionScale * cpuLoad * heat * 1.5);
    const sample: CostSample | undefined = this.buckets.get(this.key(task, state, execution));
    const latency: number = sample === undefined ? priorMs :
      Math.max(sample.meanMs + Math.max(2 * sample.deviationMs, sample.meanMs * 0.15),
        sample.count >= 5 ? sample.p95Ms : sample.meanMs);
    const deadline: number = (task.context?.deadlineMs ?? Infinity) -
      Math.max(0, Date.now() - (task.submittedAt ?? Date.now()));
    return {
      latencyMs: Math.max(1, latency),
      p50LatencyMs: sample === undefined || sample.count < 5 ? undefined : sample.p50Ms,
      p95LatencyMs: sample === undefined || sample.count < 20 ? undefined : sample.p95Ms,
      memoryMb: level.estimatedMemoryMb ?? task.template?.resourceHints.expectedMemoryMb ?? null,
      relativeEnergyCost: (level.relativeEnergyCost ?? 1) * scale * heat,
      thermalRisk: state.thermalLevel === ThermalLevel.HOT ? 0.8 :
        state.thermalLevel === ThermalLevel.WARM ? 0.4 : state.thermalLevel === ThermalLevel.UNKNOWN ? 0.5 : 0.1,
      deadlineMissRisk: Number.isFinite(deadline) ? Math.min(1, latency / Math.max(1, deadline)) : 0,
      confidence: sample === undefined ? 0.15 : Math.min(0.85, 0.2 + sample.count * 0.025),
      sampleCount: sample?.count ?? 0,
      source: sample === undefined ? 'PROFILE_PRIOR_UNCALIBRATED' : 'PROFILE_EWMA_UNCALIBRATED'
    };
  }

  public observe(task: TaskProfile, state: DeviceState, execution: ExecutionProfile, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 86400000) { return; }
    const key: string = this.key(task, state, execution);
    let sample: CostSample | undefined = this.buckets.get(key);
    if (sample === undefined) {
      if (this.buckets.size >= this.maxBuckets) { this.buckets.delete(Array.from(this.buckets.keys())[0]); }
      sample = { meanMs: durationMs, deviationMs: 0, count: 0, recent: [], p50Ms: durationMs, p95Ms: durationMs };
      this.buckets.set(key, sample);
    } else {
      sample.deviationMs = 0.75 * sample.deviationMs + 0.25 * Math.abs(durationMs - sample.meanMs);
      sample.meanMs = 0.75 * sample.meanMs + 0.25 * durationMs;
    }
    sample.count++;
    sample.recent.push(durationMs);
    if (sample.recent.length > this.maxRecent) { sample.recent.shift(); }
    const sorted: number[] = sample.recent.slice().sort((a: number, b: number) => a - b);
    sample.p50Ms = sorted[Math.ceil(sorted.length * 0.5) - 1];
    sample.p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
  }

  private inputScale(task: TaskProfile): number {
    const context = task.context!;
    const hints = task.template!.resourceHints;
    const tokens: number = (context.inputTokens ?? hints.baselineInputTokens ?? 1) /
      Math.max(1, hints.baselineInputTokens ?? 1);
    const candidates: number = (context.candidateCount ?? hints.baselineCandidateCount ?? 1) /
      Math.max(1, hints.baselineCandidateCount ?? 1);
    const elements: number = (context.inputShape ?? [1]).reduce((a: number, b: number) => a * b, 1) /
      Math.max(1, hints.baselineInputElements ?? 1);
    return Math.min(64, Math.max(0.25, tokens, candidates, elements) * (context.batchSize ?? 1));
  }

  private key(task: TaskProfile, state: DeviceState, execution: ExecutionProfile): string {
    const thermal: ThermalLevel = state.thermalLevel;
    const memory: MemoryPressure = state.memoryPressure;
    const cpu: string = state.systemCpuUsage === null ? 'unknown' :
      `${Math.floor(Math.max(0, Math.min(100, state.systemCpuUsage)) / 25)}`;
    return `${task.metadata?.environmentKey ?? 'local'}:${task.capability}:${task.template!.resourceHints.modelVersion}:${execution.id}:` +
      `${execution.backend}:${execution.workerCount}:${Math.round(Math.log2(this.inputScale(task)))}:` +
      `${thermal}:${memory}:${cpu}:${state.source}`;
  }
}
