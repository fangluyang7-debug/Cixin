import { afterEach, beforeEach, describe, expect, it } from '@ohos/hypium';
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
  MemoryPressure,
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
  allowPause: boolean = true,
  capability: string = 'mock_inference',
  latencyBudgetMs: number = 100
): TaskProfile {
  return {
    taskType: taskType,
    inferenceLocation: InferenceLocation.LOCAL_DEVICE,
    capability: capability,
    accuracyPreference: accuracy,
    latencyBudgetMs: latencyBudgetMs,
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
    systemCpuUsage: 18,
    appCpuUsage: 4,
    memoryPressure: MemoryPressure.NORMAL,
    totalMemoryMb: 8192,
    freeMemoryMb: 4096,
    availableMemoryMb: 2048,
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
    beforeEach(async () => { await service.shutdown(); });

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
      expect((savingPlan as LocalExecutionPlan).modelTier).assertEqual(ModelTier.BALANCED);

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

    it('doesNotHoldUserInitiatedTasksAtPreviousLowTier', 0, async () => {
      await service.initialize(createConfig());
      const lowState: DeviceState = createState(12, false, ThermalLevel.NORMAL);
      const healthyState: DeviceState = createState(90, true, ThermalLevel.NORMAL);
      healthyState.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];

      const profile: TaskProfile = createProfile(
        TaskType.USER_INITIATED,
        AccuracyPreference.QUALITY_FIRST,
        true,
        false,
        'image_product_embedding_search',
        160
      );
      const lowPlan: LocalExecutionPlan = service.evaluate(profile, lowState) as LocalExecutionPlan;
      const healthyPlan: LocalExecutionPlan = service.evaluate(profile, healthyState) as LocalExecutionPlan;

      expect(lowPlan.threadCount).assertEqual(1);
      expect(healthyPlan.threadCount).assertEqual(2);
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
    it('combinesIndependentDebugStateGroups', 0, () => {
      const controller: DeviceStateController = new DeviceStateController();
      controller.applyRealState({
        batteryPercent: 72,
        isCharging: false,
        thermalLevel: ThermalLevel.NORMAL,
        memoryPressure: MemoryPressure.NORMAL,
        availableMemoryMb: 2048
      });
      controller.applyDebugState({
        queueDepth: 1,
        recentLatencyMs: 180,
        memoryPressure: MemoryPressure.HIGH,
        availableMemoryMb: 320
      });
      controller.applyDebugState({
        batteryPercent: 12,
        isCharging: false,
        thermalLevel: ThermalLevel.NORMAL
      });

      const state: DeviceState = controller.getSnapshot();
      expect(state.batteryPercent).assertEqual(12);
      expect(state.isCharging).assertFalse();
      expect(state.thermalLevel).assertEqual(ThermalLevel.NORMAL);
      expect(state.queueDepth).assertEqual(1);
      expect(state.memoryPressure).assertEqual(MemoryPressure.HIGH);
      expect(state.availableMemoryMb).assertEqual(320);
      expect(state.source).assertEqual(DeviceStateSource.MIXED);
    });

    it('marksCompleteDebugStateAndRejectsInvalidValues', 0, () => {
      const controller: DeviceStateController = new DeviceStateController();
      controller.applyDebugState({
        batteryPercent: 25,
        isCharging: false,
        thermalLevel: ThermalLevel.WARM,
        appVisibility: AppVisibility.FOREGROUND,
        recentLatencyMs: null,
        queueDepth: 0,
        systemCpuUsage: 18,
        appCpuUsage: 4,
        memoryPressure: MemoryPressure.NORMAL,
        totalMemoryMb: 8192,
        freeMemoryMb: 4096,
        availableMemoryMb: 2048,
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

    it('keepsBackgroundIndexUsableWhenHealthy', 0, () => {
      const state: DeviceState = createState(85, true, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];

      const plan: LocalExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.BACKGROUND_BATCH,
          AccuracyPreference.SPEED_FIRST,
          true,
          false,
          'background_index_update',
          2000
        ),
        state,
        PolicyMode.ADAPTIVE
      ) as LocalExecutionPlan;

      expect(plan.modelTier).assertEqual(ModelTier.BALANCED);
      expect(plan.threadCount).assertEqual(2);
    });

    it('letsHealthyBackgroundIndexUsePerformanceModeWithoutThrottle', 0, () => {
      const state: DeviceState = createState(85, true, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];

      const plan: LocalExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.BACKGROUND_BATCH,
          AccuracyPreference.SPEED_FIRST,
          true,
          false,
          'background_index_update',
          2000
        ),
        state,
        PolicyMode.FIXED_PERFORMANCE
      ) as LocalExecutionPlan;

      expect(plan.modelTier).assertEqual(ModelTier.HIGH_ACCURACY);
      expect(plan.threadCount).assertEqual(4);
      expect(plan.queueAction).assertEqual(QueueAction.ENQUEUE);
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

    it('usesGenericBackendPreferenceWithoutCapabilityNameInference', 0, () => {
      const state: DeviceState = createState(80, true, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];

      const plan: ExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.USER_INITIATED,
          AccuracyPreference.QUALITY_FIRST,
          true,
          false,
          'image_product_embedding_search',
          160
        ),
        state,
        PolicyMode.ADAPTIVE
      );

      expect((plan as LocalExecutionPlan).backend).assertEqual(Backend.GPU);
    });

    it('selectsGpuBackendWhenAvailableAndNpuAbsent', 0, () => {
      const state: DeviceState = createState(80, true, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU];

      const plan: ExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.USER_INITIATED,
          AccuracyPreference.QUALITY_FIRST,
          true,
          false,
          'image_product_embedding_search',
          160
        ),
        state,
        PolicyMode.ADAPTIVE
      );

      expect((plan as LocalExecutionPlan).backend).assertEqual(Backend.GPU);
    });

    it('doesNotInferBusinessCostFromCapabilityNames', 0, () => {
      const state: DeviceState = createState(85, true, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];

      const imagePlan: LocalExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.USER_INITIATED,
          AccuracyPreference.QUALITY_FIRST,
          true,
          false,
          'image_product_embedding_search',
          160
        ),
        state,
        PolicyMode.ADAPTIVE
      ) as LocalExecutionPlan;
      const textPlan: LocalExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.USER_INITIATED,
          AccuracyPreference.SPEED_FIRST,
          true,
          false,
          'text_product_embedding_search',
          240
        ),
        state,
        PolicyMode.ADAPTIVE
      ) as LocalExecutionPlan;

      expect(imagePlan.modelTier).assertEqual(ModelTier.BALANCED);
      expect(imagePlan.threadCount).assertEqual(2);
      expect(imagePlan.backend).assertEqual(Backend.GPU);
      expect(textPlan.modelTier).assertEqual(ModelTier.BALANCED);
      expect(textPlan.threadCount).assertEqual(2);
      expect(textPlan.backend).assertEqual(Backend.GPU);
    });

    it('usesWeightedHotStateInsteadOfAlwaysForcingOneThread', 0, () => {
      const state: DeviceState = createState(55, false, ThermalLevel.HOT, 0, 240);
      state.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];

      const imagePlan: LocalExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.USER_INITIATED,
          AccuracyPreference.QUALITY_FIRST,
          true,
          false,
          'image_product_embedding_search',
          160
        ),
        state,
        PolicyMode.ADAPTIVE
      ) as LocalExecutionPlan;

      expect(imagePlan.modelTier).assertEqual(ModelTier.BALANCED);
      expect(imagePlan.threadCount).assertEqual(2);
      expect(imagePlan.reasonCodes.indexOf('TASK_PROFILE_GENERIC') >= 0).assertTrue();
    });

    it('usesMemoryPressureAsRuntimeConstraint', 0, () => {
      const state: DeviceState = createState(90, true, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];
      state.memoryPressure = MemoryPressure.HIGH;
      state.availableMemoryMb = 320;

      const plan: LocalExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.USER_INITIATED,
          AccuracyPreference.QUALITY_FIRST,
          true,
          false,
          'image_product_embedding_search',
          160
        ),
        state,
        PolicyMode.FIXED_PERFORMANCE
      ) as LocalExecutionPlan;

      expect(plan.modelTier).assertEqual(ModelTier.BALANCED);
      expect(plan.reasonCodes.indexOf('MEMORY_PRESSURE_BALANCED') >= 0).assertTrue();
    });

    it('evaluatesCombinedBatteryAndMemoryConditions', 0, () => {
      const imageProfile: TaskProfile = createProfile(
        TaskType.USER_INITIATED,
        AccuracyPreference.QUALITY_FIRST,
        true,
        false,
        'image_product_embedding_search',
        160
      );
      const healthyCharging: DeviceState = createState(85, true, ThermalLevel.NORMAL, 1, 180);
      healthyCharging.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];
      healthyCharging.memoryPressure = MemoryPressure.HIGH;
      healthyCharging.availableMemoryMb = 320;

      const memoryPressurePlan: LocalExecutionPlan = policy.evaluate(
        imageProfile,
        healthyCharging,
        PolicyMode.ADAPTIVE
      ) as LocalExecutionPlan;
      expect(memoryPressurePlan.modelTier).assertEqual(ModelTier.BALANCED);
      expect(memoryPressurePlan.threadCount).assertEqual(2);

      healthyCharging.batteryPercent = 12;
      healthyCharging.isCharging = false;
      const combinedProtectionPlan: LocalExecutionPlan = policy.evaluate(
        imageProfile,
        healthyCharging,
        PolicyMode.ADAPTIVE
      ) as LocalExecutionPlan;
      expect(combinedProtectionPlan.modelTier).assertEqual(ModelTier.LIGHTWEIGHT);
      expect(combinedProtectionPlan.threadCount).assertEqual(1);
      expect(combinedProtectionPlan.reasonCodes.indexOf('LOW_BATTERY_PROTECTION') >= 0).assertTrue();
    });

    it('treatsFixedPowerSavingAsBiasNotAbsoluteLock', 0, () => {
      const state: DeviceState = createState(90, true, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];

      const plan: LocalExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.USER_INITIATED,
          AccuracyPreference.QUALITY_FIRST,
          true,
          false,
          'image_product_embedding_search',
          160
        ),
        state,
        PolicyMode.FIXED_POWER_SAVING
      ) as LocalExecutionPlan;

      expect(plan.modelTier).assertEqual(ModelTier.BALANCED);
      expect(plan.reasonCodes.indexOf('FIXED_POWER_SAVING_BIAS_APPLIED') >= 0).assertTrue();
    });

    it('keepsTextSearchResponsiveInHealthyPowerSavingMode', 0, () => {
      const state: DeviceState = createState(85, false, ThermalLevel.NORMAL);
      state.availableBackends = [Backend.CPU, Backend.GPU, Backend.NPU];

      const plan: LocalExecutionPlan = policy.evaluate(
        createProfile(
          TaskType.USER_INITIATED,
          AccuracyPreference.SPEED_FIRST,
          true,
          false,
          'text_product_embedding_search',
          240
        ),
        state,
        PolicyMode.FIXED_POWER_SAVING
      ) as LocalExecutionPlan;

      expect(plan.modelTier).assertEqual(ModelTier.BALANCED);
      expect(plan.threadCount).assertEqual(2);
      expect(plan.reasonCodes.indexOf('FIXED_POWER_SAVING_BIAS_APPLIED') >= 0).assertTrue();
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

    it('keepsTierMemorySeparateByCapabilityKey', 0, () => {
      const controller: HysteresisController = new HysteresisController(1000, 500);
      controller.apply(createPlan(ModelTier.LIGHTWEIGHT), 0, 'background_index_update');
      const imagePlan: LocalExecutionPlan = controller.apply(
        createPlan(ModelTier.HIGH_ACCURACY),
        100,
        'image_product_embedding_search'
      );

      expect(imagePlan.modelTier).assertEqual(ModelTier.HIGH_ACCURACY);
      expect(imagePlan.threadCount).assertEqual(4);
      expect(controller.getCurrentTier('background_index_update')).assertEqual(ModelTier.LIGHTWEIGHT);
      expect(controller.getCurrentTier('image_product_embedding_search')).assertEqual(ModelTier.HIGH_ACCURACY);
    });
  });
}
