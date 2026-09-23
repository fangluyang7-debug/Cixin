import {
  AppVisibility, ConstrainedPolicyConfig, ConstrainedPolicyMode, DeviceState, ExecutionPlan,
  ExecutionProfile, ExecutorTelemetry, FeedbackOption, InferenceLocation, LocalExecutionPlan,
  MemoryPressure, PolicyDecisionAudit, QueueAction, ResourcePrediction, SchedulerLogEntry,
  TaskPriority, TaskProfile, TaskStatus, TaskType, ThermalLevel, UtilityComponents, FeedbackKind,
  FeedbackReceipt, FeedbackCalibration
} from '../api/SchedulerTypes';
import { defaultConstrainedPolicy, stablePolicyBucket, validatePolicy } from './ProfileContract';
import { qualityRank, SemanticPolicy } from './SemanticPolicy';
import { HysteresisController } from './HysteresisController';
import { calibrateFeedback } from './FeedbackCalibration';
import { estimatedWorkflowCompletion, workflowUrgencyBonus } from './WorkflowPlanner';
import { marginalAccelerationBonus } from './MarginalAllocation';

interface Candidate {
  profile: ExecutionProfile;
  prediction: ResourcePrediction;
  utility: UtilityComponents;
  score: number;
}

interface Breaker {
  key: string;
  reason: string;
}

interface TrialSample {
  taskId: string;
  stratum: string;
  profileId: string;
  cohort: string;
  duration: number;
  failed: boolean;
  cancelled: boolean;
  negative?: boolean;
  feedbackKind?: FeedbackKind;
}

interface SavedPolicyState {
  schema: number;
  version: string;
  breakers: Breaker[];
  disabled: boolean;
}

export function constrainedStateBucket(state: DeviceState): string {
  return `${state.source}:${state.thermalLevel}:${state.memoryPressure}:${state.appVisibility}:` +
    `${state.batteryPercent === null ? 'unknown' : state.batteryPercent <= 20 && state.isCharging !== true ? 'low' : 'ok'}:` +
    `${state.systemCpuUsage === null ? 'unknown' : Math.floor(state.systemCpuUsage / 25)}`;
}

// Local profile selection. Statistical estimates remain descriptive, not causal proof.
export class ConstrainedPolicy {
  private config: ConstrainedPolicyConfig = defaultConstrainedPolicy();
  private readonly hysteresis: HysteresisController = new HysteresisController(0, 0);
  private readonly breakers: Map<string, string> = new Map<string, string>();
  private readonly failures: Map<string, number> = new Map<string, number>();
  private samples: TrialSample[] = [];
  private configChangedAt: number = 0;
  private readonly versions: Map<string, string> = new Map<string, string>();

  constructor() { this.versions.set(this.config.version, JSON.stringify(this.config)); }

  public configure(config: ConstrainedPolicyConfig): void {
    validatePolicy(config);
    const snapshot = JSON.parse(JSON.stringify(config)) as ConstrainedPolicyConfig;
    const serialized: string = JSON.stringify(snapshot);
    const prior = this.versions.get(snapshot.version);
    if (prior !== undefined && prior !== serialized) { throw new Error('A policy version is immutable. Use a new version.'); }
    if (this.versions.size >= 64 && prior === undefined) { throw new Error('Policy version history is full. Restart the runtime.'); }
    if (this.config.version !== snapshot.version) { this.configChangedAt = Date.now(); }
    this.config = snapshot;
    this.disabled = false;
    this.versions.set(snapshot.version, serialized);
  }

  public getConfig(): ConstrainedPolicyConfig {
    const config = JSON.parse(JSON.stringify(this.config)) as ConstrainedPolicyConfig;
    if (this.disabled) { config.mode = ConstrainedPolicyMode.OBSERVE; }
    return config;
  }

  public disable(): void {
    // Keep the version and tripped circuits; mode is a local kill switch, not a policy revision.
    this.disabled = true;
  }
  private disabled: boolean = false;

  public evaluate(task: TaskProfile, state: DeviceState, costs: SemanticPolicy): LocalExecutionPlan {
    const manifest = task.template!.manifest!;
    const context = task.context!;
    const contractId: string = `${task.template!.capability}@${task.template!.resourceHints.modelVersion}`;
    const inputBucket: number = this.inputBucket(task);
    const now: number = Date.now();
    const elapsed: number = Math.max(0, now - (task.submittedAt ?? now));
    const reasons: string[] = ['LOCAL_DECISION', 'ATOMIC_EXECUTION_PROFILE'];
    const current: string = this.hysteresis.currentProfile(task.capability, this.config.version, manifest.defaultProfileId);
    const bucket: string = constrainedStateBucket(state);
    const pressure: boolean = state.thermalLevel === ThermalLevel.HOT || state.memoryPressure === MemoryPressure.HIGH ||
      (state.availableMemoryMb !== null && state.availableMemoryMb < 512) ||
      (state.batteryPercent !== null && state.batteryPercent <= 20 && state.isCharging !== true);
    const stale: boolean = (state.observations ?? []).some((item) =>
      (item.field === 'battery' ? state.batteryApplicable !== false : ['thermal', 'memory'].indexOf(item.field) >= 0) &&
      (!item.known || now - item.observedAtMs > 10000));
    const unknown: boolean = stale || (state.batteryApplicable !== false && (state.batteryPercent === null || state.isCharging === null)) ||
      state.thermalLevel === ThermalLevel.UNKNOWN || state.memoryPressure === MemoryPressure.UNKNOWN;
    const floor: number = context.highQuality || !task.allowDegrade ? 2 : qualityRank(context.accuracyFloor);
    const candidates: Candidate[] = [];
    let reject: string = '';
    if (context.requestReplaced) { reject = 'REQUEST_REPLACED'; }
    else if (elapsed >= (context.freshnessMs ?? Infinity)) { reject = 'RESULT_EXPIRED'; }
    else if (elapsed >= (context.deadlineMs ?? Infinity)) { reject = 'DEADLINE_EXCEEDED'; }
    else if (state.thermalLevel === ThermalLevel.CRITICAL) { reject = 'THERMAL_CRITICAL_PROTECTION'; }
    else if (state.memoryPressure === MemoryPressure.CRITICAL ||
      (state.availableMemoryMb !== null && state.availableMemoryMb < 192)) { reject = 'MEMORY_CRITICAL_PROTECTION'; }
    manifest.profiles.forEach((profile: ExecutionProfile) => {
      if (qualityRank(profile.estimatedQualityLevel) < floor ||
        state.availableBackends.indexOf(profile.backend) < 0 ||
        (state.appVisibility === AppVisibility.FOREGROUND ? !profile.supportsForeground : !profile.supportsBackground) ||
        (pressure && !profile.safeUnderPressure)) { return; }
      const prediction: ResourcePrediction = costs.predictProfile(task, state, profile);
      if (estimatedWorkflowCompletion(context, prediction.latencyMs) >
        Math.min(context.deadlineMs ?? Infinity, context.freshnessMs ?? Infinity) - elapsed ||
        (prediction.memoryMb !== null && state.availableMemoryMb !== null && prediction.memoryMb > state.availableMemoryMb * 0.5)) { return; }
      const utility = this.utility(task, state, profile, prediction, elapsed, bucket);
      candidates.push({ profile: profile, prediction: prediction, utility: utility,
        score: utility.waiting + utility.visibility + utility.importance - utility.targetPressure -
          utility.freshnessRisk - utility.qualityLoss - utility.energyCost - utility.thermalRisk -
          utility.memoryRisk - utility.feedbackPenalty });
    });
    let baseline = candidates.find((candidate: Candidate) => candidate.profile.id === manifest.defaultProfileId);
    let fallbackReason: string | undefined = undefined;
    if (unknown || pressure || baseline === undefined) {
      baseline = candidates.find((candidate: Candidate) => candidate.profile.id === manifest.fallbackProfileId) ?? baseline;
      fallbackReason = pressure ? 'DEVICE_PROTECTION_FALLBACK' : unknown ? 'STATE_UNKNOWN_CONSERVATIVE' : 'DEFAULT_INFEASIBLE';
    }
    // A stronger quality floor may select a declared adjacent profile, but never lower it.
    if (baseline === undefined) {
      baseline = candidates.find((candidate: Candidate) => manifest.profileTransitions.some(
        (edge) => edge.from === current && edge.to === candidate.profile.id));
    }
    if (baseline === undefined) { reject = reject || 'NO_FEASIBLE_EXECUTION_PROFILE'; }
    const baselineProfile = baseline?.profile ?? manifest.profiles.find((item) => item.id === manifest.fallbackProfileId)!;
    let proposed: Candidate | undefined = baseline;
    const rule = this.config.rules.find((item) => item.capability === task.template!.capability);
    const ruleInvalid: boolean = rule !== undefined && rule.allowedProfileIds.some((id: string) =>
      !manifest.profiles.some((profile: ExecutionProfile) => profile.id === id));
    let policyFailure: string | undefined = this.disabled ? 'POLICY_DISABLED' :
      this.config.expiresAtMs <= now ? 'POLICY_EXPIRED' : ruleInvalid ? 'POLICY_CAPABILITY_MISMATCH' : undefined;
    if ((this.config.mode === ConstrainedPolicyMode.CANARY || this.config.mode === ConstrainedPolicyMode.ACTIVE) &&
      (now < this.config.experimentStartedAtMs! || now >= this.config.experimentStartedAtMs! + this.config.maximumExperimentDurationMs!)) {
      policyFailure = 'EXPERIMENT_OUTSIDE_WINDOW';
    }
    if (!unknown && !pressure && policyFailure === undefined && this.config.mode !== ConstrainedPolicyMode.OBSERVE) {
      const reachable = candidates.filter((candidate: Candidate) =>
        (candidate.profile.id === current || manifest.profileTransitions.some((edge) => edge.from === current && edge.to === candidate.profile.id)) &&
        (rule === undefined || rule.allowedProfileIds.indexOf(candidate.profile.id) >= 0));
      reachable.sort((a: Candidate, b: Candidate) =>
        b.score + (baseline === undefined ? 0 : marginalAccelerationBonus(baseline.profile,
          baseline.prediction, b.profile, b.prediction, context.targetLatencyMs)) -
        a.score - (baseline === undefined ? 0 : marginalAccelerationBonus(baseline.profile,
          baseline.prediction, a.profile, a.prediction, context.targetLatencyMs)));
      proposed = reachable.find((item: Candidate) => item.profile.id === rule?.preferredProfileId) ?? reachable[0] ?? baseline;
    }
    let actual: Candidate | undefined = baseline;
    let cohort: 'BASELINE' | 'TREATMENT' = 'BASELINE';
    const stratum: string = this.stratum(contractId, task.taskType, `${bucket}:${inputBucket}`);
    const baselineSamples: number = this.samples.filter((sample: TrialSample) =>
      sample.stratum === stratum && sample.cohort === 'BASELINE' && sample.profileId === baselineProfile.id &&
      !sample.failed && !sample.cancelled).length;
    if (this.config.mode === ConstrainedPolicyMode.CANARY || this.config.mode === ConstrainedPolicyMode.ACTIVE) {
      const assigned: boolean = stablePolicyBucket(`${this.config.version}:${task.taskType}:${bucket}:` +
        `${context.workflowId ?? task.submittedAt ?? 0}`) < this.config.rolloutPercent * 100;
      if (assigned && proposed !== undefined && proposed.profile.id !== baselineProfile.id && policyFailure === undefined) {
        const profile = proposed.profile;
        const breaker = this.breakers.get(this.breakerKey(contractId, profile.id));
        const lowRisk: boolean = profile.lowRisk && task.taskType === TaskType.BACKGROUND_BATCH &&
          task.template!.interruptibility === 'CHECKPOINT';
        if (breaker !== undefined) {
          fallbackReason = breaker;
          actual = candidates.find((candidate: Candidate) => candidate.profile.id === manifest.fallbackProfileId) ?? baseline;
        }
        else if (!profile.qualityValidated || (this.config.mode === ConstrainedPolicyMode.CANARY && !lowRisk)) {
          fallbackReason = 'PROFILE_NOT_VALIDATED_FOR_ROLLOUT';
        } else if (baselineSamples < this.config.minimumSampleCount) { fallbackReason = 'INSUFFICIENT_BASELINE_SAMPLES'; }
        else if (now - this.configChangedAt < this.config.cooldownMs ||
          this.hysteresis.profileCooling(task.capability, this.config.version, now, this.config.cooldownMs)) {
          fallbackReason = 'PROFILE_COOLDOWN';
        } else { actual = proposed; cohort = 'TREATMENT'; }
      }
    }
    if (policyFailure !== undefined) {
      fallbackReason = policyFailure;
      actual = candidates.find((candidate: Candidate) => candidate.profile.id === manifest.fallbackProfileId) ?? baseline;
    }
    let selected = actual?.profile ?? baselineProfile;
    const circuit = this.breakers.get(this.breakerKey(contractId, selected.id));
    if (circuit !== undefined) {
      fallbackReason = circuit;
      actual = candidates.find((candidate: Candidate) => candidate.profile.id === manifest.fallbackProfileId &&
        !this.breakers.has(this.breakerKey(contractId, candidate.profile.id)));
      if (actual === undefined) { reject = reject || 'FALLBACK_CIRCUIT_OPEN'; }
      else { selected = actual.profile; cohort = 'BASELINE'; }
    }
    // Emergency recovery is a declared fallback. Normal learned transitions remain adjacent.
    if (fallbackReason !== undefined) { reasons.push(fallbackReason); }
    if (reject.length > 0) { reasons.push(reject); }
    if ((actual?.prediction.confidence ?? 0) < 0.6) { reasons.push('PREDICTION_LOW_CONFIDENCE'); }
    const pause: boolean = pressure && task.taskType === TaskType.BACKGROUND_BATCH && task.allowPause;
    if (pause) { reasons.push('BACKGROUND_PAUSED_FOR_PROTECTION'); }
    const audit: PolicyDecisionAudit = {
      contractId: contractId,
      mode: this.disabled ? ConstrainedPolicyMode.OBSERVE : this.config.mode, version: this.config.version,
      baselineProfileId: baselineProfile.id,
      shadowProfileId: this.disabled || this.config.mode === ConstrainedPolicyMode.OBSERVE ? undefined : proposed?.profile.id,
      actualProfileId: selected.id, cohort: cohort, stateBucket: bucket,
      inputSizeBucket: inputBucket,
      fallbackReason: fallbackReason, baselinePrediction: baseline?.prediction,
      shadowPrediction: this.disabled || this.config.mode === ConstrainedPolicyMode.OBSERVE ? undefined : proposed?.prediction,
      shadowReasonCodes: proposed === undefined ? ['NO_FEASIBLE_SHADOW_PROFILE'] :
        [rule === undefined ? 'BOUNDED_UTILITY_SELECTION' : 'STRUCTURED_LOCAL_POLICY'], utility: actual?.utility,
      actualConfirmed: false
    };
    const priorityScore: number = (context.userWaiting ? 30 : 0) + (context.userVisible ? 15 : 0) +
      (context.businessImportance ?? 0.5) * 20 +
      workflowUrgencyBonus(context.deadlineMs, elapsed, actual?.prediction.latencyMs ?? 1,
        estimatedWorkflowCompletion(context, actual?.prediction.latencyMs ?? 1)) +
      (context.targetLatencyMs === undefined || actual === undefined ? 0 :
        Math.min(10, (elapsed + actual.prediction.latencyMs) / context.targetLatencyMs * 5));
    return {
      inferenceLocation: InferenceLocation.LOCAL_DEVICE, modelTier: selected.modelTier,
      backend: selected.backend, threadCount: selected.workerCount,
      executionProfile: JSON.parse(JSON.stringify(selected)) as ExecutionProfile,
      priority: priorityScore >= 60 ? TaskPriority.CRITICAL : priorityScore >= 40 ? TaskPriority.HIGH :
        task.taskType === TaskType.BACKGROUND_BATCH ? TaskPriority.LOW : TaskPriority.NORMAL,
      queueAction: reject.length > 0 ? QueueAction.REJECT : pause ? QueueAction.PAUSE : QueueAction.ENQUEUE,
      reasonCodes: reasons, policyVersion: this.config.version, qualityLevelId: selected.qualityLevelId,
      prediction: actual?.prediction, utilityScore: priorityScore, policyAudit: audit
    };
  }

  public started(task: TaskProfile, plan: ExecutionPlan): void {
    if (plan.executionProfile !== undefined) {
      this.hysteresis.commitProfile(task.capability, plan.policyVersion, plan.executionProfile.id, Date.now());
    }
  }

  public matches(plan: ExecutionPlan, actual?: ExecutorTelemetry): boolean {
    const profile = plan.executionProfile;
    if (profile === undefined) { return true; }
    return actual !== undefined && actual.executionPath !== 'serial_fallback' &&
      actual.profileId === profile.id && actual.actualModelTier === profile.modelTier &&
      actual.actualBackend === profile.backend && actual.workerCount === profile.workerCount &&
      (actual.actualThreads === undefined || actual.actualThreads === profile.workerCount) &&
      (profile.candidateCount === undefined || actual.candidateCount === profile.candidateCount) &&
      (profile.retrievalDimensions === undefined || actual.retrievalDimensions === profile.retrievalDimensions) &&
      (profile.batchSize === undefined || actual.batchSize === profile.batchSize);
  }

  public trip(capability: string, plan: ExecutionPlan, reason: string): void {
    if (plan.executionProfile === undefined) { return; }
    const key: string = `${plan.policyVersion}:${plan.policyAudit?.contractId ?? capability}:${plan.executionProfile.id}`;
    if (this.breakers.size >= 256 && !this.breakers.has(key)) { this.disabled = true; return; }
    this.breakers.set(key, reason);
    if (plan.policyAudit !== undefined) { plan.policyAudit.fallbackReason = reason; }
    if (plan.reasonCodes.indexOf(reason) < 0) { plan.reasonCodes.push(reason); }
  }

  public observe(task: TaskProfile, log: SchedulerLogEntry): void {
    const audit = log.executionPlan.policyAudit;
    if (audit === undefined || log.startedAt === null) { return; }
    const capability: string = audit.contractId;
    const key: string = `${audit.version}:${capability}:${audit.actualProfileId}`;
    const failed: boolean = log.status === TaskStatus.FAILED || log.status === TaskStatus.TIMED_OUT;
    const consecutive: number = failed ? (this.failures.get(key) ?? 0) + 1 : 0;
    if (this.failures.size >= 256 && !this.failures.has(key)) { this.failures.delete(Array.from(this.failures.keys())[0]); }
    this.failures.set(key, consecutive);
    const versionConfig: string | undefined = this.versions.get(audit.version);
    const failureLimit: number = versionConfig === undefined ? 3 :
      (JSON.parse(versionConfig) as ConstrainedPolicyConfig).consecutiveFailureLimit;
    if (consecutive >= failureLimit) { this.trip(capability, log.executionPlan, 'CONSECUTIVE_FAILURE_CIRCUIT'); }
    if (audit.version !== this.config.version || log.telemetry?.mixedExecution === true) { return; }
    this.samples.push({ taskId: log.taskId, stratum: this.stratum(capability, log.taskType, `${audit.stateBucket}:${audit.inputSizeBucket}`),
      profileId: audit.actualProfileId, cohort: audit.cohort, duration: log.telemetry?.endToEndDurationMs ?? log.totalDurationMs ?? 0,
      failed: failed, cancelled: log.status === TaskStatus.CANCELLED });
    if (this.samples.length > 1000) { this.samples.shift(); }
    this.checkRegression(capability, log);
  }

  public feedback(capability: string, log: SchedulerLogEntry): FeedbackReceipt {
    const audit = log.executionPlan.policyAudit;
    const receipt: FeedbackReceipt = { accepted: true, taskRunId: log.taskId, effect: 'RECORDED_ONLY',
      reason: 'SAMPLE_NOT_ELIGIBLE', policyVersion: audit?.version, mode: this.getConfig().mode,
      minimumSamples: this.config.minimumSampleCount };
    const sample = this.samples.find((item: TrialSample) => item.taskId === log.taskId);
    if (sample === undefined || log.telemetry?.userFeedback === undefined || audit === undefined ||
      audit.version !== this.config.version || audit.actualConfirmed !== true || log.telemetry.mixedExecution === true) { return receipt; }
    const before = this.calibration(sample.stratum, sample.profileId);
    sample.negative = [FeedbackOption.SLOW, FeedbackOption.NO_RESULT, FeedbackOption.INACCURATE,
      FeedbackOption.IRRELEVANT, FeedbackOption.TOO_HOT].indexOf(log.telemetry.userFeedback.option) >= 0;
    sample.feedbackKind = log.telemetry.userFeedback.kind;
    const after = this.calibration(sample.stratum, sample.profileId);
    receipt.before = before; receipt.after = after;
    const enough: boolean = sample.feedbackKind === FeedbackKind.RESPONSE_TIME ? after.speedSamples >= this.config.minimumSampleCount :
      sample.feedbackKind === FeedbackKind.RESULT_UTILITY ? after.qualitySamples >= this.config.minimumSampleCount :
        after.profileSamples >= this.config.minimumSampleCount;
    receipt.effect = enough ? 'CALIBRATED' : 'COLLECTING';
    receipt.reason = enough ? 'BOUNDED_CALIBRATION_FOR_FUTURE_DECISIONS' : 'MINIMUM_FEEDBACK_SAMPLES_NOT_REACHED';
    this.checkRegression(log.executionPlan.policyAudit!.contractId, log);
    return receipt;
  }

  private calibration(stratum: string, profileId: string): FeedbackCalibration {
    return calibrateFeedback(this.samples.filter((sample: TrialSample) => sample.stratum === stratum),
      profileId, this.config.minimumSampleCount, this.config.observationWindowSize);
  }

  public exportState(): string {
    const state: SavedPolicyState = { schema: 1, version: this.config.version, disabled: this.disabled,
      breakers: Array.from(this.breakers.keys()).map((key: string): Breaker => ({ key: key, reason: this.breakers.get(key)! })) };
    return JSON.stringify(state);
  }

  public restoreState(raw: string): boolean {
    try {
      if (raw.length > 65536) { return false; }
      const state = JSON.parse(raw) as SavedPolicyState;
      if (state.schema !== 1 || state.version !== this.config.version || typeof state.disabled !== 'boolean' || !Array.isArray(state.breakers) ||
        state.breakers.length > 256 || state.breakers.some((item: Breaker) => typeof item.key !== 'string' ||
          item.key.length > 256 || typeof item.reason !== 'string' || item.reason.length > 128)) { return false; }
      state.breakers.forEach((item: Breaker) => this.breakers.set(item.key, item.reason));
      this.disabled = this.disabled || state.disabled;
      return true;
    } catch (_) { return false; }
  }

  private breakerKey(capability: string, profileId: string): string { return `${this.config.version}:${capability}:${profileId}`; }
  private stratum(capability: string, type: TaskType, bucket: string): string { return `${this.config.version}:${capability}:${type}:${bucket}`; }

  private utility(task: TaskProfile, state: DeviceState, profile: ExecutionProfile,
    prediction: ResourcePrediction, elapsed: number, bucket: string): UtilityComponents {
    const context = task.context!;
    const contractId: string = `${task.template!.capability}@${task.template!.resourceHints.modelVersion}`;
    const stratum: string = this.stratum(contractId, task.taskType, `${bucket}:${this.inputBucket(task)}`);
    const calibrated = this.calibration(stratum, profile.id);
    return {
      waiting: context.userWaiting && state.appVisibility === AppVisibility.FOREGROUND ? 30 : 0,
      visibility: context.userVisible && state.appVisibility === AppVisibility.FOREGROUND ? 15 : 0,
      importance: (context.businessImportance ?? 0.5) * 20,
      targetPressure: context.targetLatencyMs === undefined ? 0 : Math.min(20, (elapsed + prediction.latencyMs) / context.targetLatencyMs * calibrated.latencyWeight),
      freshnessRisk: context.freshnessMs === undefined ? 0 : Math.min(15, prediction.latencyMs / Math.max(1, context.freshnessMs - elapsed) * 15),
      qualityLoss: (2 - qualityRank(profile.estimatedQualityLevel)) * calibrated.qualityWeight,
      energyCost: prediction.relativeEnergyCost * 0.2,
      thermalRisk: prediction.thermalRisk * 2,
      memoryRisk: prediction.memoryMb === null || state.availableMemoryMb === null ? 1 : prediction.memoryMb / Math.max(1, state.availableMemoryMb),
      feedbackPenalty: calibrated.profilePenalty
    };
  }

  private checkRegression(capability: string, log: SchedulerLogEntry): void {
    const limits = this.config.thresholds;
    const audit = log.executionPlan.policyAudit;
    if (limits === undefined || audit === undefined || audit.version !== this.config.version) { return; }
    const stratum: string = this.stratum(capability, log.taskType, `${audit.stateBucket}:${audit.inputSizeBucket}`);
    const samples = this.samples.filter((item: TrialSample) => item.stratum === stratum);
    const baseline = samples.filter((item: TrialSample) => item.cohort === 'BASELINE' &&
      item.profileId === audit.baselineProfileId).slice(-this.config.observationWindowSize);
    const treatmentIds: string[] = [];
    samples.forEach((item: TrialSample) => { if (item.cohort === 'TREATMENT' && treatmentIds.indexOf(item.profileId) < 0) { treatmentIds.push(item.profileId); } });
    treatmentIds.forEach((id: string) => {
      const treatment = samples.filter((item: TrialSample) => item.cohort === 'TREATMENT' && item.profileId === id).slice(-this.config.observationWindowSize);
      if (baseline.length < this.config.minimumSampleCount || treatment.length < this.config.minimumSampleCount) { return; }
      const b95: number = this.p95(baseline); const t95: number = this.p95(treatment);
      const badFeedback: boolean = [FeedbackKind.RESPONSE_TIME, FeedbackKind.RESULT_UTILITY, FeedbackKind.DEVICE_COMFORT].some((kind: FeedbackKind) => {
        const bFeedback = baseline.filter((item: TrialSample) => item.feedbackKind === kind && item.negative !== undefined);
        const tFeedback = treatment.filter((item: TrialSample) => item.feedbackKind === kind && item.negative !== undefined);
        return bFeedback.length >= this.config.minimumSampleCount && tFeedback.length >= this.config.minimumSampleCount &&
          tFeedback.filter((item: TrialSample) => item.negative).length / tFeedback.length -
          bFeedback.filter((item: TrialSample) => item.negative).length / bFeedback.length > limits.negativeFeedbackRateDelta;
      });
      if (t95 > Math.max(1, b95) * limits.latencyRatio ||
        treatment.filter((item: TrialSample) => item.failed).length / treatment.length -
        baseline.filter((item: TrialSample) => item.failed).length / baseline.length > limits.failureRateDelta ||
        treatment.filter((item: TrialSample) => item.cancelled).length / treatment.length -
        baseline.filter((item: TrialSample) => item.cancelled).length / baseline.length > limits.cancellationRateDelta || badFeedback) {
        this.breakers.set(this.breakerKey(capability, id), 'NON_INFERIORITY_STOP');
        if (audit.actualProfileId === id) { audit.fallbackReason = 'NON_INFERIORITY_STOP'; }
      }
    });
  }

  private p95(samples: TrialSample[]): number {
    const sorted = samples.map((item: TrialSample) => item.duration).sort((a: number, b: number) => a - b);
    return sorted[Math.ceil(sorted.length * 0.95) - 1];
  }

  private inputBucket(task: TaskProfile): number {
    const context = task.context!;
    const elements: number = (context.inputShape ?? [1]).reduce((a: number, b: number) => a * b, 1);
    return Math.floor(Math.log2(Math.max(1, context.inputTokens ?? context.candidateCount ?? elements) * (context.batchSize ?? 1)));
  }
}
