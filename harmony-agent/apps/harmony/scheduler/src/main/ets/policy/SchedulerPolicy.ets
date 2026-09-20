import {
  AccuracyPreference,
  Backend,
  DeviceState,
  ExecutionPlan,
  InferenceLocation,
  LocalExecutionPlan,
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

const LOW_BATTERY_PERCENT: number = 20;
const POLICY_VERSION: string = 'weighted-utility-cpu-runtime-0.2.0';

export class SchedulerPolicy {
  public assessCapability(capability: string): TaskCapabilityAssessment {
    if (capability === 'camera_lens_realtime') {
      return {
        score: 98,
        urgencyLevel: 'CRITICAL (最高)',
        recommendedBackend: Backend.CPU,
        recommendedModelTier: ModelTier.HIGH_ACCURACY,
        recommendedThreadCount: 4,
        reason: '实时任务采用 CPU 4 线程；当前模型 Runtime 尚未启用 NNRT/NPU'
      };
    }
    if (capability === 'image_crop_detection') {
      return {
        score: 92,
        urgencyLevel: 'CRITICAL (最高)',
        recommendedBackend: Backend.CPU,
        recommendedModelTier: ModelTier.HIGH_ACCURACY,
        recommendedThreadCount: 4,
        reason: '图片特征任务采用 CPU 4 线程；当前模型 Runtime 尚未启用 NNRT/NPU'
      };
    }
    if (capability === 'chat_intent_reasoning') {
      return {
        score: 82,
        urgencyLevel: 'HIGH (高)',
        recommendedBackend: Backend.CPU,
        recommendedModelTier: ModelTier.BALANCED,
        recommendedThreadCount: 2,
        reason: '购物意图上下文分析，需要多核与平衡能效'
      };
    }
    if (capability === 'local_product_search') {
      return {
        score: 75,
        urgencyLevel: 'HIGH (高)',
        recommendedBackend: Backend.CPU,
        recommendedModelTier: ModelTier.BALANCED,
        recommendedThreadCount: 2,
        reason: '用户主动触发商品关键词与相似度检索'
      };
    }
    if (capability === 'category_rerank_sort') {
      return {
        score: 60,
        urgencyLevel: 'NORMAL (中)',
        recommendedBackend: Backend.CPU,
        recommendedModelTier: ModelTier.BALANCED,
        recommendedThreadCount: 2,
        reason: '端侧列表二次排序与价格区间筛选'
      };
    }
    if (capability === 'background_index_update') {
      return {
        score: 30,
        urgencyLevel: 'LOW (低)',
        recommendedBackend: Backend.CPU,
        recommendedModelTier: ModelTier.LIGHTWEIGHT,
        recommendedThreadCount: 1,
        reason: '后台批处理向量索引预热，低优先极度省电'
      };
    }
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

    if (state.thermalLevel === ThermalLevel.HOT) {
      return this.createThermalProtectionPlan(
        profile,
        priority,
        SchedulerReasonCode.THERMAL_HOT_DOWNGRADE,
        state
      );
    }

    if (mode === PolicyMode.FIXED_PERFORMANCE) {
      return this.createPlan(
        ModelTier.HIGH_ACCURACY,
        priority,
        defaultAction,
        [SchedulerReasonCode.FIXED_PERFORMANCE_MODE],
        state
      );
    }

    if (mode === PolicyMode.FIXED_POWER_SAVING) {
      const action: QueueAction = profile.taskType === TaskType.BACKGROUND_BATCH ?
        QueueAction.THROTTLE : defaultAction;
      const reasons: string[] = [SchedulerReasonCode.FIXED_POWER_SAVING_MODE];
      if (action === QueueAction.THROTTLE) {
        reasons.push(SchedulerReasonCode.BACKGROUND_QUEUE_THROTTLED);
      }
      return this.createPlan(ModelTier.LIGHTWEIGHT, priority, action, reasons, state);
    }

    return this.evaluateAdaptive(profile, state, priority, defaultAction);
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
      const reasons: string[] = [SchedulerReasonCode.LOW_BATTERY_PROTECTION];
      this.appendQueueReason(action, reasons);
      return this.createPlan(ModelTier.LIGHTWEIGHT, priority, action, reasons, state);
    }

    if (this.hasUnknownSafetyState(state)) {
      return this.createPlan(
        ModelTier.BALANCED,
        priority,
        defaultAction,
        [SchedulerReasonCode.STATE_UNKNOWN_CONSERVATIVE],
        state
      );
    }

    // 2. Multi-Dimensional Feature Weight Utility Score Model
    // a) Task Priority Weight w_priority (50% of Task Spec)
    let wPriority = 0.3;
    if (profile.taskType === TaskType.FOREGROUND_REALTIME) {
      wPriority = 1.0;
    } else if (profile.taskType === TaskType.USER_INITIATED) {
      wPriority = 0.7;
    }

    // b) Accuracy Preference Weight w_accuracy (30% of Task Spec)
    const wAccuracy = profile.accuracyPreference === AccuracyPreference.QUALITY_FIRST ? 1.0 : 0.4;

    // c) Latency Urgency Weight w_latency (20% of Task Spec)
    let wLatency = 0.3;
    if (profile.latencyBudgetMs !== null) {
      if (profile.latencyBudgetMs <= 150) {
        wLatency = 1.0;
      } else if (profile.latencyBudgetMs <= 500) {
        wLatency = 0.6;
      }
    }
    const taskSpecScore = (wPriority * 0.5) + (wAccuracy * 0.3) + (wLatency * 0.2);

    // d) Physical Environment Health Scaling Factors (f_battery * f_thermal * f_queue)
    let fBattery = 0.5;
    if (state.isCharging === true) {
      fBattery = 1.0;
    } else if (state.batteryPercent !== null) {
      fBattery = Math.min(1.0, Math.max(0.2, state.batteryPercent / 100.0));
    }

    let fThermal = 1.0;
    if (state.thermalLevel === ThermalLevel.WARM) {
      fThermal = 0.8;
    } else if (state.thermalLevel === ThermalLevel.HOT) {
      fThermal = 0.5;
    } else if (state.thermalLevel === ThermalLevel.CRITICAL) {
      fThermal = 0.3;
    }

    const fQueue = Math.max(0.4, 1.0 - (state.queueDepth * 0.1));

    // e) Final Composite Utility Score
    const finalUtilityScore = taskSpecScore * fBattery * fThermal * fQueue;

    // f) Score Threshold Mapping (Score -> ModelTier)
    let modelTier: ModelTier = ModelTier.LIGHTWEIGHT;
    const reasonCodes: string[] = [];

    if (finalUtilityScore >= 0.60) {
      modelTier = ModelTier.HIGH_ACCURACY;
      reasonCodes.push(`SCORE_HIGH_ACCURACY(${finalUtilityScore.toFixed(2)})`);
    } else if (finalUtilityScore >= 0.30) {
      modelTier = ModelTier.BALANCED;
      reasonCodes.push(`SCORE_BALANCED(${finalUtilityScore.toFixed(2)})`);
    } else {
      modelTier = ModelTier.LIGHTWEIGHT;
      reasonCodes.push(`SCORE_LIGHTWEIGHT(${finalUtilityScore.toFixed(2)})`);
    }

    return this.createPlan(modelTier, priority, defaultAction, reasonCodes, state);
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
      return this.createPlan(ModelTier.LIGHTWEIGHT, priority, QueueAction.REJECT, reasons, state);
    }

    const action: QueueAction = this.resolveProtectionAction(
      profile,
      this.resolveDefaultAction(profile.taskType)
    );
    this.appendQueueReason(action, reasons);
    return this.createPlan(ModelTier.LIGHTWEIGHT, priority, action, reasons, state);
  }

  private resolveProtectionAction(profile: TaskProfile, defaultAction: QueueAction): QueueAction {
    if (profile.taskType === TaskType.BACKGROUND_BATCH) {
      return profile.allowPause ? QueueAction.PAUSE : QueueAction.THROTTLE;
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
    state: DeviceState
  ): LocalExecutionPlan {
    const backend: Backend = this.resolveBackend(modelTier, state);
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

  private resolveBackend(modelTier: ModelTier, state: DeviceState): Backend {
    // The deployed MindSpore Lite context currently targets CPU only.
    // Device-declared accelerators must not be reported as the actual runtime backend.
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

  private hasUnknownSafetyState(state: DeviceState): boolean {
    return state.thermalLevel === ThermalLevel.UNKNOWN ||
      state.batteryPercent === null ||
      state.isCharging === null;
  }
}
