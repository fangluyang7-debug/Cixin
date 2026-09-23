import {
  AppVisibility, Backend, DeviceState, ExecutionPlan, InferenceLocation, LocalExecutionPlan, MemoryPressure,
  ModelTier, PolicyMode, PrivacyPolicy, QualityLevel, QueueAction, ResourcePrediction,
  TaskContext, TaskPriority, TaskProfile, TaskType, ThermalLevel, ThreadCount, ExecutionProfile
} from '../api/SchedulerTypes';
import { AdaptiveCostModel } from './AdaptiveCostModel';
import { estimatedWorkflowCompletion, workflowUrgencyBonus } from './WorkflowPlanner';

interface CostObservation {
  meanMs: number;
  deviationMs: number;
  count: number;
  samples: number[];
}

interface ConsumptionObservation {
  consumed: number;
  total: number;
}

export function qualityRank(tier: ModelTier): number {
  return tier === ModelTier.HIGH_ACCURACY ? 2 : tier === ModelTier.BALANCED ? 1 : 0;
}

// Estimates are local priors plus EWMA feedback, not calibrated probabilities or joules.
export class SemanticPolicy {
  private observations: Map<string, CostObservation> = new Map<string, CostObservation>();
  private readonly profileCosts: AdaptiveCostModel = new AdaptiveCostModel();
  private consumption: Map<string, ConsumptionObservation> = new Map<string, ConsumptionObservation>();

  public evaluate(profile: TaskProfile, state: DeviceState, mode: PolicyMode, maximumTier?: ModelTier): ExecutionPlan {
    const template = profile.template!;
    const context = profile.context!;
    const visible: boolean = context.userVisible && state.appVisibility === AppVisibility.FOREGROUND;
    const waiting: boolean = context.userWaiting && state.appVisibility === AppVisibility.FOREGROUND;
    const reasons: string[] = ['SEMANTIC_CONTRACT', 'LOCAL_DECISION'];
    const elapsed: number = Math.max(0, Date.now() - (profile.submittedAt ?? Date.now()));
    const deadline: number = context.deadlineMs === undefined ? Infinity : context.deadlineMs - elapsed;
    const freshness: number = context.freshnessMs === undefined ? Infinity : context.freshnessMs - elapsed;
    let rejection: string = '';
    if (context.requestReplaced) {
      rejection = 'REQUEST_REPLACED';
    } else if (freshness <= 0) {
      rejection = 'RESULT_EXPIRED';
    } else if (deadline <= 0) {
      rejection = 'DEADLINE_EXCEEDED';
    } else if (state.thermalLevel === ThermalLevel.CRITICAL) {
      rejection = 'THERMAL_CRITICAL_PROTECTION';
    } else if (state.memoryPressure === MemoryPressure.CRITICAL ||
      (state.availableMemoryMb !== null && state.availableMemoryMb < 192)) {
      rejection = 'MEMORY_CRITICAL_PROTECTION';
    }
    const remote: boolean = profile.inferenceLocation === InferenceLocation.REMOTE_CLOUD;
    if (remote && (template.privacyPolicy === PrivacyPolicy.LOCAL_ONLY ||
      (template.privacyPolicy === PrivacyPolicy.SANITIZED_REMOTE && context.inputSanitized !== true))) {
      rejection = 'PRIVACY_CONSTRAINT';
    } else if (remote && context.networkAllowed !== true) {
      rejection = 'NETWORK_NOT_ALLOWED';
    }
    const lowBattery: boolean = state.batteryPercent !== null && state.batteryPercent <= 20 &&
      state.isCharging !== true;
    const constrained: boolean = lowBattery || state.thermalLevel === ThermalLevel.HOT ||
      state.memoryPressure === MemoryPressure.HIGH ||
      (state.availableMemoryMb !== null && state.availableMemoryMb < 512);
    const unknown: boolean = state.batteryPercent === null || state.thermalLevel === ThermalLevel.UNKNOWN ||
      state.memoryPressure === MemoryPressure.UNKNOWN;
    if (unknown) { reasons.push('STATE_UNKNOWN_CONSERVATIVE'); }
    if (lowBattery) { reasons.push('LOW_BATTERY_PROTECTION'); }
    if (state.thermalLevel === ThermalLevel.HOT) { reasons.push('THERMAL_HOT_DOWNGRADE'); }
    const floor: number = context.highQuality ? 2 : qualityRank(context.accuracyFloor);
    let selected: QualityLevel | null = null;
    let prediction: ResourcePrediction | undefined = undefined;
    let backend: Backend = Backend.CPU;
    let threads: ThreadCount = 1;
    let bestScore: number = -Infinity;
    for (let i: number = 0; i < template.qualityLevels.length; i++) {
      const level: QualityLevel = template.qualityLevels[i];
      if (maximumTier !== undefined && qualityRank(level.modelTier) > qualityRank(maximumTier)) { continue; }
      if (qualityRank(level.modelTier) < floor) { continue; }
      if (constrained && qualityRank(level.modelTier) > 0) { continue; }
      if (unknown && qualityRank(level.modelTier) > 1) { continue; }
      const usable: Backend[] = level.supportedBackends.filter((item: Backend) =>
        state.availableBackends.indexOf(item) >= 0);
      if (!remote && usable.length === 0) { continue; }
      const targetBackend: Backend = remote ? Backend.CPU : usable[0];
      const desired: number = constrained || mode === PolicyMode.FIXED_POWER_SAVING ? 1 :
        unknown ? 2 : 4;
      const choices: ThreadCount[] = level.supportedThreadCounts.filter((count: ThreadCount) => count <= desired)
        .sort((left: ThreadCount, right: ThreadCount) => left - right);
      if (!remote && choices.length === 0) { continue; }
      const count: ThreadCount = choices.length === 0 ? 1 : choices[choices.length - 1];
      const estimate: ResourcePrediction = this.predict(profile, state, level, targetBackend, count, deadline);
      if (estimate.memoryMb !== null && state.availableMemoryMb !== null &&
        estimate.memoryMb > state.availableMemoryMb * 0.5) { continue; }
      if (estimatedWorkflowCompletion(context, estimate.latencyMs) > Math.min(deadline, freshness)) { continue; }
      const qualityWeight: number = mode === PolicyMode.FIXED_PERFORMANCE ? 5 :
        mode === PolicyMode.FIXED_POWER_SAVING ? 0.3 : 2;
      const score: number = qualityRank(level.modelTier) * qualityWeight - estimate.relativeEnergyCost * 0.2 -
        estimate.latencyMs / Math.max(1, Math.min(deadline, 1000)) - estimate.thermalRisk;
      if (score > bestScore) {
        bestScore = score;
        selected = level;
        prediction = estimate;
        backend = targetBackend;
        threads = count;
      }
    }
    if (selected === null) {
      rejection = rejection || 'NO_FEASIBLE_QUALITY_PLAN';
      selected = template.qualityLevels[template.qualityLevels.length - 1];
    }
    if (prediction !== undefined && prediction.confidence < 0.6) {
      reasons.push('PREDICTION_LOW_CONFIDENCE', 'CONSERVATIVE_COST_MARGIN');
    }
    const prior: number = profile.taskType === TaskType.FOREGROUND_REALTIME ? 15 :
      profile.taskType === TaskType.USER_INITIATED ? 10 : 0;
    const cost: number = prediction === undefined ? 100 : prediction.latencyMs;
    const pressure: number = workflowUrgencyBonus(context.deadlineMs, elapsed, cost,
      estimatedWorkflowCompletion(context, cost));
    const freshnessPressure: number = Number.isFinite(freshness) ? Math.min(15, cost / Math.max(1, freshness) * 15) : 0;
    const consumption: ConsumptionObservation | undefined = this.consumption.get(profile.capability);
    const consumptionFactor: number = consumption !== undefined && consumption.total >= 5 &&
      !waiting && !visible ? 0.5 + 0.5 * consumption.consumed / consumption.total : 1;
    if (consumptionFactor < 1) { reasons.push(`CONSUMPTION_FEEDBACK(${consumptionFactor.toFixed(2)})`); }
    const utility: number = prior + (context.businessImportance ?? 0.5) * 20 * consumptionFactor +
      (visible ? 15 : 0) + (waiting ? 30 : 0) + pressure + freshnessPressure -
      Math.min(15, cost / 100);
    const priority: TaskPriority = utility >= 65 ? TaskPriority.CRITICAL : utility >= 40 ? TaskPriority.HIGH :
      utility >= 20 ? TaskPriority.NORMAL : TaskPriority.LOW;
    let action: QueueAction = QueueAction.ENQUEUE;
    if (rejection.length > 0) {
      action = QueueAction.REJECT;
      reasons.push(rejection);
    } else if (constrained && profile.taskType === TaskType.BACKGROUND_BATCH && profile.allowPause) {
      action = QueueAction.PAUSE;
      reasons.push('BACKGROUND_PAUSED_FOR_PROTECTION');
    }
    reasons.push(`BUSINESS_UTILITY(${utility.toFixed(2)})`, `DEADLINE_PRESSURE(${pressure.toFixed(2)})`);
    if (remote) {
      return {
        inferenceLocation: InferenceLocation.REMOTE_CLOUD,
        provider: profile.remoteOptions!.provider, timeoutMs: profile.timeoutMs,
        maxRetries: profile.remoteOptions!.maxRetries, maxConcurrency: profile.remoteOptions!.maxConcurrency,
        allowLocalFallback: false, priority: priority, queueAction: action, reasonCodes: reasons,
        policyVersion: 'semantic-1.0', utilityScore: utility, prediction: prediction, qualityLevelId: selected.id
      };
    }
    return {
      inferenceLocation: InferenceLocation.LOCAL_DEVICE, modelTier: selected.modelTier,
      threadCount: threads, backend: backend, priority: priority, queueAction: action,
      reasonCodes: reasons, policyVersion: 'semantic-1.0', utilityScore: utility,
      prediction: prediction, qualityLevelId: selected.id
    };
  }

  public observe(profile: TaskProfile, state: DeviceState, plan: ExecutionPlan, durationMs: number): void {
    if (profile.template === undefined || plan.prediction === undefined || durationMs < 0) { return; }
    if (plan.executionProfile !== undefined) {
      this.profileCosts.observe(profile, state, plan.executionProfile, durationMs);
      return;
    }
    const key: string = this.key(profile, state, plan.qualityLevelId ?? '',
      plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE ? (plan as LocalExecutionPlan).backend : Backend.CPU,
      plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE ? (plan as LocalExecutionPlan).threadCount : 1);
    const previous: CostObservation | undefined = this.observations.get(key);
    if (previous === undefined) {
      if (this.observations.size >= 256) { this.observations.delete(Array.from(this.observations.keys())[0]); }
      this.observations.set(key, { meanMs: Math.max(1, durationMs), deviationMs: 0, count: 1, samples: [durationMs] });
    } else {
      previous.deviationMs = previous.deviationMs * 0.75 + Math.abs(durationMs - previous.meanMs) * 0.25;
      previous.meanMs = previous.meanMs * 0.75 + Math.max(1, durationMs) * 0.25;
      previous.count++;
      previous.samples.push(durationMs);
      if (previous.samples.length > 50) { previous.samples.shift(); }
    }
  }

  public observeConsumption(capability: string, consumed: boolean, previous?: boolean): void {
    let observation: ConsumptionObservation | undefined = this.consumption.get(capability);
    if (observation === undefined) {
      if (this.consumption.size >= 256) { this.consumption.delete(Array.from(this.consumption.keys())[0]); }
      observation = { consumed: 0, total: 0 };
      this.consumption.set(capability, observation);
    }
    if (previous === undefined) { observation.total++; }
    observation.consumed += (consumed ? 1 : 0) - (previous === true ? 1 : 0);
    observation.consumed = Math.max(0, Math.min(observation.total, observation.consumed));
  }

  public predictProfile(profile: TaskProfile, state: DeviceState, execution: ExecutionProfile): ResourcePrediction {
    const level = profile.template!.qualityLevels.find((item: QualityLevel) => item.id === execution.qualityLevelId)!;
    return this.profileCosts.predict(profile, state, execution, level);
  }

  private predict(profile: TaskProfile, state: DeviceState, level: QualityLevel,
    backend: Backend, threads: ThreadCount, deadline: number, profileId?: string): ResourcePrediction {
    const observation = this.observations.get(this.key(profile, state, profileId ?? level.id, backend, threads));
    const scale: number = this.inputScale(profile);
    const load: number = state.systemCpuUsage === null ? 1.2 : 1 + Math.max(0, state.systemCpuUsage) / 100;
    const heat: number = state.thermalLevel === ThermalLevel.HOT ? 1.8 :
      state.thermalLevel === ThermalLevel.WARM ? 1.2 : 1;
    const latency: number = observation === undefined ? level.estimatedLatencyMs * scale * load * heat * 1.5 :
      observation.meanMs + Math.max(observation.deviationMs * 2, observation.meanMs * 0.15);
    const sorted: number[] = observation === undefined ? [] : observation.samples.slice().sort((a: number, b: number) => a - b);
    const p50: number = sorted.length < 5 ? latency / 1.5 : sorted[Math.ceil(sorted.length * 0.5) - 1];
    const p95: number = sorted.length < 5 ? latency : sorted[Math.ceil(sorted.length * 0.95) - 1];
    return {
      latencyMs: Math.max(1, latency, p95), p50LatencyMs: p50, p95LatencyMs: p95,
      memoryMb: level.estimatedMemoryMb ?? profile.template!.resourceHints.expectedMemoryMb ?? null,
      relativeEnergyCost: (level.relativeEnergyCost ?? 1) * scale * heat,
      thermalRisk: state.thermalLevel === ThermalLevel.HOT ? 0.8 :
        state.thermalLevel === ThermalLevel.WARM ? 0.4 : state.thermalLevel === ThermalLevel.UNKNOWN ? 0.5 : 0.1,
      deadlineMissRisk: Number.isFinite(deadline) ? Math.min(1, latency / Math.max(1, deadline)) : 0,
      confidence: observation === undefined ? 0.2 : Math.min(0.9, 0.3 + observation.count * 0.1),
      sampleCount: observation === undefined ? 0 : observation.count,
      source: observation === undefined ? 'DECLARED_PRIOR_UNCALIBRATED' : 'LOCAL_EWMA_UNCALIBRATED'
    };
  }

  private inputScale(profile: TaskProfile): number {
    const context: TaskContext = profile.context!;
    const hints = profile.template!.resourceHints;
    const elements: number = (context.inputShape ?? [1]).reduce((a: number, b: number) => a * b, 1);
    return Math.max(0.25, Math.max(
      (context.inputTokens ?? hints.baselineInputTokens ?? 1) / (hints.baselineInputTokens ?? 1),
      (context.candidateCount ?? hints.baselineCandidateCount ?? 1) / (hints.baselineCandidateCount ?? 1),
      elements / (hints.baselineInputElements ?? elements)) * (context.batchSize ?? 1));
  }

  private key(profile: TaskProfile, state: DeviceState, level: string, backend: Backend, threads: number): string {
    return `${profile.capability}:${profile.template!.resourceHints.modelVersion}:${level}:${backend}:${threads}:` +
      `${Math.round(Math.log2(this.inputScale(profile)))}:${state.thermalLevel}:` +
      `${state.systemCpuUsage === null ? 'unknown' : Math.floor(state.systemCpuUsage / 25)}:` +
      `${state.source}:${state.memoryPressure}:${state.appVisibility}:` +
      `${state.batteryPercent === null ? 'unknown' : Math.floor(state.batteryPercent / 20)}`;
  }
}
