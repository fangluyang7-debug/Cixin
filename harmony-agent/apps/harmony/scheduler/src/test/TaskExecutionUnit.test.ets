import { afterEach, beforeEach, describe, expect, it } from '@ohos/hypium';
import {
  AccuracyPreference,
  InferenceLocation,
  MockWorkloadExecutor,
  MockWorkloadInput,
  MockWorkloadOutput,
  PolicyMode,
  RemoteExecutionPlan,
  SchedulerConfig,
  SchedulerError,
  SchedulerErrorCode,
  SchedulerService,
  TaskHandle,
  TaskRequest,
  TaskResult,
  TaskStatus,
  TaskType
} from '../../Index';

function createConfig(): SchedulerConfig {
  return {
    defaultPolicyMode: PolicyMode.ADAPTIVE,
    enableDebugInjection: true,
    metricsWindowSize: 100,
    upgradeStableDurationMs: 10000,
    minimumTierHoldMs: 5000,
    executors: []
  };
}

function createRequest(
  taskId: string,
  taskType: TaskType,
  durationMs: number,
  timeoutMs: number = 1000,
  allowPause: boolean = true
): TaskRequest<MockWorkloadInput> {
  return {
    taskId: taskId,
    taskType: taskType,
    inferenceLocation: InferenceLocation.LOCAL_DEVICE,
    capability: 'mock_workload',
    input: {
      durationMs: durationMs,
      value: taskId
    },
    accuracyPreference: AccuracyPreference.BALANCED,
    latencyBudgetMs: 200,
    allowDegrade: true,
    allowPause: allowPause,
    timeoutMs: timeoutMs
  };
}

function sleep(durationMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), durationMs);
  });
}

export default function taskExecutionUnitTest(): void {
  describe('TaskExecutionPipeline', () => {
    const service: SchedulerService = SchedulerService.getInstance();
    beforeEach(async () => { await service.shutdown(); });

    afterEach(async () => {
      await service.shutdown();
    });

    it('submitsTaskThroughRegisteredExecutor', 0, async () => {
      await service.initialize(createConfig());
      service.registerExecutor(new MockWorkloadExecutor());

      const handle: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('registered-success', TaskType.USER_INITIATED, 5, 5000)
      );
      const result: TaskResult<MockWorkloadOutput> = await handle.result;

      expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
      expect(result.output === null).assertFalse();
      expect((result.output as MockWorkloadOutput).value).assertEqual('registered-success');
      expect(service.getMetricsSnapshot().taskCount).assertEqual(1);
      expect(service.getRecentLogs(10).length).assertEqual(3);
    });

    it('routesRemoteTaskWithCloudOnlyPlan', 0, async () => {
      await service.initialize(createConfig());
      const request: TaskRequest<string> = {
        taskId: 'remote-plan',
        taskType: TaskType.USER_INITIATED,
        inferenceLocation: InferenceLocation.REMOTE_CLOUD,
        capability: 'cloud_answer_generation',
        input: 'recommend a laptop',
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
      const result: TaskResult<string> = await service.runTask<string, string>(
        request,
        async (input: string): Promise<string> => input
      );
      const remotePlan: RemoteExecutionPlan = result.executionPlan as RemoteExecutionPlan;

      expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
      expect(remotePlan.inferenceLocation).assertEqual(InferenceLocation.REMOTE_CLOUD);
      expect(remotePlan.provider).assertEqual('cloud_proxy');
      expect(remotePlan.maxConcurrency).assertEqual(2);
    });

    it('rejectsRemoteTaskWhenOnlyLocalExecutorIsRegistered', 0, async () => {
      await service.initialize(createConfig());
      service.registerExecutor(new MockWorkloadExecutor('shared_capability'));
      const request: TaskRequest<string> = {
        taskId: 'remote-mismatch',
        taskType: TaskType.USER_INITIATED,
        inferenceLocation: InferenceLocation.REMOTE_CLOUD,
        capability: 'shared_capability',
        input: 'remote',
        accuracyPreference: AccuracyPreference.BALANCED,
        allowDegrade: true,
        allowPause: false,
        timeoutMs: 1000,
        remoteOptions: {
          provider: 'cloud_proxy',
          maxRetries: 0,
          maxConcurrency: 1,
          allowLocalFallback: false
        }
      };

      try {
        await service.submitTask<string, string>(request);
        expect(false).assertTrue();
      } catch (error) {
        const schedulerError: SchedulerError = error as SchedulerError;
        expect(schedulerError.code).assertEqual(SchedulerErrorCode.CAPABILITY_UNAVAILABLE);
      }
    });

    it('executesHigherPriorityQueuedTaskFirst', 0, async () => {
      await service.initialize(createConfig());
      service.registerExecutor(new MockWorkloadExecutor());

      const blocker: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('blocker', TaskType.USER_INITIATED, 40)
      );
      const low: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('low-background', TaskType.BACKGROUND_BATCH, 1)
      );
      const high: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('high-foreground', TaskType.FOREGROUND_REALTIME, 1)
      );

      const completionOrder: string[] = [];
      high.result.then(() => completionOrder.push('high'));
      low.result.then(() => completionOrder.push('low'));
      await blocker.result;
      await Promise.all([high.result, low.result]);

      expect(completionOrder[0]).assertEqual('high');
      expect(completionOrder[1]).assertEqual('low');
    });

    it('cancelsQueuedTask', 0, async () => {
      await service.initialize(createConfig());
      service.registerExecutor(new MockWorkloadExecutor());

      const blocker: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('cancel-blocker', TaskType.USER_INITIATED, 40)
      );
      const queued: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('cancel-target', TaskType.BACKGROUND_BATCH, 20)
      );

      expect(await queued.cancel()).assertTrue();
      const cancelled: TaskResult<MockWorkloadOutput> = await queued.result;
      expect(cancelled.status).assertEqual(TaskStatus.CANCELLED);
      expect(cancelled.errorCode).assertEqual(SchedulerErrorCode.TASK_CANCELLED);
      await blocker.result;
    });

    it('timesOutRunningTask', 0, async () => {
      await service.initialize(createConfig());
      service.registerExecutor(new MockWorkloadExecutor());

      const handle: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('timeout-target', TaskType.USER_INITIATED, 80, 5)
      );
      const result: TaskResult<MockWorkloadOutput> = await handle.result;

      expect(result.status).assertEqual(TaskStatus.TIMED_OUT);
      expect(result.errorCode).assertEqual(SchedulerErrorCode.TASK_TIMEOUT);
    });

    it('pausesAndResumesQueuedBackgroundTask', 0, async () => {
      await service.initialize(createConfig());
      service.registerExecutor(new MockWorkloadExecutor());

      const blocker: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('pause-blocker', TaskType.USER_INITIATED, 40)
      );
      const background: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('paused-background', TaskType.BACKGROUND_BATCH, 1)
      );

      expect(await service.pauseBackgroundTasks('UNIT_TEST')).assertEqual(1);
      await blocker.result;
      await sleep(10);
      expect(background.getStatus()).assertEqual(TaskStatus.QUEUED);
      expect(await service.resumeBackgroundTasks()).assertEqual(1);

      const result: TaskResult<MockWorkloadOutput> = await background.result;
      expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
    });

    it('pausesAndResumesSchedulerDrain', 0, async () => {
      await service.initialize(createConfig());
      service.registerExecutor(new MockWorkloadExecutor());
      await service.pause();

      const handle: TaskHandle<MockWorkloadOutput> = await service.submitTask(
        createRequest('scheduler-paused', TaskType.USER_INITIATED, 1)
      );

      await sleep(10);
      expect(service.isPaused()).assertTrue();
      expect(service.getTaskStatus('scheduler-paused')).assertEqual(TaskStatus.QUEUED);

      await service.resume();
      const result: TaskResult<MockWorkloadOutput> = await handle.result;
      expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
      expect(service.getTaskStatus('scheduler-paused')).assertEqual(TaskStatus.SUCCEEDED);
    });

    it('rejectsTaskWithoutRegisteredExecutor', 0, async () => {
      await service.initialize(createConfig());
      try {
        await service.submitTask<MockWorkloadInput, MockWorkloadOutput>(
          createRequest('missing-executor', TaskType.USER_INITIATED, 1)
        );
        expect(false).assertTrue();
      } catch (error) {
        const schedulerError: SchedulerError = error as SchedulerError;
        expect(schedulerError.code).assertEqual(SchedulerErrorCode.CAPABILITY_UNAVAILABLE);
      }
    });
  });
}
