import { afterEach, describe, expect, it } from '@ohos/hypium';
import {
  AccuracyPreference,
  AppVisibility,
  Backend,
  DeviceState,
  DeviceStateController,
  DeviceStateSource,
  ExecutionPlan,
  InferenceLocation,
  LocalExecutionPlan,
  ModelTier,
  RemoteExecutionPlan,
  PolicyMode,
  QueueAction,
  SchedulerConfig,
  SchedulerError,
  SchedulerErrorCode,
  SchedulerService,
  TaskRequest,
  TaskResult,
  TaskPriority,
  TaskProfile,
  TaskStatus,
  TaskType,
  ThermalLevel
} from '../../Index';
import { HysteresisController } from '../main/ets/policy/HysteresisController';
import { SchedulerPolicy } from '../main/ets/policy/SchedulerPolicy';

function createConfig(mode: PolicyMode = PolicyMode.ADAPTIVE): SchedulerConfig {
  return {
    defaultPolicyMode: mode,
    enableDebugInjection: true,
    metricsWindowSize: 100,
    upgradeStableDurationMs: 10000,
    minimumTierHoldMs: 5000,
    executors: []
  };
}

function createProfile(
  taskType: TaskType = TaskType.FOREGROUND_REALTIME,
  accuracy: AccuracyPreference = AccuracyPreference.BALANCED,
  allowDegrade: boolean = true,
  allowPause: boolean = true
): TaskProfile {
  return {
    taskType: taskType,
    inferenceLocation: InferenceLocation.LOCAL_DEVICE,
    capability: 'mock_inference',
    accuracyPreference: accuracy,
    latencyBudgetMs: 100,
    allowDegrade: allowDegrade,
    allowPause: allowPause,
    timeoutMs: 3000
  };
}

function createState(
  batteryPercent: number | null,
  isCharging: boolean | null,
  thermalLevel: ThermalLevel,
  queueDepth: number = 0,
  recentLatencyMs: number | null = null
): DeviceState {
  return {
    batteryPercent: batteryPercent,
    isCharging: isCharging,
    thermalLevel: thermalLevel,
    appVisibility: AppVisibility.FOREGROUND,
    recentLatencyMs: recentLatencyMs,
    queueDepth: queueDepth,
    availableBackends: [Backend.CPU],
    source: DeviceStateSource.INJECTED,
    capturedAt: 0
  };
}

function createPlan(tier: ModelTier): LocalExecutionPlan {
  let threadCount: 1 | 2 | 4 = 1;
  if (tier === ModelTier.HIGH_ACCURACY) {
    threadCount = 4;
  } else if (tier === ModelTier.BALANCED) {
    threadCount = 2;
  }
  return {
    inferenceLocation: InferenceLocation.LOCAL_DEVICE,
    modelTier: tier,
    threadCount: threadCount,
    backend: Backend.CPU,
    priority: TaskPriority.CRITICAL,
    queueAction: QueueAction.IMMEDIATE,
    reasonCodes: ['TEST_CANDIDATE'],
    policyVersion: 'test'
  };
}

export default function schedulerUnitTest(): void {
  describe('SchedulerService', () => {
    const service: SchedulerService = SchedulerService.getInstance();

    afterEach(async () => {
      await service.shutdown();
    });

    it('initializesAndSwitchesPolicyMode', 0, async () => {
      await service.initialize(createConfig());
      expect(service.isInitialized()).assertTrue();
      expect(service.getPolicyMode()).assertEqual(PolicyMode.ADAPTIVE);
      expect(service.getDeviceState().availableBackends[0]).assertEqual(Backend.CPU);

      await service.setPolicyMode(PolicyMode.FIXED_POWER_SAVING);
      expect(service.getPolicyMode()).assertEqual(PolicyMode.FIXED_POWER_SAVING);
    });

    it('rejectsInvalidMetricsWindow', 0, async () => {
      const config: SchedulerConfig = createConfig();
      config.metricsWindowSize = 0;

      try {
        await service.initialize(config);
        expect(false).assertTrue();
      } catch (error) {
        const schedulerError: SchedulerError = error as SchedulerError;
        expect(schedulerError.code).assertEqual(SchedulerErrorCode.INVALID_CONFIG);
      }
    });

    it('evaluatesThroughServiceAndResetsOnModeChange', 0, async () => {
      await service.initialize(createConfig(PolicyMode.FIXED_POWER_SAVING));
      const state: DeviceState = createState(90, true, ThermalLevel.NORMAL);
      const savingPlan: ExecutionPlan = service.evaluate(createProfile(), state);
      expect((savingPlan as LocalExecutionPlan).modelTier).assertEqual(ModelTier.LIGHTWEIGHT);

      await service.setPolicyMode(PolicyMode.FIXED_PERFORMANCE);
      const performancePlan: ExecutionPlan = service.evaluate(createProfile(), state);
      expect((performancePlan as LocalExecutionPlan).modelTier).assertEqual(ModelTier.HIGH_ACCURACY);
      expect((performancePlan as LocalExecutionPlan).threadCount).assertEqual(4);
    });

    it('runsTaskAndRecordsMetrics', 0, async () => {
      await service.initialize(createConfig());
      service.updateRealDeviceState({
        batteryPercent: 80,
        isCharging: true,
        thermalLevel: ThermalLevel.NORMAL
      });

      const request: TaskRequest<string> = {
        taskType: TaskType.USER_INITIATED,
        inferenceLocation: InferenceLocation.LOCAL_DEVICE,
        capability: 'mock_inference',
        input: 'shoe',
        accuracyPreference: AccuracyPreference.SPEED_FIRST,
        latencyBudgetMs: 100,
        allowDegrade: true,
        allowPause: false,
        timeoutMs: 3000
      };

      const result: TaskResult<string> = await service.runTask<string, string>(
        request,
        async (input: string, plan: ExecutionPlan): Promise<string> => {
          const localPlan: LocalExecutionPlan = plan as LocalExecutionPlan;
          return `${input}:${localPlan.modelTier}:${localPlan.threadCount}`;
        }
      );

      expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
      expect(result.output === null).assertFalse();
      expect(service.getRecentLogs(10).length >= 3).assertTrue();
      expect(service.getMetricsSnapshot().taskCount).assertEqual(1);
    });

    it('updatesRealStateAndNotifiesOnlyOnChange', 0, async () => {
      await service.initialize(createConfig());
      let callbackCount: number = 0;
      service.registerStateCallback((): void => {
        callbackCount++;
      });

      service.updateRealDeviceState({
        batteryPercent: 64,
        isCharging: false,
        thermalLevel: ThermalLevel.NORMAL,
        appVisibility: AppVisibility.BACKGROUND
      });
      service.updateRealDeviceState({ batteryPercent: 64 });

      const state: DeviceState = service.getDeviceState();
      expect(state.batteryPercent).assertEqual(64);
      expect(state.isCharging).assertFalse();
      expect(state.appVisibility).assertEqual(AppVisibility.BACKGROUND);
      expect(state.source).assertEqual(DeviceStateSource.REAL);
      expect(callbackCount).assertEqual(1);
    });

    it('overlaysAndClearsDebugState', 0, async () => {
      await service.initialize(createConfig());
      service.updateRealDeviceState({
        batteryPercent: 80,
        isCharging: true,
        thermalLevel: ThermalLevel.NORMAL
      });
      await service.injectDebugState({
        batteryPercent: 10,
        thermalLevel: ThermalLevel.HOT,
        queueDepth: 5,
        availableBackends: [Backend.CPU, Backend.NNRT]
      });

      let state: DeviceState = service.getDeviceState();
      expect(state.batteryPercent).assertEqual(10);
      expect(state.isCharging).assertTrue();
      expect(state.thermalLevel).assertEqual(ThermalLevel.HOT);
      expect(state.queueDepth).assertEqual(5);
      expect(state.availableBackends[1]).assertEqual(Backend.NNRT);
      expect(state.source).assertEqual(DeviceStateSource.MIXED);

      service.updateRealDeviceState({ batteryPercent: 70 });
      expect(service.getDeviceState().batteryPercent).assertEqual(10);
      await service.clearDebugState();
      state = service.getDeviceState();
      expect(state.batteryPercent).assertEqual(70);
      expect(state.thermalLevel).assertEqual(ThermalLevel.NORMAL);
      expect(state.source).assertEqual(DeviceStateSource.REAL);
    });

    it('rejectsDebugStateWhenDisabled', 0, async () => {
      const config: SchedulerConfig = createConfig();
      config.enableDebugInjection = false;
      await service.initialize(config);

      try {
        await service.injectDebugState({ batteryPercent: 5 });
        expect(false).assertTrue();
      } catch (error) {
        const schedulerError: SchedulerError = error as SchedulerError;
        expect(schedulerError.code).assertEqual(SchedulerErrorCode.DEBUG_INJECTION_DISABLED);
      }
    });
  });

  describe('DeviceStateController', () => {
    it('marksCompleteDebugStateAndRejectsInvalidValues', 0, () => {
      const controller: DeviceStateController = new DeviceStateController();
      controller.applyDebugState({
        batteryPercent: 25,
        isCharging: false,
        thermalLevel: ThermalLevel.WARM,
        appVisibility: AppVisibility.FOREGROUND,
        recentLatencyMs: null,
        queueDepth: 0,
        availableBackends: [Backend.CPU]
      }, 100);
      expect(controller.getSnapshot().source).assertEqual(DeviceStateSource.INJECTED);

      try {
        controller.applyRealState({ batteryPercent: 101 });
        expect(false).assertTrue();
      } catch (error) {
        const schedulerError: SchedulerError = error as SchedulerError;
        expect(schedulerError.code).assertEqual(SchedulerErrorCode.INVALID_STATE);
      }
    });
  });

  describe('SchedulerPolicy', () => {
    const policy: SchedulerPolicy = new SchedulerPolicy();

    it('selectsPerformanceForHealthyChargingState', 0, () => {
      const plan: ExecutionPlan = policy.evaluate(
        createProfile(),
        createState(80, true, ThermalLevel.NORMAL),
        PolicyMode.ADAPTIVE
      );
      expect((plan as LocalExecutionPlan).modelTier).assertEqual(ModelTier.HIGH_ACCURACY);
      expect((plan as LocalExecutionPlan).threadCount).assertEqual(4);
      expect(plan.priority).assertEqual(TaskPriority.CRITICAL);
    });

    it('pausesBackgroundWorkWhenHot', 0, () => {
      const plan: ExecutionPlan = policy.evaluate(
        createProfile(TaskType.BACKGROUND_BATCH),
        createState(80, true, ThermalLevel.HOT),
        PolicyMode.ADAPTIVE
      );
      expect((plan as LocalExecutionPlan).modelTier).assertEqual(ModelTier.LIGHTWEIGHT);
      expect((plan as LocalExecutionPlan).threadCount).assertEqual(1);
      expect(plan.queueAction).assertEqual(QueueAction.PAUSE);
    });

    it('rejectsNonDegradableWorkAtCriticalThermal', 0, () => {
      const plan: ExecutionPlan = policy.evaluate(
        createProfile(TaskType.USER_INITIATED, AccuracyPreference.QUALITY_FIRST, false),
        createState(90, true, ThermalLevel.CRITICAL),
        PolicyMode.FIXED_PERFORMANCE
      );
      expect(plan.queueAction).assertEqual(QueueAction.REJECT);
      expect((plan as LocalExecutionPlan).modelTier).assertEqual(ModelTier.LIGHTWEIGHT);
    });

    it('usesBalancedTierForUnknownState', 0, () => {
      const plan: ExecutionPlan = policy.evaluate(
        createProfile(),
        createState(null, null, ThermalLevel.UNKNOWN),
        PolicyMode.ADAPTIVE
      );
      expect((plan as LocalExecutionPlan).modelTier).assertEqual(ModelTier.BALANCED);
      expect((plan as LocalExecutionPlan).threadCount).assertEqual(2);
    });

    it('createsRemotePlanWithoutLocalHardwareFields', 0, () => {
      const remoteProfile: TaskProfile = {
        taskType: TaskType.USER_INITIATED,
        inferenceLocation: InferenceLocation.REMOTE_CLOUD,
        capability: 'cloud_answer_generation',
        accuracyPreference: AccuracyPreference.QUALITY_FIRST,
        latencyBudgetMs: 1000,
        allowDegrade: true,
        allowPause: false,
        timeoutMs: 4000,
        remoteOptions: {
          provider: 'cloud_proxy',
          maxRetries: 1,
          maxConcurrency: 2,
          allowLocalFallback: true
        }
      };
      const plan: RemoteExecutionPlan = policy.evaluate(
        remoteProfile,
        createState(5, false, ThermalLevel.CRITICAL),
        PolicyMode.ADAPTIVE
      ) as RemoteExecutionPlan;

      expect(plan.inferenceLocation).assertEqual(InferenceLocation.REMOTE_CLOUD);
      expect(plan.provider).assertEqual('cloud_proxy');
      expect(plan.timeoutMs).assertEqual(4000);
      expect(plan.maxRetries).assertEqual(1);
    });

    it('reportsCpuRuntimeEvenWhenDeviceDeclaresNpu', 0, () => {
      const state: DeviceState = createState(80, true, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];

      const plan: ExecutionPlan = policy.evaluate(
        createProfile(),
        state,
        PolicyMode.ADAPTIVE
      );

      expect((plan as LocalExecutionPlan).backend).assertEqual(Backend.CPU);
    });

    it('reportsCpuRuntimeEvenWhenDeviceDeclaresGpu', 0, () => {
      const state: DeviceState = createState(80, true, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU];

      const plan: ExecutionPlan = policy.evaluate(
        createProfile(),
        state,
        PolicyMode.ADAPTIVE
      );

      expect((plan as LocalExecutionPlan).backend).assertEqual(Backend.CPU);
    });
  });

  describe('HysteresisController', () => {
    it('degradesImmediatelyAndUpgradesAfterStableWindow', 0, () => {
      const controller: HysteresisController = new HysteresisController(1000, 500);
      controller.apply(createPlan(ModelTier.HIGH_ACCURACY), 0);

      const degraded: LocalExecutionPlan = controller.apply(createPlan(ModelTier.LIGHTWEIGHT), 100);
      expect(degraded.modelTier).assertEqual(ModelTier.LIGHTWEIGHT);

      const waiting: LocalExecutionPlan = controller.apply(createPlan(ModelTier.HIGH_ACCURACY), 200);
      expect(waiting.modelTier).assertEqual(ModelTier.LIGHTWEIGHT);

      const stillWaiting: LocalExecutionPlan = controller.apply(createPlan(ModelTier.HIGH_ACCURACY), 1100);
      expect(stillWaiting.modelTier).assertEqual(ModelTier.LIGHTWEIGHT);

      const steppedUp: LocalExecutionPlan = controller.apply(createPlan(ModelTier.HIGH_ACCURACY), 1200);
      expect(steppedUp.modelTier).assertEqual(ModelTier.BALANCED);
      expect(steppedUp.threadCount).assertEqual(2);
    });
  });
}
