import { afterEach, beforeEach, describe, expect, it } from '@ohos/hypium';
import {
  Backend, CancellationSignal, DependencyFailurePolicy, DuplicatePolicy, ExecutionPlan, ExecutorResult,
  InferenceLocation, Interruptibility, LocalExecutionPlan, MemoryPressure, ModelTier, PolicyMode,
  PrivacyPolicy, QualityLevel, SchedulerClient, SchedulerService, TaskCheckpoint, TaskContext, TaskSignalType,
  TaskStatus, TaskTemplate, TaskType, ThermalLevel, WorkflowHandle, WorkflowInput, WorkloadExecutor
} from '../../Index';

function sleep(ms: number): Promise<void> { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

function template(capability: string = 'generic'): TaskTemplate {
  return {
    capability: capability, taskType: TaskType.USER_INITIATED, inferenceLocation: InferenceLocation.LOCAL_DEVICE,
    qualityLevels: [ModelTier.HIGH_ACCURACY, ModelTier.BALANCED, ModelTier.LIGHTWEIGHT].map((tier: ModelTier): QualityLevel => ({
      id: tier, modelTier: tier, estimatedLatencyMs: 1, estimatedMemoryMb: 8, relativeEnergyCost: 1,
      supportedBackends: [Backend.CPU], supportedThreadCounts: [1, 2, 4]
    })),
    interruptibility: Interruptibility.CANCEL_RESTART, duplicatePolicy: DuplicatePolicy.KEEP_ALL,
    privacyPolicy: PrivacyPolicy.LOCAL_ONLY, resourceHints: { modelVersion: 'test-v1' }, timeoutMs: 2000
  };
}

function context(): TaskContext {
  return { userVisible: true, userWaiting: true, accuracyFloor: ModelTier.LIGHTWEIGHT,
    deadlineMs: 2000, freshnessMs: 2500, deduplicationKey: 'same-page' };
}

class ProbeExecutor implements WorkloadExecutor<Object, Object> {
  public readonly capability: string;
  public inferenceLocation: InferenceLocation = InferenceLocation.LOCAL_DEVICE;
  public delayMs: number = 2;
  public chunkCount: number = 1;
  public calls: number = 0;
  public cursors: number[] = [];
  public plans: ExecutionPlan[] = [];
  public events: string[] = [];
  public prefix: string = '';
  public fail: boolean = false;
  constructor(capability: string = 'generic') { this.capability = capability; }
  public supports(plan: ExecutionPlan): boolean { return plan.inferenceLocation === this.inferenceLocation; }
  public async execute(input: Object, plan: ExecutionPlan, _signal: CancellationSignal,
    checkpoint?: TaskCheckpoint): Promise<ExecutorResult<Object>> {
    this.calls++;
    this.events.push(`${this.capability}:start`);
    this.plans.push(plan);
    const cursor: number = checkpoint?.cursor ?? 0;
    this.cursors.push(cursor);
    await sleep(this.delayMs);
    this.events.push(`${this.capability}:end`);
    if (this.fail) { throw new Error('Deliberate test failure.'); }
    return { output: this.prefix.length > 0 ? this.prefix : input,
      completed: cursor + 1 >= this.chunkCount, checkpoint: { cursor: cursor + 1 },
      telemetry: { modelVersion: 'test-v1', actualBackend: Backend.CPU,
        actualThreads: plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE ? (plan as LocalExecutionPlan).threadCount : 1 } };
  }
  public async dispose(): Promise<void> {}
}

export default function semanticSchedulerTest(): void {
  describe('SemanticSchedulerContracts', () => {
    let service: SchedulerService = new SchedulerService();
    let client: SchedulerClient = new SchedulerClient(service);
    beforeEach(async () => {
      service = new SchedulerService();
      await service.initialize({ defaultPolicyMode: PolicyMode.ADAPTIVE, enableDebugInjection: true,
        metricsWindowSize: 100, upgradeStableDurationMs: 100, minimumTierHoldMs: 100, executors: [] });
      service.updateRealDeviceState({ batteryPercent: 80, isCharging: true, thermalLevel: ThermalLevel.NORMAL,
        memoryPressure: MemoryPressure.NORMAL, availableMemoryMb: 2048, systemCpuUsage: 0 });
      client = new SchedulerClient(service);
    });
    afterEach(async () => { await client.dispose(); await service.shutdown(); });

    it('holdsSemanticUpgradeButNeverViolatesAnExplicitQualityFloor', 0, async () => {
      client.registerTemplate(template());
      const executor = new ProbeExecutor(); client.registerExecutor(executor);
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.HOT });
      await client.submit<string, string>('generic', 'low', context()).result;
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.NORMAL });
      const held = await client.submit<string, string>('generic', 'recovering', context()).result;
      expect((held.nodes[0].executionPlan as LocalExecutionPlan).modelTier).assertEqual(ModelTier.LIGHTWEIGHT);
      expect(held.nodes[0].executionPlan.reasonCodes.indexOf('SEMANTIC_UPGRADE_STABILITY_WAIT') >= 0).assertTrue();
      const strict = context(); strict.highQuality = true;
      const upgraded = await client.submit<string, string>('generic', 'quality', strict).result;
      expect(upgraded.status).assertEqual(TaskStatus.SUCCEEDED);
      expect((upgraded.nodes[0].executionPlan as LocalExecutionPlan).modelTier).assertEqual(ModelTier.HIGH_ACCURACY);
    });

    it('semanticHoldKeepsDeclaredThreadCountsAndPredictionMetadata', 0, async () => {
      const declared = template();
      declared.qualityLevels.forEach((level: QualityLevel) => { level.supportedThreadCounts = [1]; });
      client.registerTemplate(declared);
      const executor = new ProbeExecutor(); client.registerExecutor(executor);
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.HOT });
      await client.submit<string, string>('generic', 'low', context()).result;
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.NORMAL });
      const result = await client.submit<string, string>('generic', 'recovering', context()).result;
      const plan = result.nodes[0].executionPlan as LocalExecutionPlan;
      expect(plan.threadCount).assertEqual(1);
      expect(plan.prediction !== undefined).assertTrue();
      expect(plan.qualityLevelId).assertEqual(ModelTier.LIGHTWEIGHT);
    });

    it('registersImmutableTemplateAndDeliversOpaqueInput', 0, async () => {
      const declared: TaskTemplate = template();
      client.registerTemplate(declared);
      declared.capability = 'mutated';
      declared.qualityLevels[0].supportedBackends = [Backend.NPU];
      const executor: ProbeExecutor = new ProbeExecutor();
      client.registerExecutor(executor);
      const result = await client.submit<string, string>('generic', 'private-payload', context()).result;
      expect(result.output).assertEqual('private-payload');
      expect(client.exportAudit().indexOf('private-payload') < 0).assertTrue();
      expect((executor.plans[0] as LocalExecutionPlan).backend).assertEqual(Backend.CPU);
    });

    it('isolatesExecutorNamespacesAcrossClients', 0, async () => {
      const other: SchedulerClient = new SchedulerClient(service);
      client.registerTemplate(template()); other.registerTemplate(template());
      const first: ProbeExecutor = new ProbeExecutor(); first.prefix = 'first';
      const second: ProbeExecutor = new ProbeExecutor(); second.prefix = 'second';
      client.registerExecutor(first); other.registerExecutor(second);
      expect((await client.submit<string, string>('generic', 'input', context()).result).output).assertEqual('first');
      expect((await other.submit<string, string>('generic', 'input', context()).result).output).assertEqual('second');
      await other.dispose();
    });

    it('reevaluatesQueuedPlanBeforeExecutorStarts', 0, async () => {
      client.registerTemplate(template()); const executor: ProbeExecutor = new ProbeExecutor(); client.registerExecutor(executor);
      await service.pause();
      const handle = client.submit<string, string>('generic', 'input', context());
      await service.injectDebugState({ thermalLevel: ThermalLevel.HOT });
      await service.resume();
      const result = await handle.result;
      expect((executor.plans[0] as LocalExecutionPlan).modelTier).assertEqual(ModelTier.LIGHTWEIGHT);
      expect(result.nodes[0].executionPlan.qualityLevelId).assertEqual(ModelTier.LIGHTWEIGHT);
    });

    it('rejectsQualityFloorConflictBeforeExecuting', 0, async () => {
      client.registerTemplate(template()); const executor: ProbeExecutor = new ProbeExecutor(); client.registerExecutor(executor);
      await service.injectDebugState({ batteryPercent: 10, isCharging: false });
      const strict: TaskContext = context(); strict.accuracyFloor = ModelTier.HIGH_ACCURACY;
      const result = await client.submit<string, string>('generic', 'input', strict).result;
      expect(result.status).assertEqual(TaskStatus.FAILED);
      expect(executor.calls).assertEqual(0);
      expect(result.nodes[0].executionPlan.reasonCodes.indexOf('NO_FEASIBLE_QUALITY_PLAN') >= 0).assertTrue();
    });

    it('enforcesLocalOnlyPrivacyAgainstRemoteExecutor', 0, async () => {
      const remote: TaskTemplate = template(); remote.inferenceLocation = InferenceLocation.REMOTE_CLOUD;
      remote.remoteOptions = { provider: 'test', maxRetries: 0, maxConcurrency: 1, allowLocalFallback: false };
      client.registerTemplate(remote);
      const executor: ProbeExecutor = new ProbeExecutor(); executor.inferenceLocation = InferenceLocation.REMOTE_CLOUD;
      client.registerExecutor(executor);
      const allowed: TaskContext = context(); allowed.networkAllowed = true;
      const result = await client.submit<string, string>('generic', 'sensitive', allowed).result;
      expect(executor.calls).assertEqual(0);
      expect(result.nodes[0].executionPlan.reasonCodes.indexOf('PRIVACY_CONSTRAINT') >= 0).assertTrue();
    });

    it('cloudQualityDoesNotRequireKnownLocalComputeState', 0, async () => {
      const remote: TaskTemplate = template();
      remote.inferenceLocation = InferenceLocation.REMOTE_CLOUD;
      remote.privacyPolicy = PrivacyPolicy.REMOTE_ALLOWED;
      remote.qualityLevels = [remote.qualityLevels[0]];
      remote.remoteOptions = { provider: 'test', maxRetries: 0, maxConcurrency: 1, allowLocalFallback: false };
      client.registerTemplate(remote);
      const executor = new ProbeExecutor();
      executor.inferenceLocation = InferenceLocation.REMOTE_CLOUD;
      client.registerExecutor(executor);
      const allowed = context();
      allowed.networkAllowed = true;
      allowed.highQuality = true;
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.UNKNOWN, batteryPercent: null });
      expect((await client.submit<string, string>('generic', 'unknown', allowed).result).status).assertEqual(TaskStatus.SUCCEEDED);
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.HOT, batteryPercent: 10, isCharging: false });
      expect((await client.submit<string, string>('generic', 'constrained', allowed).result).status).assertEqual(TaskStatus.SUCCEEDED);
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.CRITICAL });
      expect((await client.submit<string, string>('generic', 'critical', allowed).result).status).assertEqual(TaskStatus.FAILED);
      expect(executor.calls).assertEqual(2);
    });

    it('requiresNetworkConsentAndSanitizedInput', 0, async () => {
      const remote: TaskTemplate = template(); remote.inferenceLocation = InferenceLocation.REMOTE_CLOUD;
      remote.privacyPolicy = PrivacyPolicy.SANITIZED_REMOTE;
      remote.remoteOptions = { provider: 'test', maxRetries: 0, maxConcurrency: 1, allowLocalFallback: false };
      client.registerTemplate(remote);
      const executor: ProbeExecutor = new ProbeExecutor(); executor.inferenceLocation = InferenceLocation.REMOTE_CLOUD;
      client.registerExecutor(executor);
      const constraint: TaskContext = context(); constraint.inputSanitized = true;
      expect((await client.submit<string, string>('generic', 'input', constraint).result).status).assertEqual(TaskStatus.FAILED);
      constraint.networkAllowed = true; constraint.inputSanitized = false;
      expect((await client.submit<string, string>('generic', 'input', constraint).result).status).assertEqual(TaskStatus.FAILED);
      constraint.inputSanitized = true;
      expect((await client.submit<string, string>('generic', 'input', constraint).result).status).assertEqual(TaskStatus.SUCCEEDED);
      expect(executor.calls).assertEqual(1);
    });

    it('keepsOnlyLatestQueuedInput', 0, async () => {
      const latest: TaskTemplate = template(); latest.duplicatePolicy = DuplicatePolicy.KEEP_LATEST;
      client.registerTemplate(latest); const executor: ProbeExecutor = new ProbeExecutor(); client.registerExecutor(executor);
      await service.pause();
      const first = client.submit<string, string>('generic', 'old', context());
      const second = client.submit<string, string>('generic', 'new', context());
      await service.resume();
      expect((await first.result).status).assertEqual(TaskStatus.CANCELLED);
      expect((await second.result).output).assertEqual('new');
      expect(executor.calls).assertEqual(1);
    });

    it('discardsReplacedRunningResultWithoutOverlappingExecution', 0, async () => {
      const latest: TaskTemplate = template(); latest.duplicatePolicy = DuplicatePolicy.KEEP_LATEST;
      client.registerTemplate(latest); const executor: ProbeExecutor = new ProbeExecutor(); executor.delayMs = 25;
      client.registerExecutor(executor);
      const first = client.submit<string, string>('generic', 'old', context());
      await sleep(5);
      const second = client.submit<string, string>('generic', 'new', context());
      expect((await first.result).output === null).assertTrue();
      expect((await second.result).output).assertEqual('new');
      expect(executor.events.join(',')).assertEqual('generic:start,generic:end,generic:start,generic:end');
    });

    it('mergesExplicitlyEquivalentJobs', 0, async () => {
      const merged: TaskTemplate = template(); merged.duplicatePolicy = DuplicatePolicy.MERGE_EQUIVALENT;
      client.registerTemplate(merged); const executor: ProbeExecutor = new ProbeExecutor(); client.registerExecutor(executor);
      await service.pause();
      const first = client.submit<string, string>('generic', 'same', context());
      const second = client.submit<string, string>('generic', 'same', context());
      expect(first.workflowId).assertEqual(second.workflowId);
      await service.resume(); await first.result;
      expect(executor.calls).assertEqual(1);
    });

    it('doesNotMergeJobsWithDifferentQualityConstraints', 0, async () => {
      const merged: TaskTemplate = template(); merged.duplicatePolicy = DuplicatePolicy.MERGE_EQUIVALENT;
      client.registerTemplate(merged); client.registerExecutor(new ProbeExecutor());
      await service.pause();
      const first = client.submit<string, string>('generic', 'same', context());
      const strict: TaskContext = context(); strict.highQuality = true;
      const second = client.submit<string, string>('generic', 'same', strict);
      expect(first.workflowId === second.workflowId).assertFalse();
      await service.resume(); await first.result; await second.result;
    });

    it('expiresWhileQueueIsPausedWithoutRunningExecutor', 0, async () => {
      client.registerTemplate(template()); const executor: ProbeExecutor = new ProbeExecutor(); client.registerExecutor(executor);
      await service.pause(); const short: TaskContext = context(); short.freshnessMs = 25;
      const result = await client.submit<string, string>('generic', 'input', short).result;
      expect(result.status).assertEqual(TaskStatus.CANCELLED);
      expect(result.nodes[0].errorCode).assertEqual('RESULT_EXPIRED'); expect(executor.calls).assertEqual(0);
    });

    it('discardsExpiredRunningResult', 0, async () => {
      client.registerTemplate(template()); const executor: ProbeExecutor = new ProbeExecutor(); executor.delayMs = 35;
      client.registerExecutor(executor); const short: TaskContext = context(); short.freshnessMs = 15;
      const result = await client.submit<string, string>('generic', 'input', short).result;
      expect(result.status).assertEqual(TaskStatus.CANCELLED); expect(result.output === null).assertTrue();
    });

    it('retainsExecutionSlotUntilTimedOutWorkSettles', 0, async () => {
      const timed: TaskTemplate = template('slow'); timed.timeoutMs = 10;
      client.registerTemplate(timed); client.registerTemplate(template('fast'));
      const slow: ProbeExecutor = new ProbeExecutor('slow'); slow.delayMs = 40;
      const fast: ProbeExecutor = new ProbeExecutor('fast'); fast.events = slow.events;
      client.registerExecutor(slow); client.registerExecutor(fast);
      const first = client.submit<string, string>('slow', 'input', context());
      const second = client.submit<string, string>('fast', 'input', context());
      expect((await first.result).nodes[0].status).assertEqual(TaskStatus.TIMED_OUT);
      await second.result;
      expect(slow.events.join(',')).assertEqual('slow:start,slow:end,fast:start,fast:end');
    });

    it('pausesAtCheckpointAndResumesWithoutRepeatingCompletedChunks', 0, async () => {
      const batch: TaskTemplate = template(); batch.taskType = TaskType.BACKGROUND_BATCH;
      batch.interruptibility = Interruptibility.CHECKPOINT; client.registerTemplate(batch);
      const executor: ProbeExecutor = new ProbeExecutor(); executor.chunkCount = 3; executor.delayMs = 15;
      client.registerExecutor(executor);
      const handle = client.submit<string, string>('generic', 'input', context());
      await sleep(5); await service.pauseBackgroundTasks(); await sleep(30);
      expect(executor.calls).assertEqual(1);
      expect(service.getMetricsSnapshot().pausedCount).assertEqual(1);
      await service.resumeBackgroundTasks(); expect((await handle.result).status).assertEqual(TaskStatus.SUCCEEDED);
      expect(executor.cursors.join(',')).assertEqual('0,1,2');
      expect(service.getRecentLogs(1)[0].telemetry!.checkpointCount).assertEqual(2);
    });

    it('resumesProtectedBackgroundWorkAfterDeviceRecovery', 0, async () => {
      const batch: TaskTemplate = template(); batch.taskType = TaskType.BACKGROUND_BATCH;
      batch.interruptibility = Interruptibility.CHECKPOINT; client.registerTemplate(batch);
      const executor: ProbeExecutor = new ProbeExecutor(); client.registerExecutor(executor);
      await service.injectDebugState({ thermalLevel: ThermalLevel.HOT });
      const handle = client.submit<string, string>('generic', 'input', context());
      await sleep(10); expect(executor.calls).assertEqual(0);
      await service.clearDebugState(); expect((await handle.result).status).assertEqual(TaskStatus.SUCCEEDED);
    });

    it('usesWaitingAndDeadlineToOverrideTaskTypePrior', 0, async () => {
      const foreground: TaskTemplate = template('foreground'); foreground.taskType = TaskType.FOREGROUND_REALTIME;
      const background: TaskTemplate = template('background'); background.taskType = TaskType.BACKGROUND_BATCH;
      client.registerTemplate(foreground); client.registerTemplate(background);
      const one: ProbeExecutor = new ProbeExecutor('foreground'); const two: ProbeExecutor = new ProbeExecutor('background');
      two.events = one.events; client.registerExecutor(one); client.registerExecutor(two);
      await service.pause();
      const unseen: TaskContext = context(); unseen.userWaiting = false; unseen.userVisible = false; unseen.businessImportance = 0;
      const first = client.submit<string, string>('foreground', 'input', unseen);
      const waiting: TaskContext = context(); waiting.deadlineMs = 100; waiting.businessImportance = 1;
      const second = client.submit<string, string>('background', 'input', waiting);
      await service.resume(); await first.result; await second.result;
      expect(one.events[0]).assertEqual('background:start');
    });

    it('recordsPredictionActualErrorAndConsumption', 0, async () => {
      client.registerTemplate(template()); client.registerExecutor(new ProbeExecutor());
      const first = client.submit<string, string>('generic', 'input', context()); await first.result;
      await first.signal({ type: TaskSignalType.RESULT_CONSUMED });
      const log = service.getRecentLogs(1)[0];
      expect(log.telemetry!.prediction !== undefined).assertTrue();
      expect(log.telemetry!.actual!.actualBackend).assertEqual(Backend.CPU);
      expect(log.telemetry!.resultConsumed).assertTrue();
      const second = await client.submit<string, string>('generic', 'input', context()).result;
      expect(second.nodes[0].executionPlan.prediction!.sampleCount > 0).assertTrue();
    });

    it('executesDependencyGraphAndSkipsFutureNodesOnPageLeave', 0, async () => {
      client.registerTemplate(template('first')); client.registerTemplate(template('second'));
      const graph: TaskTemplate = template('workflow');
      graph.workflow = [
        { id: 'a', templateId: 'first', dependsOn: [], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW },
        { id: 'b', templateId: 'second', dependsOn: ['a'], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW }
      ]; graph.outputNodeId = 'b'; client.registerTemplate(graph);
      const first: ProbeExecutor = new ProbeExecutor('first'); first.delayMs = 20; first.prefix = 'a-value';
      const second: ProbeExecutor = new ProbeExecutor('second');
      client.registerExecutor(first); client.registerExecutor(second);
      const success = await client.submit<string, WorkflowInput<string>>('workflow', 'input', context()).result;
      expect(success.output!.outputs['a']).assertEqual('a-value');
      const cancel = client.submit<string, Object>('workflow', 'input', context());
      await sleep(5); await cancel.signal({ type: TaskSignalType.PAGE_LEFT });
      const result = await cancel.result;
      expect(result.status).assertEqual(TaskStatus.CANCELLED);
      expect(result.skippedNodeIds.indexOf('b') >= 0).assertTrue(); expect(second.calls).assertEqual(1);
    });

    it('rejectsCyclesAndInvalidContext', 0, async () => {
      client.registerTemplate(template()); const graph: TaskTemplate = template('cycle');
      graph.workflow = [{ id: 'a', templateId: 'generic', dependsOn: ['b'], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW },
        { id: 'b', templateId: 'generic', dependsOn: ['a'], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW }];
      graph.outputNodeId = 'b'; let rejected: boolean = false;
      try { client.registerTemplate(graph); } catch (error) { rejected = true; }
      expect(rejected).assertTrue(); rejected = false;
      const invalid: TaskContext = context(); invalid.deadlineMs = -1;
      try { client.submit<string, string>('generic', 'input', invalid); } catch (error) { rejected = true; }
      expect(rejected).assertTrue();
    });

    it('rejectsLateHighQualitySignalInsteadOfDeliveringDegradedOutput', 0, async () => {
      client.registerTemplate(template()); const executor: ProbeExecutor = new ProbeExecutor(); executor.delayMs = 25;
      client.registerExecutor(executor); await service.injectDebugState({ thermalLevel: ThermalLevel.HOT });
      const handle = client.submit<string, string>('generic', 'input', context());
      await sleep(5); await handle.signal({ type: TaskSignalType.QUALITY_REQUIRED });
      const result = await handle.result;
      expect(result.output === null).assertTrue();
      expect(result.nodes[0].errorCode).assertEqual('QUALITY_CONSTRAINT_CHANGED');
    });

    it('clearingOverlayImmediatelyRestoresRealDeviceProtection', 0, async () => {
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.CRITICAL });
      await service.injectDebugState({ thermalLevel: ThermalLevel.NORMAL });
      client.registerTemplate(template());
      const executor = new ProbeExecutor(); executor.delayMs = 30; client.registerExecutor(executor);
      const handle = client.submit<string, string>('generic', 'input', context());
      await sleep(5);
      expect(executor.calls).assertEqual(1);
      await service.clearDebugState();
      const result = await handle.result;
      expect(result.nodes[0].errorCode).assertEqual('DEVICE_PROTECTION');
      expect(result.output === null).assertTrue();
    });

    it('requestsStopAtCriticalDeviceState', 0, async () => {
      client.registerTemplate(template()); const executor: ProbeExecutor = new ProbeExecutor(); executor.delayMs = 25;
      client.registerExecutor(executor);
      const handle = client.submit<string, string>('generic', 'input', context());
      await sleep(5); await service.injectDebugState({ thermalLevel: ThermalLevel.CRITICAL });
      const result = await handle.result;
      expect(result.output === null).assertTrue(); expect(result.nodes[0].errorCode).assertEqual('DEVICE_PROTECTION');
    });

    it('preservesRunningPlanWhenBackgroundPauseIsImmediatelyResumed', 0, async () => {
      const batch: TaskTemplate = template(); batch.taskType = TaskType.BACKGROUND_BATCH;
      batch.interruptibility = Interruptibility.CHECKPOINT; client.registerTemplate(batch);
      const executor: ProbeExecutor = new ProbeExecutor(); executor.delayMs = 25;
      client.registerExecutor(executor);
      const handle = client.submit<string, string>('generic', 'input', context());
      await sleep(5); await service.pauseBackgroundTasks(); await service.setPolicyMode(PolicyMode.FIXED_POWER_SAVING);
      await service.resumeBackgroundTasks();
      const result = await handle.result;
      expect((result.nodes[0].executionPlan as LocalExecutionPlan).threadCount)
        .assertEqual((executor.plans[0] as LocalExecutionPlan).threadCount);
    });

    it('letsInteractiveWorkRunBetweenCheckpointSlices', 0, async () => {
      const batch: TaskTemplate = template('batch'); batch.taskType = TaskType.BACKGROUND_BATCH;
      batch.interruptibility = Interruptibility.CHECKPOINT;
      client.registerTemplate(batch); client.registerTemplate(template('interactive'));
      const background: ProbeExecutor = new ProbeExecutor('batch'); background.delayMs = 20; background.chunkCount = 3;
      const foreground: ProbeExecutor = new ProbeExecutor('interactive'); foreground.events = background.events;
      client.registerExecutor(background); client.registerExecutor(foreground);
      const idle: TaskContext = context(); idle.userVisible = false; idle.userWaiting = false;
      const first = client.submit<string, string>('batch', 'input', idle);
      await sleep(5); const second = client.submit<string, string>('interactive', 'input', context());
      await second.result; await first.result;
      expect(background.events[2]).assertEqual('interactive:start');
    });

    it('rejectsPredictedDeadlineMissAndMemoryOvercommit', 0, async () => {
      const expensive: TaskTemplate = template(); expensive.qualityLevels.forEach((level: QualityLevel) => {
        level.estimatedLatencyMs = 500;
      }); client.registerTemplate(expensive); const executor: ProbeExecutor = new ProbeExecutor(); client.registerExecutor(executor);
      const urgent: TaskContext = context(); urgent.deadlineMs = 100;
      expect((await client.submit<string, string>('generic', 'input', urgent).result).status).assertEqual(TaskStatus.FAILED);
      const large: TaskTemplate = template('large'); large.qualityLevels.forEach((level: QualityLevel) => {
        level.estimatedMemoryMb = 1200;
      }); client.registerTemplate(large); const largeExecutor: ProbeExecutor = new ProbeExecutor('large'); client.registerExecutor(largeExecutor);
      expect((await client.submit<string, string>('large', 'input', context()).result).status).assertEqual(TaskStatus.FAILED);
      expect(executor.calls + largeExecutor.calls).assertEqual(0);
    });

    it('usesDeclaredInputScaleForCandidatePrediction', 0, async () => {
      const declared: TaskTemplate = template(); declared.resourceHints.baselineCandidateCount = 10;
      client.registerTemplate(declared); client.registerExecutor(new ProbeExecutor());
      const small: TaskContext = context(); small.candidateCount = 10;
      const large: TaskContext = context(); large.candidateCount = 1000;
      const first = await client.submit<string, string>('generic', 'input', small).result;
      const second = await client.submit<string, string>('generic', 'input', large).result;
      expect(second.nodes[0].executionPlan.prediction!.latencyMs > first.nodes[0].executionPlan.prediction!.latencyMs).assertTrue();
    });

    it('doesNotTrainFromCancelledWorkAndReturnsDetachedAuditSnapshots', 0, async () => {
      client.registerTemplate(template()); const executor: ProbeExecutor = new ProbeExecutor(); executor.delayMs = 20;
      client.registerExecutor(executor); const first = client.submit<string, string>('generic', 'input', context());
      await sleep(5); await first.cancel(); await first.result;
      const second = await client.submit<string, string>('generic', 'input', context()).result;
      expect(second.nodes[0].executionPlan.prediction!.sampleCount).assertEqual(0);
      const logs = service.getRecentLogs(1); logs[0].executionPlan.reasonCodes.push('TAMPERED');
      expect(service.exportAudit().indexOf('TAMPERED') < 0).assertTrue();
    });

    it('skipsFailedBranchAndCompletesIndependentOutput', 0, async () => {
      client.registerTemplate(template('failed')); client.registerTemplate(template('dependent')); client.registerTemplate(template('independent'));
      const graph: TaskTemplate = template('graph'); graph.workflow = [
        { id: 'a', templateId: 'failed', dependsOn: [], failurePolicy: DependencyFailurePolicy.SKIP_DEPENDENTS },
        { id: 'b', templateId: 'dependent', dependsOn: ['a'], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW },
        { id: 'c', templateId: 'independent', dependsOn: [], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW }
      ]; graph.outputNodeId = 'c'; client.registerTemplate(graph);
      const first: ProbeExecutor = new ProbeExecutor('failed'); first.fail = true;
      const dependent: ProbeExecutor = new ProbeExecutor('dependent'); const independent: ProbeExecutor = new ProbeExecutor('independent');
      independent.prefix = 'ok'; client.registerExecutor(first); client.registerExecutor(dependent); client.registerExecutor(independent);
      const result = await client.submit<string, string>('graph', 'input', context()).result;
      expect(result.status).assertEqual(TaskStatus.SUCCEEDED); expect(result.output).assertEqual('ok');
      expect(result.skippedNodeIds.indexOf('b') >= 0).assertTrue(); expect(dependent.calls).assertEqual(0);
    });

    it('inheritsWorkflowPrivacyInRemoteChild', 0, async () => {
      const remote: TaskTemplate = template('remote'); remote.inferenceLocation = InferenceLocation.REMOTE_CLOUD;
      remote.privacyPolicy = PrivacyPolicy.REMOTE_ALLOWED;
      remote.remoteOptions = { provider: 'test', maxRetries: 0, maxConcurrency: 1, allowLocalFallback: false };
      client.registerTemplate(remote);
      const graph: TaskTemplate = template('graph'); graph.workflow = [
        { id: 'remote', templateId: 'remote', dependsOn: [], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW }
      ]; graph.outputNodeId = 'remote'; client.registerTemplate(graph);
      const executor: ProbeExecutor = new ProbeExecutor('remote'); executor.inferenceLocation = InferenceLocation.REMOTE_CLOUD;
      client.registerExecutor(executor); const allowed: TaskContext = context(); allowed.networkAllowed = true;
      const result = await client.submit<string, string>('graph', 'input', allowed).result;
      expect(result.status).assertEqual(TaskStatus.FAILED); expect(executor.calls).assertEqual(0);
    });

    it('reducesSpeculativeUtilityWithRepeatedIgnoredResults', 0, async () => {
      client.registerTemplate(template()); client.registerExecutor(new ProbeExecutor());
      const idle: TaskContext = context(); idle.userVisible = false; idle.userWaiting = false;
      for (let i: number = 0; i < 5; i++) {
        const handle = client.submit<string, string>('generic', 'input', idle);
        await handle.result; await handle.signal({ type: TaskSignalType.RESULT_IGNORED });
      }
      const next = await client.submit<string, string>('generic', 'input', idle).result;
      expect(next.nodes[0].executionPlan.reasonCodes.some((reason: string) => reason.indexOf('CONSUMPTION_FEEDBACK') === 0)).assertTrue();
    });
  });
}
