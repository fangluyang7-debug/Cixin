import { describe, expect, it } from '@ohos/hypium';
import {
  AccuracyPreference, AppVisibility, Backend, DependencyFailurePolicy, DeviceState,
  DeviceStateSource, DuplicatePolicy, ExecutionProfile, InferenceLocation, Interruptibility,
  MemoryPressure, ModelTier, PrivacyPolicy, QualityLevel, ResourcePrediction, TaskContext, TaskProfile,
  TaskType, ThermalLevel, WorkflowNode
} from '../../Index';
import { AdaptiveCostModel } from '../main/ets/policy/AdaptiveCostModel';
import { estimatedWorkflowCompletion, planWorkflowCosts, workflowUrgencyBonus } from '../main/ets/policy/WorkflowPlanner';
import { marginalAccelerationBonus } from '../main/ets/policy/MarginalAllocation';

function state(): DeviceState {
  return { batteryPercent: 80, isCharging: false, thermalLevel: ThermalLevel.NORMAL,
    appVisibility: AppVisibility.FOREGROUND, recentLatencyMs: null, queueDepth: 0,
    systemCpuUsage: 0, appCpuUsage: 0, memoryPressure: MemoryPressure.NORMAL,
    totalMemoryMb: 4096, freeMemoryMb: 2048, availableMemoryMb: 2048,
    availableBackends: [Backend.CPU], source: DeviceStateSource.REAL, capturedAt: Date.now() };
}

function profile(): TaskProfile {
  const execution: ExecutionProfile = { id: 'FAST', qualityLevelId: 'q', modelTier: ModelTier.HIGH_ACCURACY,
    backend: Backend.CPU, workerCount: 2, allowWarmup: false, supportsForeground: true,
    supportsBackground: true, estimatedQualityLevel: ModelTier.HIGH_ACCURACY,
    safeUnderPressure: true, qualityValidated: true, lowRisk: false };
  const context: TaskContext = { userVisible: true, userWaiting: true,
    accuracyFloor: ModelTier.HIGH_ACCURACY, inputTokens: 32, deadlineMs: 3000 };
  return { capability: 'encode', taskType: TaskType.USER_INITIATED,
    inferenceLocation: InferenceLocation.LOCAL_DEVICE, accuracyPreference: AccuracyPreference.QUALITY_FIRST,
    latencyBudgetMs: 3000, allowDegrade: false, allowPause: false, timeoutMs: 3000,
    submittedAt: Date.now(), context: context,
    template: { capability: 'encode', taskType: TaskType.USER_INITIATED,
      inferenceLocation: InferenceLocation.LOCAL_DEVICE, qualityLevels: [{ id: 'q',
        modelTier: ModelTier.HIGH_ACCURACY, estimatedLatencyMs: 100, estimatedMemoryMb: 32,
        supportedBackends: [Backend.CPU], supportedThreadCounts: [1, 2] }],
      interruptibility: Interruptibility.NON_INTERRUPTIBLE, duplicatePolicy: DuplicatePolicy.KEEP_ALL,
      privacyPolicy: PrivacyPolicy.LOCAL_ONLY,
      resourceHints: { modelVersion: 'v1', baselineInputTokens: 32 }, timeoutMs: 3000,
      manifest: { defaultProfileId: 'FAST', fallbackProfileId: 'FAST',
        profiles: [execution], profileTransitions: [] } } };
}

export default function localAlgorithmTests(): void {
  describe('LocalAlgorithm', () => {
    it('keeps critical path and serialized work distinct', 0, () => {
      const nodes: WorkflowNode[] = [
        { id: 'start', templateId: 'a', dependsOn: [], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW },
        { id: 'long', templateId: 'b', dependsOn: ['start'], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW },
        { id: 'short', templateId: 'c', dependsOn: ['start'], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW },
        { id: 'join', templateId: 'd', dependsOn: ['long', 'short'], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW }
      ];
      const estimates: Record<string, number> = {};
      estimates['start'] = 2;
      estimates['long'] = 40;
      estimates['short'] = 10;
      estimates['join'] = 5;
      const plan = planWorkflowCosts(nodes, estimates);
      expect(plan[0].criticalPathMs).assertEqual(47);
      expect(plan[0].serialRemainingMs).assertEqual(57);
      expect(estimatedWorkflowCompletion({ userVisible: true, userWaiting: true,
        accuracyFloor: ModelTier.HIGH_ACCURACY,
        workflowRemainingSerialMs: 75, workflowCurrentNodeEstimateMs: 40 }, 60)).assertEqual(95);
    });

    it('raises urgency as the workflow deadline approaches', 0, () => {
      expect(workflowUrgencyBonus(100, 80, 10, 40) > workflowUrgencyBonus(100, 0, 10, 40)).assertTrue();
    });

    it('uses actual samples only for matching profile bucket', 0, () => {
      const cost = new AdaptiveCostModel();
      const task = profile(); const current = state();
      const execution: ExecutionProfile = task.template!.manifest!.profiles[0];
      const level: QualityLevel = task.template!.qualityLevels[0];
      const prior: number = cost.predict(task, current, execution, level).latencyMs;
      for (let index: number = 0; index < 20; index++) { cost.observe(task, current, execution, 20); }
      const trained = cost.predict(task, current, execution, level);
      expect(trained.sampleCount).assertEqual(20);
      expect(trained.p95LatencyMs).assertEqual(20);
      expect(trained.latencyMs < prior).assertTrue();
      const other: ExecutionProfile = profile().template!.manifest!.profiles[0];
      other.id = 'OTHER';
      expect(cost.predict(task, current, other, level).sampleCount).assertEqual(0);
    });

    it('requires measured validated profiles for marginal acceleration', 0, () => {
      const base: ExecutionProfile = profile().template!.manifest!.profiles[0];
      const alternative: ExecutionProfile = profile().template!.manifest!.profiles[0];
      alternative.id = 'ALT';
      alternative.workerCount = 4;
      const measured: ResourcePrediction = { latencyMs: 100, sampleCount: 10, memoryMb: 32,
        relativeEnergyCost: 1, thermalRisk: 0, deadlineMissRisk: 0, confidence: 0.7, source: 'test' };
      const faster: ResourcePrediction = { latencyMs: 60, sampleCount: 10, memoryMb: 32,
        relativeEnergyCost: 1, thermalRisk: 0, deadlineMissRisk: 0, confidence: 0.7, source: 'test' };
      expect(marginalAccelerationBonus(base, measured,
        alternative, faster, 100) > 0).assertTrue();
      alternative.qualityValidated = false;
      expect(marginalAccelerationBonus(base, measured, alternative, faster, 100)).assertEqual(0);
    });
  });
}
