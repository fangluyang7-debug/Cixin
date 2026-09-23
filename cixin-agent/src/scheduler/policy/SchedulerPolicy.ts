import {
  AccuracyPreference,
  Backend,
  DeviceState,
  ExecutionPlan,
  InferenceLocation,
  LocalExecutionPlan,
  MemoryPressure,
  ModelTier,
  PolicyMode,
  QueueAction,
  RemoteExecutionPlan,
  TaskPriority,
  TaskProfile,
  TaskType,
  ThermalLevel,
  ThreadCount
} from '../api/SchedulerTypes';
import { SchedulerReasonCode } from './SchedulerReasonCode';

export interface TaskCapabilityAssessment {
  score: number;
  urgencyLevel: string;
  recommendedBackend: Backend;
  recommendedModelTier: ModelTier;
  recommendedThreadCount: ThreadCount;
  reason: string;
}

interface TaskRuntimeProfile {
  score: number;
  backendPreference: Backend[];
  reasonCode: string;
}

const LOW_BATTERY_PERCENT: number = 20;
const BALANCED_BATTERY_PERCENT: number = 50;
const PERFORMANCE_BATTERY_PERCENT: number = 60;
const QUEUE_PRESSURE_DEPTH: number = 3;
const MEMORY_LOW_AVAILABLE_MB: number = 512;
const MEMORY_CRITICAL_AVAILABLE_MB: number = 192;
const POLICY_VERSION: string = 'stage4-runtime-prior-0.3.0';

export class SchedulerPolicy {
  public assessCapability(capability: string): TaskCapabilityAssessment {
    return {
      score: 50,
      urgencyLevel: 'NORMAL (中)',
      recommendedBackend: Backend.CPU,
      recommendedModelTier: ModelTier.BALANCED,
      recommendedThreadCount: 2,
      reason: '通用 AI 任务兜底评估'
    };
  }

  public evaluate(profile: TaskProfile, state: DeviceState, mode: PolicyMode): ExecutionPlan {
    const priority: TaskPriority = this.resolvePriority(profile.taskType);
    const defaultAction: QueueAction = this.resolveDefaultAction(profile.taskType);

    if (profile.inferenceLocation === InferenceLocation.REMOTE_CLOUD) {
      return this.createRemotePlan(profile, priority, defaultAction);
    }

    if (state.thermalLevel === ThermalLevel.CRITICAL) {
      return this.createThermalProtectionPlan(
        profile,
        priority,
        SchedulerReasonCode.THERMAL_CRITICAL_PROTECTION,
        state
      );
    }

    if (mode === PolicyMode.FIXED_PERFORMANCE) {
      return this.evaluateFixedPerformance(profile, state, priority, defaultAction);
    }

    if (mode === PolicyMode.FIXED_POWER_SAVING) {
      return this.evaluateFixedPowerSaving(profile, state, priority, defaultAction);
    }

    return this.evaluateAdaptive(profile, state, priority, defaultAction);
  }

  private evaluateFixedPerformance(
    profile: TaskProfile,
    state: DeviceState,
    priority: TaskPriority,
    defaultAction: QueueAction
  ): ExecutionPlan {
    const adaptivePlan: LocalExecutionPlan = this.evaluateAdaptive(
      profile,
      state,
      priority,
      defaultAction
    ) as LocalExecutionPlan;
    const reasons: string[] = [SchedulerReasonCode.FIXED_PERFORMANCE_MODE];
    this.appendReasons(reasons, this.stripBackendReasonCodes(adaptivePlan.reasonCodes));
    let tier: ModelTier = adaptivePlan.modelTier;
    let action: QueueAction = adaptivePlan.queueAction;

    if (!this.hasProtectionPressure(state, adaptivePlan)) {
      tier = ModelTier.HIGH_ACCURACY;
      action = defaultAction;
      reasons.push(SchedulerReasonCode.FIXED_PERFORMANCE_BIAS_APPLIED);
    } else if (state.queueDepth >= QUEUE_PRESSURE_DEPTH &&
      tier === ModelTier.HIGH_ACCURACY) {
      tier = ModelTier.BALANCED;
      reasons.push(SchedulerReasonCode.QUEUE_PRESSURE_BALANCED);
    }

    if (profile.taskType === TaskType.BACKGROUND_BATCH &&
      (this.hasMemoryPressure(state) || state.queueDepth >= QUEUE_PRESSURE_DEPTH)) {
      action = this.resolveProtectionAction(profile, action);
      this.appendQueueReason(action, reasons);
    }
    return this.createPlan(tier, priority, action, reasons, state, profile);
  }

  private evaluateFixedPowerSaving(
    profile: TaskProfile,
    state: DeviceState,
    priority: TaskPriority,
    defaultAction: QueueAction
  ): ExecutionPlan {
    const adaptivePlan: LocalExecutionPlan = this.evaluateAdaptive(
      profile,
      state,
      priority,
      defaultAction
    ) as LocalExecutionPlan;
    const reasons: string[] = [SchedulerReasonCode.FIXED_POWER_SAVING_MODE];
    this.appendReasons(reasons, this.stripBackendReasonCodes(adaptivePlan.reasonCodes));
    let tier: ModelTier = adaptivePlan.modelTier;
    let action: QueueAction = adaptivePlan.queueAction;

    if (!this.hasSafetyOverride(adaptivePlan)) {
      if (profile.taskType === TaskType.FOREGROUND_REALTIME &&
        !this.hasProtectionPressure(state, adaptivePlan)) {
        tier = this.downgradeTier(adaptivePlan.modelTier);
      } else if (profile.taskType === TaskType.USER_INITIATED) {
        if (this.hasProtectionPressure(state, adaptivePlan)) {
          tier = this.downgradeTier(adaptivePlan.modelTier);
        } else if (adaptivePlan.modelTier === ModelTier.HIGH_ACCURACY) {
          tier = ModelTier.BALANCED;
        } else {
          tier = adaptivePlan.modelTier;
        }
      } else {
        tier = ModelTier.LIGHTWEIGHT;
      }
      reasons.push(SchedulerReasonCode.FIXED_POWER_SAVING_BIAS_APPLIED);
    }

    if (profile.taskType === TaskType.BACKGROUND_BATCH) {
      action = this.resolveProtectionAction(profile, QueueAction.REJECT);
      this.appendQueueReason(action, reasons);
    }
    return this.createPlan(tier, priority, action, reasons, state, profile);
  }

  private evaluateAdaptive(
    profile: TaskProfile,
    state: DeviceState,
    priority: TaskPriority,
    defaultAction: QueueAction
  ): ExecutionPlan {
    // 1. Hard Safety Defense (低电量/状态未知硬性防御)
    if (this.isLowBattery(state)) {
      const action: QueueAction = this.resolveProtectionAction(profile, defaultAction);
      const reasons: string[] = [SchedulerReasonCode.LOW_BATTERY_PROTECTION, SchedulerReasonCode.SAFETY_OVERRIDE];
      this.appendQueueReason(action, reasons);
      return this.createPlan(ModelTier.LIGHTWEIGHT, priority, action, reasons, state, profile);
    }

    if (this.isCriticalMemory(state)) {
      const action: QueueAction = this.resolveProtectionAction(profile, defaultAction);
      const reasons: string[] = [SchedulerReasonCode.MEMORY_CRITICAL_PROTECTION, SchedulerReasonCode.SAFETY_OVERRIDE];
      if (!profile.allowDegrade) {
        reasons.push(SchedulerReasonCode.DEGRADE_DISALLOWED_REJECT);
        return this.createPlan(ModelTier.LIGHTWEIGHT, priority, QueueAction.REJECT, reasons, state, profile);
      }
      this.appendQueueReason(action, reasons);
      return this.createPlan(ModelTier.LIGHTWEIGHT, priority, action, reasons, state, profile);
    }

    if (this.hasUnknownSafetyState(state)) {
      return this.createPlan(
        ModelTier.BALANCED,
        priority,
        defaultAction,
        [SchedulerReasonCode.STATE_UNKNOWN_CONSERVATIVE],
        state,
        profile
      );
    }

    // 2. Multi-Dimensional Feature Weight Utility Score Model
    const runtimeProfile: TaskRuntimeProfile = this.resolveRuntimeProfile(profile.capability);

    // a) Task priority feature
    let wPriority = 0.3;
    if (profile.taskType === TaskType.FOREGROUND_REALTIME) {
      wPriority = 1.0;
    } else if (profile.taskType === TaskType.USER_INITIATED) {
      wPriority = 0.7;
    }

    // b) Accuracy preference feature
    let wAccuracy: number = 0.65;
    if (profile.accuracyPreference === AccuracyPreference.QUALITY_FIRST) {
      wAccuracy = 1.0;
    } else if (profile.accuracyPreference === AccuracyPreference.SPEED_FIRST) {
      wAccuracy = 0.45;
    }

    // c) Latency urgency feature
    let wLatency = 0.35;
    if (profile.latencyBudgetMs !== null) {
      if (profile.latencyBudgetMs <= 120) {
        wLatency = 1.0;
      } else if (profile.latencyBudgetMs <= 250) {
        wLatency = 0.75;
      } else if (profile.latencyBudgetMs <= 500) {
        wLatency = 0.55;
      }
    }
    const taskSpecScore = (runtimeProfile.score * 0.42) +
      (wPriority * 0.24) +
      (wAccuracy * 0.20) +
      (wLatency * 0.14);

    // d) Device and runtime scaling factors
    const fBattery: number = this.resolveBatteryFactor(state);
    const fThermal: number = this.resolveThermalFactor(state);
    const fQueue = Math.max(0.60, 1.0 - (state.queueDepth * 0.06));
    const fMemory: number = this.resolveMemoryFactor(state);
    const fRuntime = this.resolveRuntimeFeedbackFactor(profile, state);

    // e) Final Composite Utility Score
    const finalUtilityScore = taskSpecScore * fBattery * fThermal * fQueue * fMemory * fRuntime;

    // f) Score Threshold Mapping (Score -> ModelTier)
    let modelTier: ModelTier = ModelTier.LIGHTWEIGHT;
    let action: QueueAction = defaultAction;
    const reasonCodes: string[] = [runtimeProfile.reasonCode];
    reasonCodes.push(`TASK_SCORE(${taskSpecScore.toFixed(2)})`);
    reasonCodes.push(`DEVICE_SCALE(${(fBattery * fThermal * fQueue * fMemory * fRuntime).toFixed(2)})`);
    if (state.thermalLevel === ThermalLevel.HOT) {
      reasonCodes.push(SchedulerReasonCode.THERMAL_HOT_DOWNGRADE);
    } else if (state.thermalLevel === ThermalLevel.WARM) {
      reasonCodes.push(SchedulerReasonCode.THERMAL_WARM_BALANCED);
    }
    if (state.queueDepth >= QUEUE_PRESSURE_DEPTH) {
      reasonCodes.push(SchedulerReasonCode.QUEUE_PRESSURE_BALANCED);
    }
    if (this.hasMemoryPressure(state)) {
      reasonCodes.push(SchedulerReasonCode.MEMORY_PRESSURE_BALANCED);
    }
    if (state.batteryPercent !== null &&
      state.batteryPercent < PERFORMANCE_BATTERY_PERCENT &&
      state.isCharging !== true) {
      reasonCodes.push(SchedulerReasonCode.BATTERY_BALANCED);
    }
    if (state.recentLatencyMs !== null &&
      profile.latencyBudgetMs !== null &&
      state.recentLatencyMs > profile.latencyBudgetMs) {
      reasonCodes.push(SchedulerReasonCode.LATENCY_BUDGET_PRESSURE);
    }

    if (finalUtilityScore >= 0.70) {
      modelTier = ModelTier.HIGH_ACCURACY;
      reasonCodes.push(`SCORE_HIGH_ACCURACY(${finalUtilityScore.toFixed(2)})`);
    } else if (finalUtilityScore >= 0.30) {
      modelTier = ModelTier.BALANCED;
      reasonCodes.push(`SCORE_BALANCED(${finalUtilityScore.toFixed(2)})`);
    } else {
      modelTier = ModelTier.LIGHTWEIGHT;
      reasonCodes.push(`SCORE_LIGHTWEIGHT(${finalUtilityScore.toFixed(2)})`);
    }

    if (profile.taskType === TaskType.BACKGROUND_BATCH &&
      (state.thermalLevel === ThermalLevel.HOT || modelTier === ModelTier.LIGHTWEIGHT)) {
      if (state.thermalLevel === ThermalLevel.HOT) {
        modelTier = ModelTier.LIGHTWEIGHT;
      }
      action = this.resolveProtectionAction(profile, defaultAction);
      this.appendQueueReason(action, reasonCodes);
    }

    return this.createPlan(modelTier, priority, action, reasonCodes, state, profile);
  }

  private createThermalProtectionPlan(
    profile: TaskProfile,
    priority: TaskPriority,
    thermalReason: SchedulerReasonCode,
    state: DeviceState
  ): ExecutionPlan {
    const reasons: string[] = [thermalReason, SchedulerReasonCode.SAFETY_OVERRIDE];
    if (!profile.allowDegrade) {
      reasons.push(SchedulerReasonCode.DEGRADE_DISALLOWED_REJECT);
      return this.createPlan(ModelTier.LIGHTWEIGHT, priority, QueueAction.REJECT, reasons, state, profile);
    }

    const action: QueueAction = this.resolveProtectionAction(
      profile,
      this.resolveDefaultAction(profile.taskType)
    );
    this.appendQueueReason(action, reasons);
    return this.createPlan(ModelTier.LIGHTWEIGHT, priority, action, reasons, state, profile);
  }

  private resolveProtectionAction(profile: TaskProfile, defaultAction: QueueAction): QueueAction {
    if (profile.taskType === TaskType.BACKGROUND_BATCH) {
      return profile.allowPause ? QueueAction.PAUSE : QueueAction.REJECT;
    }
    return defaultAction;
  }

  private appendQueueReason(action: QueueAction, reasons: string[]): void {
    if (action === QueueAction.PAUSE) {
      reasons.push(SchedulerReasonCode.BACKGROUND_PAUSED_FOR_PROTECTION);
    } else if (action === QueueAction.THROTTLE) {
      reasons.push(SchedulerReasonCode.BACKGROUND_QUEUE_THROTTLED);
    }
  }

  private createRemotePlan(
    profile: TaskProfile,
    priority: TaskPriority,
    queueAction: QueueAction
  ): RemoteExecutionPlan {
    return {
      inferenceLocation: InferenceLocation.REMOTE_CLOUD,
      provider: profile.remoteOptions === undefined ? 'UNCONFIGURED_REMOTE' : profile.remoteOptions.provider,
      timeoutMs: profile.timeoutMs,
      maxRetries: profile.remoteOptions === undefined ? 0 : profile.remoteOptions.maxRetries,
      maxConcurrency: profile.remoteOptions === undefined ? 1 : profile.remoteOptions.maxConcurrency,
      allowLocalFallback: profile.remoteOptions === undefined ? false : profile.remoteOptions.allowLocalFallback,
      priority: priority,
      queueAction: queueAction,
      reasonCodes: [SchedulerReasonCode.REMOTE_CLOUD_SELECTED],
      policyVersion: POLICY_VERSION
    };
  }

  private createPlan(
    modelTier: ModelTier,
    priority: TaskPriority,
    queueAction: QueueAction,
    reasonCodes: string[],
    state: DeviceState,
    profile?: TaskProfile
  ): LocalExecutionPlan {
    const runtimeProfile: TaskRuntimeProfile = this.resolveRuntimeProfile(
      profile === undefined ? '' : profile.capability
    );
    const backend: Backend = this.resolveBackend(modelTier, state, runtimeProfile);
    const reasons: string[] = reasonCodes.slice();
    if (backend === Backend.NPU) {
      reasons.push(SchedulerReasonCode.NPU_BACKEND_SELECTED);
    } else if (backend === Backend.GPU) {
      reasons.push(SchedulerReasonCode.GPU_BACKEND_SELECTED);
    } else if (backend === Backend.NNRT) {
      reasons.push(SchedulerReasonCode.NNRT_BACKEND_SELECTED);
    } else if (this.hasAccelerator(state)) {
      reasons.push(SchedulerReasonCode.CPU_BACKEND_FALLBACK);
    }
    return {
      inferenceLocation: InferenceLocation.LOCAL_DEVICE,
      modelTier: modelTier,
      threadCount: this.resolveThreadCount(modelTier),
      backend: backend,
      priority: priority,
      queueAction: queueAction,
      reasonCodes: reasons,
      policyVersion: POLICY_VERSION
    };
  }

  private resolveBackend(modelTier: ModelTier, state: DeviceState, runtimeProfile: TaskRuntimeProfile): Backend {
    if (modelTier === ModelTier.LIGHTWEIGHT) {
      return Backend.CPU;
    }
    for (let index: number = 0; index < runtimeProfile.backendPreference.length; index++) {
      const preferred: Backend = runtimeProfile.backendPreference[index];
      if (this.hasBackend(state, preferred)) {
        return preferred;
      }
    }
    if (this.hasBackend(state, Backend.NPU)) {
      return Backend.NPU;
    }
    if (this.hasBackend(state, Backend.NNRT)) {
      return Backend.NNRT;
    }
    if (this.hasBackend(state, Backend.GPU)) {
      return Backend.GPU;
    }
    return Backend.CPU;
  }

  private hasAccelerator(state: DeviceState): boolean {
    return this.hasBackend(state, Backend.NPU) ||
      this.hasBackend(state, Backend.GPU) ||
      this.hasBackend(state, Backend.NNRT);
  }

  private hasBackend(state: DeviceState, backend: Backend): boolean {
    return state.availableBackends.indexOf(backend) >= 0;
  }

  private resolveThreadCount(tier: ModelTier): ThreadCount {
    if (tier === ModelTier.HIGH_ACCURACY) {
      return 4;
    }
    if (tier === ModelTier.BALANCED) {
      return 2;
    }
    return 1;
  }

  private downgradeTier(tier: ModelTier): ModelTier {
    if (tier === ModelTier.HIGH_ACCURACY) {
      return ModelTier.BALANCED;
    }
    return ModelTier.LIGHTWEIGHT;
  }

  private stripBackendReasonCodes(reasonCodes: string[]): string[] {
    return reasonCodes.filter((reasonCode: string) =>
      reasonCode !== SchedulerReasonCode.NPU_BACKEND_SELECTED &&
        reasonCode !== SchedulerReasonCode.GPU_BACKEND_SELECTED &&
        reasonCode !== SchedulerReasonCode.NNRT_BACKEND_SELECTED &&
        reasonCode !== SchedulerReasonCode.CPU_BACKEND_FALLBACK
    );
  }

  private appendReasons(target: string[], source: string[]): void {
    for (let index: number = 0; index < source.length; index++) {
      target.push(source[index]);
    }
  }

  private hasProtectionPressure(state: DeviceState, plan: LocalExecutionPlan): boolean {
    return this.hasSafetyOverride(plan) ||
      this.isLowBattery(state) ||
      state.thermalLevel === ThermalLevel.HOT ||
      state.thermalLevel === ThermalLevel.CRITICAL ||
      state.queueDepth >= QUEUE_PRESSURE_DEPTH ||
      this.hasMemoryPressure(state);
  }

  private hasSafetyOverride(plan: LocalExecutionPlan): boolean {
    return plan.reasonCodes.indexOf(SchedulerReasonCode.SAFETY_OVERRIDE) >= 0 ||
      plan.queueAction === QueueAction.REJECT;
  }

  private resolvePriority(taskType: TaskType): TaskPriority {
    if (taskType === TaskType.FOREGROUND_REALTIME) {
      return TaskPriority.CRITICAL;
    }
    if (taskType === TaskType.USER_INITIATED) {
      return TaskPriority.HIGH;
    }
    return TaskPriority.LOW;
  }

  private resolveDefaultAction(taskType: TaskType): QueueAction {
    return taskType === TaskType.FOREGROUND_REALTIME ? QueueAction.IMMEDIATE : QueueAction.ENQUEUE;
  }

  private isLowBattery(state: DeviceState): boolean {
    return state.batteryPercent !== null &&
      state.batteryPercent <= LOW_BATTERY_PERCENT &&
      state.isCharging !== true;
  }

  private hasMemoryPressure(state: DeviceState): boolean {
    return state.memoryPressure === MemoryPressure.HIGH ||
      state.memoryPressure === MemoryPressure.CRITICAL ||
      (state.availableMemoryMb !== null && state.availableMemoryMb < MEMORY_LOW_AVAILABLE_MB);
  }

  private isCriticalMemory(state: DeviceState): boolean {
    return state.memoryPressure === MemoryPressure.CRITICAL ||
      (state.availableMemoryMb !== null && state.availableMemoryMb < MEMORY_CRITICAL_AVAILABLE_MB);
  }

  private hasUnknownSafetyState(state: DeviceState): boolean {
    return state.thermalLevel === ThermalLevel.UNKNOWN ||
      state.batteryPercent === null ||
      state.isCharging === null;
  }

  private resolveRuntimeProfile(capability: string): TaskRuntimeProfile {
    return {
      score: 0.50,
      backendPreference: [Backend.GPU, Backend.NPU, Backend.NNRT, Backend.CPU],
      reasonCode: 'TASK_PROFILE_GENERIC'
    };
  }

  private resolveBatteryFactor(state: DeviceState): number {
    if (state.isCharging === true) {
      return 1.0;
    }
    if (state.batteryPercent === null) {
      return 0.55;
    }
    if (state.batteryPercent >= PERFORMANCE_BATTERY_PERCENT) {
      return 0.95;
    }
    if (state.batteryPercent >= BALANCED_BATTERY_PERCENT) {
      return 0.86;
    }
    if (state.batteryPercent >= 30) {
      return 0.70;
    }
    return Math.max(0.45, state.batteryPercent / 100.0 + 0.20);
  }

  private resolveThermalFactor(state: DeviceState): number {
    if (state.thermalLevel === ThermalLevel.NORMAL) {
      return 1.0;
    }
    if (state.thermalLevel === ThermalLevel.WARM) {
      return 0.88;
    }
    if (state.thermalLevel === ThermalLevel.HOT) {
      return 0.74;
    }
    if (state.thermalLevel === ThermalLevel.CRITICAL) {
      return 0.25;
    }
    return 0.70;
  }

  private resolveMemoryFactor(state: DeviceState): number {
    if (state.memoryPressure === MemoryPressure.NORMAL) {
      return 1.0;
    }
    if (state.memoryPressure === MemoryPressure.MODERATE) {
      return 0.92;
    }
    if (state.memoryPressure === MemoryPressure.HIGH) {
      return 0.76;
    }
    if (state.memoryPressure === MemoryPressure.CRITICAL) {
      return 0.40;
    }
    if (state.availableMemoryMb !== null) {
      if (state.availableMemoryMb < MEMORY_CRITICAL_AVAILABLE_MB) {
        return 0.40;
      }
      if (state.availableMemoryMb < MEMORY_LOW_AVAILABLE_MB) {
        return 0.76;
      }
    }
    return 1.0;
  }

  private resolveRuntimeFeedbackFactor(profile: TaskProfile, state: DeviceState): number {
    if (state.recentLatencyMs === null || profile.latencyBudgetMs === null || profile.latencyBudgetMs <= 0) {
      return 1.0;
    }
    if (state.recentLatencyMs <= profile.latencyBudgetMs) {
      return 1.0;
    }
    const pressureRatio: number = state.recentLatencyMs / profile.latencyBudgetMs;
    if (pressureRatio >= 4.0) {
      return 0.82;
    }
    if (pressureRatio >= 2.0) {
      return 0.90;
    }
    return 0.96;
  }
}
