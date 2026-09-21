import { afterEach, beforeEach, describe, expect, it } from '@ohos/hypium';
import {
  AccuracyPreference, CancellationSignal, ExecutionPlan, ExecutorResult,
  InferenceLocation, LocalExecutionPlan, ModelTier, PolicyMode, SchedulerConfig,
  SchedulerError, SchedulerErrorCode, SchedulerService, TaskRequest, TaskStatus, TaskType,
  ThermalLevel, WorkloadExecutor, MemoryPressure
} from '../../Index';

class Gate {
  readonly promise: Promise<void>;
  private release: (() => void) | null = null;
  constructor() {
    this.promise = new Promise<void>((resolve) => { this.release = resolve; });
  }
  open(): void {
    if (this.release !== null) { this.release(); }
  }
}

class ControlledExecutor implements WorkloadExecutor<string, string> {
  readonly capability: string = 'controlled';
  readonly inferenceLocation: InferenceLocation = InferenceLocation.LOCAL_DEVICE;
  readonly started: Gate = new Gate();
  readonly stopped: Gate = new Gate();
  readonly release: Gate = new Gate();
  readonly warming: Gate = new Gate();
  readonly warmRelease: Gate = new Gate();
  holdWarmup: boolean = false;
  onlyFourThreads: boolean = false;
  calls: number = 0;
  throwTimeoutAfterRelease: boolean = false;
  supports(plan: ExecutionPlan): boolean {
    return plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE &&
      (!this.onlyFourThreads || (plan as LocalExecutionPlan).threadCount === 4);
  }
  async warmup(_plan: ExecutionPlan): Promise<void> {
    this.warming.open();
    if (this.holdWarmup) { await this.warmRelease.promise; }
  }
  async execute(_input: string, plan: ExecutionPlan, signal: CancellationSignal): Promise<ExecutorResult<string>> {
    this.calls++;
    this.started.open();
    const unsubscribe = signal.onCancelled(() => this.stopped.open());
    // Deliberately non-interruptible work: cancellation does not resolve release.
    await this.release.promise;
    unsubscribe();
    if (this.throwTimeoutAfterRelease) { throw new SchedulerError(SchedulerErrorCode.TASK_TIMEOUT, 'Late executor timeout.'); }
    return { output: `${(plan as LocalExecutionPlan).threadCount}` };
  }
  async dispose(): Promise<void> {}
}

function config(): SchedulerConfig {
  return {
    defaultPolicyMode: PolicyMode.FIXED_PERFORMANCE, enableDebugInjection: true,
    metricsWindowSize: 100, upgradeStableDurationMs: 0, minimumTierHoldMs: 0, executors: []
  };
}
function request(id: string, background: boolean = false): TaskRequest<string> {
  return {
    taskId: id, capability: 'controlled', input: id,
    inferenceLocation: InferenceLocation.LOCAL_DEVICE,
    taskType: background ? TaskType.BACKGROUND_BATCH : TaskType.USER_INITIATED,
    accuracyPreference: AccuracyPreference.QUALITY_FIRST,
    allowDegrade: true, allowPause: true, timeoutMs: 1000
  };
}

async function initialize(service: SchedulerService): Promise<void> {
  await service.initialize(config());
  service.updateRealDeviceState({ batteryPercent: 80, isCharging: true, thermalLevel: ThermalLevel.NORMAL,
    memoryPressure: MemoryPressure.NORMAL, availableMemoryMb: 2048 });
}

export default function executionSafetyUnitTest(): void {
  describe('ExecutionSafety', () => {
    const service = SchedulerService.getInstance();
    let executor: ControlledExecutor = new ControlledExecutor();
    beforeEach(async () => {
      executor.release.open();
      executor.warmRelease.open();
      await service.shutdown();
    });
    afterEach(async () => {
      executor.release.open();
      executor.warmRelease.open();
      await service.shutdown();
    });

    it('executesRefreshedPlanInsteadOfCapturedSubmissionPlan', 0, async () => {
      await initialize(service);
      executor = new ControlledExecutor();
      executor.release.open();
      service.registerExecutor(executor);
      await service.pause();
      const handle = await service.submitTask<string, string>(request('refreshed'));
      expect((service.getRecentLogs(1)[0].executionPlan as LocalExecutionPlan).threadCount).assertEqual(4);
      service.updateRealDeviceState({ batteryPercent: 10, isCharging: false, thermalLevel: ThermalLevel.HOT });
      await service.resume();
      const result = await handle.result;
      // Combined low battery and HOT state require one thread, not the submitted four-thread plan.
      expect(result.output).assertEqual('1');
      expect((result.executionPlan as LocalExecutionPlan).threadCount).assertEqual(1);
    });

    it('rejectsQueuedNonDegradableTaskAfterThermalChange', 0, async () => {
      await initialize(service);
      executor = new ControlledExecutor();
      service.registerExecutor(executor);
      await service.pause();
      const input = request('thermal-reject');
      input.allowDegrade = false;
      const handle = await service.submitTask<string, string>(input);
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.CRITICAL });
      expect(handle.getStatus()).assertEqual(TaskStatus.FAILED);
      await service.resume();
      const result = await handle.result;
      expect(result.errorCode).assertEqual(SchedulerErrorCode.THERMAL_PROTECTION);
      expect(result.status).assertEqual(TaskStatus.FAILED);
      expect(executor.calls).assertEqual(0);
    });

    it('automaticallyResumesPolicyPausedTaskAfterRecovery', 0, async () => {
      await initialize(service);
      await service.setPolicyMode(PolicyMode.ADAPTIVE);
      executor = new ControlledExecutor();
      executor.release.open();
      service.registerExecutor(executor);
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.HOT });
      const handle = await service.submitTask<string, string>(request('recovery', true));
      expect(handle.getStatus()).assertEqual(TaskStatus.QUEUED);
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.NORMAL });
      const result = await handle.result;
      expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
      expect(result.output).assertEqual(`${(result.executionPlan as LocalExecutionPlan).threadCount}`);
    });

    it('keepsManualPauseAcrossStateUpdates', 0, async () => {
      await initialize(service);
      executor = new ControlledExecutor();
      executor.release.open();
      service.registerExecutor(executor);
      await service.pause();
      const handle = await service.submitTask<string, string>(request('manual', true));
      await service.pauseBackgroundTasks();
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.NORMAL });
      await service.resume();
      expect(handle.getStatus()).assertEqual(TaskStatus.QUEUED);
      expect(await service.resumeBackgroundTasks()).assertEqual(1);
      expect((await handle.result).status).assertEqual(TaskStatus.SUCCEEDED);
    });

    it('rechecksExecutorSupportAfterPlanChange', 0, async () => {
      await initialize(service);
      executor = new ControlledExecutor();
      executor.onlyFourThreads = true;
      service.registerExecutor(executor);
      await service.pause();
      const handle = await service.submitTask<string, string>(request('unsupported'));
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.HOT });
      await service.resume();
      expect((await handle.result).errorCode).assertEqual(SchedulerErrorCode.CAPABILITY_UNAVAILABLE);
      expect(executor.calls).assertEqual(0);
    });

    it('holdsSlotAfterTimeoutUntilActualExecutorSettlement', 0, async () => {
      await initialize(service);
      executor = new ControlledExecutor();
      service.registerExecutor(executor);
      const firstRequest = request('timeout-first');
      firstRequest.timeoutMs = 15;
      const first = await service.submitTask<string, string>(firstRequest);
      await executor.started.promise;
      const second = await service.submitTask<string, string>(request('timeout-second'));
      await executor.stopped.promise;
      expect(first.getStatus()).assertEqual(TaskStatus.STOP_REQUESTED);
      expect(second.getStatus()).assertEqual(TaskStatus.QUEUED);
      expect(executor.calls).assertEqual(1);
      executor.release.open();
      const result = await first.result;
      expect(result.status).assertEqual(TaskStatus.TIMED_OUT);
      expect(result.output === null).assertTrue();
      expect(result.errorCode).assertEqual(SchedulerErrorCode.TASK_TIMEOUT);
      expect((await second.result).status).assertEqual(TaskStatus.SUCCEEDED);
      expect(service.getMetricsSnapshot().p95LatencyMs >= result.totalDurationMs).assertTrue();
    });

    it('selectsAnotherRegisteredExecutorAfterQueuedPlanChanges', 0, async () => {
      await initialize(service);
      const alternative = new ControlledExecutor();
      alternative.release.open();
      service.registerExecutor(alternative);
      executor = new ControlledExecutor();
      executor.onlyFourThreads = true;
      service.registerExecutor(executor);
      await service.pause();
      const handle = await service.submitTask<string, string>(request('switch-executor'));
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.HOT });
      expect(handle.getStatus()).assertEqual(TaskStatus.QUEUED);
      await service.resume();
      const result = await handle.result;
      expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
      expect(result.output).assertEqual('2');
      expect(executor.calls).assertEqual(0);
      expect(alternative.calls).assertEqual(1);
    });

    it('holdsSlotOnUserCancelAndDiscardsLateResult', 0, async () => {
      await initialize(service);
      executor = new ControlledExecutor();
      service.registerExecutor(executor);
      const first = await service.submitTask<string, string>(request('cancel-first'));
      await executor.started.promise;
      const second = await service.submitTask<string, string>(request('cancel-second'));
      expect(await first.cancel()).assertTrue();
      expect(await first.cancel()).assertFalse();
      expect(first.getStatus()).assertEqual(TaskStatus.STOP_REQUESTED);
      expect(executor.calls).assertEqual(1);
      executor.release.open();
      const result = await first.result;
      expect(result.status).assertEqual(TaskStatus.CANCELLED);
      expect(result.output === null).assertTrue();
      expect((await second.result).status).assertEqual(TaskStatus.SUCCEEDED);
    });

    it('doesNotStartInferenceWhenCancelledDuringWarmup', 0, async () => {
      await initialize(service);
      executor = new ControlledExecutor();
      executor.holdWarmup = true;
      service.registerExecutor(executor);
      const handle = await service.submitTask<string, string>(request('warmup'));
      await executor.warming.promise;
      await handle.cancel();
      executor.warmRelease.open();
      expect((await handle.result).status).assertEqual(TaskStatus.CANCELLED);
      expect(executor.calls).assertEqual(0);
    });

    it('keepsFirstStopReasonWhenExecutorLaterThrowsTimeout', 0, async () => {
      await initialize(service);
      executor = new ControlledExecutor();
      executor.throwTimeoutAfterRelease = true;
      service.registerExecutor(executor);
      const handle = await service.submitTask<string, string>(request('first-stop-wins'));
      await executor.started.promise;
      await handle.cancel();
      executor.release.open();
      const result = await handle.result;
      expect(result.status).assertEqual(TaskStatus.CANCELLED);
      expect(result.errorCode).assertEqual(SchedulerErrorCode.TASK_CANCELLED);
      expect(result.stopRequestedAt !== undefined).assertTrue();
    });

    it('exposesExpiryStopWhileNonInterruptibleWorkStillOccupiesSlot', 0, async () => {
      await initialize(service);
      executor = new ControlledExecutor();
      service.registerExecutor(executor);
      const input = request('expiry-stop');
      input.context = { userVisible: true, userWaiting: true, accuracyFloor: ModelTier.LIGHTWEIGHT,
        freshnessMs: 100 };
      const first = await service.submitTask<string, string>(input);
      await executor.started.promise;
      const second = await service.submitTask<string, string>(request('after-expiry'));
      await executor.stopped.promise;
      expect(first.getStatus()).assertEqual(TaskStatus.STOP_REQUESTED);
      expect(second.getStatus()).assertEqual(TaskStatus.QUEUED);
      expect(service.getMetricsSnapshot().runningCount).assertEqual(1);
      const stopLogs = service.getRecentLogs(20).filter((entry) => entry.status === TaskStatus.STOP_REQUESTED);
      expect(stopLogs.length).assertEqual(1);
      expect(stopLogs[0].stopRequestedAt !== undefined).assertTrue();
      executor.release.open();
      const result = await first.result;
      expect(result.errorCode).assertEqual(SchedulerErrorCode.RESULT_EXPIRED);
      expect(result.output === null).assertTrue();
      expect((await second.result).status).assertEqual(TaskStatus.SUCCEEDED);
    });

    it('passesCancellationSignalToFunctionExecutor', 0, async () => {
      await initialize(service);
      const started = new Gate();
      const resultPromise = service.runTask<string, string>(request('callback-signal'),
        async (_input: string, _plan: ExecutionPlan, signal: CancellationSignal): Promise<string> => {
          const stopped = new Gate();
          const unsubscribe = signal.onCancelled(() => stopped.open());
          started.open();
          await stopped.promise;
          unsubscribe();
          return 'late';
        });
      await started.promise;
      await service.cancelTask('callback-signal');
      expect((await resultPromise).status).assertEqual(TaskStatus.CANCELLED);
    });
  });
}
