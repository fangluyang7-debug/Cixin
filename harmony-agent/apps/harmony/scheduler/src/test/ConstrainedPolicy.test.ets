import { afterEach, beforeEach, describe, expect, it } from '@ohos/hypium';
import {
  AppVisibility, Backend, CancellationSignal, ConstrainedPolicyConfig, ConstrainedPolicyMode,
  DuplicatePolicy, ExecutionPlan, ExecutorResult, ExecutorTelemetry, FeedbackOption,
  InferenceLocation, Interruptibility, MemoryPressure, ModelTier, PolicyMode, PrivacyPolicy,
  SchedulerClient, SchedulerService, TaskContext, TaskSignalType, TaskStatus, TaskTemplate,
  TaskType, ThermalLevel, WorkloadExecutor, PolicyStateStore, QualityLevel, WorkflowResult, TaskCheckpoint
} from '../../Index';
import { stablePolicyBucket } from '../main/ets/policy/ProfileContract';

function declaration(background: boolean = false): TaskTemplate {
  return { capability: 'generic-profiled', taskType: background ? TaskType.BACKGROUND_BATCH : TaskType.USER_INITIATED,
    inferenceLocation: InferenceLocation.LOCAL_DEVICE,
    qualityLevels: [ModelTier.HIGH_ACCURACY, ModelTier.LIGHTWEIGHT].map((tier: ModelTier): QualityLevel => ({
      id: tier, modelTier: tier, estimatedLatencyMs: 1, estimatedMemoryMb: 8, relativeEnergyCost: 1,
      supportedBackends: [Backend.CPU], supportedThreadCounts: [1, 2] })),
    interruptibility: background ? Interruptibility.CHECKPOINT : Interruptibility.NON_INTERRUPTIBLE,
    duplicatePolicy: DuplicatePolicy.KEEP_ALL, privacyPolicy: PrivacyPolicy.LOCAL_ONLY,
    resourceHints: { modelVersion: 'test-model' }, timeoutMs: 5000,
    manifest: { defaultProfileId: 'DEFAULT', fallbackProfileId: 'SAFE', profiles: [
      { id: 'DEFAULT', qualityLevelId: ModelTier.HIGH_ACCURACY, modelTier: ModelTier.HIGH_ACCURACY,
        backend: Backend.CPU, workerCount: 2, allowWarmup: false, supportsForeground: true, supportsBackground: true,
        estimatedQualityLevel: ModelTier.HIGH_ACCURACY, safeUnderPressure: false, qualityValidated: true, lowRisk: background },
      { id: 'SAFE', qualityLevelId: ModelTier.HIGH_ACCURACY, modelTier: ModelTier.HIGH_ACCURACY,
        backend: Backend.CPU, workerCount: 1, allowWarmup: false, supportsForeground: true, supportsBackground: true,
        estimatedQualityLevel: ModelTier.HIGH_ACCURACY, safeUnderPressure: true, qualityValidated: true, lowRisk: background },
      { id: 'FAST', qualityLevelId: ModelTier.LIGHTWEIGHT, modelTier: ModelTier.LIGHTWEIGHT,
        backend: Backend.CPU, workerCount: 1, allowWarmup: false, supportsForeground: true, supportsBackground: true,
        estimatedQualityLevel: ModelTier.LIGHTWEIGHT, safeUnderPressure: true, qualityValidated: true, lowRisk: background }
    ], profileTransitions: [{ from: 'DEFAULT', to: 'FAST' }, { from: 'FAST', to: 'DEFAULT' },
      { from: 'DEFAULT', to: 'SAFE' }, { from: 'SAFE', to: 'DEFAULT' }] } };
}

function context(): TaskContext {
  return { userVisible: true, userWaiting: true, accuracyFloor: ModelTier.LIGHTWEIGHT,
    targetLatencyMs: 100, softDeadlineMs: 1000, deadlineMs: 3000, freshnessMs: 4000 };
}

function config(mode: ConstrainedPolicyMode = ConstrainedPolicyMode.SHADOW): ConstrainedPolicyConfig {
  return { version: 'test-policy', mode: mode, expiresAtMs: Date.now() + 60000, rolloutPercent: 100,
    minimumSampleCount: 2, cooldownMs: 0, observationWindowSize: 10, consecutiveFailureLimit: 2,
    experimentStartedAtMs: Date.now() - 1000, maximumExperimentDurationMs: 60000, activeValidated: true,
    thresholds: { latencyRatio: 10, failureRateDelta: 0.2, negativeFeedbackRateDelta: 0.2, cancellationRateDelta: 0.2 },
    rules: [{ capability: 'generic-profiled', allowedProfileIds: ['DEFAULT', 'FAST', 'SAFE'], preferredProfileId: 'FAST' }] };
}

class ProfileProbe implements WorkloadExecutor<string, string> {
  public readonly capability: string = 'generic-profiled';
  public readonly inferenceLocation: InferenceLocation = InferenceLocation.LOCAL_DEVICE;
  public calls: number = 0;
  public mismatch: boolean = false;
  public fail: boolean = false;
  public delayMs: number = 1;
  public unsupportedDefault: boolean = false;
  public chunkCount: number = 1;
  public afterSlice?: () => void;
  public onStart?: () => void;
  public plans: ExecutionPlan[] = [];
  public supports(plan: ExecutionPlan): boolean { return !this.unsupportedDefault || plan.executionProfile?.id !== 'DEFAULT'; }
  public async execute(input: string, plan: ExecutionPlan, _signal: CancellationSignal,
    checkpoint?: TaskCheckpoint): Promise<ExecutorResult<string>> {
    this.calls++; this.plans.push(JSON.parse(JSON.stringify(plan)) as ExecutionPlan);
    if (this.onStart !== undefined) { this.onStart(); }
    await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));
    if (this.fail) { throw new Error('Synthetic failure'); }
    const profile = plan.executionProfile!;
    const actual: ExecutorTelemetry = { profileId: this.mismatch ? 'WRONG' : profile.id, actualBackend: Backend.CPU,
      actualModelTier: profile.modelTier, workerCount: profile.workerCount, candidateCount: profile.candidateCount,
      batchSize: profile.batchSize, retrievalDimensions: profile.retrievalDimensions };
    if (this.afterSlice !== undefined) { this.afterSlice(); }
    const cursor: number = (checkpoint?.cursor ?? 0) + 1;
    return { output: input, telemetry: actual, completed: cursor >= this.chunkCount, checkpoint: { cursor: cursor } };
  }
  public async dispose(): Promise<void> {}
}

class MemoryStore implements PolicyStateStore {
  public raw: string | null = null;
  public async load(): Promise<string | null> { return this.raw; }
  public async save(raw: string): Promise<void> { this.raw = raw; }
}

export default function constrainedPolicyTest(): void {
  describe('ConstrainedProfileLoop', () => {
    let service: SchedulerService;
    let client: SchedulerClient;
    let executor: ProfileProbe;
    beforeEach(async () => {
      service = new SchedulerService();
      await service.initialize({ defaultPolicyMode: PolicyMode.ADAPTIVE, enableDebugInjection: true,
        metricsWindowSize: 100, upgradeStableDurationMs: 0, minimumTierHoldMs: 0, executors: [] });
      service.updateRealDeviceState({ batteryPercent: 80, isCharging: false, thermalLevel: ThermalLevel.NORMAL,
        memoryPressure: MemoryPressure.NORMAL, availableMemoryMb: 2048, systemCpuUsage: 10 });
      client = new SchedulerClient(service); executor = new ProfileProbe();
    });
    afterEach(async () => { await client.dispose(); await service.shutdown(); });
    const register = (template: TaskTemplate = declaration()): void => { client.registerTemplate(template); client.registerExecutor(executor); };
    const run = async (ctx: TaskContext = context()): Promise<WorkflowResult<string>> => {
      return await client.submit<string, string>('generic-profiled', 'private-search-text', ctx).result;
    };

    it('observeExecutesDefaultAndOmitsRawInput', 0, async () => {
      register(); const result = await run();
      expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
      expect(result.nodes[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
      expect(result.nodes[0].executionPlan.policyAudit!.actualConfirmed).assertTrue();
      expect(result.nodes[0].executionPlan.policyAudit!.shadowProfileId === undefined).assertTrue();
      expect(client.exportAudit().indexOf('private-search-text') < 0).assertTrue();
    });

    it('shadowRecordsAlternativeWithoutExecutingIt', 0, async () => {
      register(); service.configureConstrainedPolicy(config()); const result = await run();
      const audit = result.nodes[0].executionPlan.policyAudit!;
      expect(audit.baselineProfileId).assertEqual('DEFAULT'); expect(audit.shadowProfileId).assertEqual('FAST');
      expect(executor.plans[0].executionProfile!.id).assertEqual('DEFAULT');
      expect(audit.cohort).assertEqual('BASELINE');
    });

    it('rejectsInvalidProfilesAndTransitions', 0, () => {
      const bad = declaration(); bad.manifest!.profiles[0].workerCount = 4;
      let rejected = false; try { client.registerTemplate(bad); } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
      const edge = declaration(); edge.manifest!.profileTransitions[0].to = 'UNKNOWN';
      rejected = false; try { client.registerTemplate(edge); } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
    });

    it('rejectsDuplicateAndUnknownQualityProfiles', 0, () => {
      const bad = declaration(); bad.manifest!.profiles[1].id = 'DEFAULT';
      let rejected = false; try { client.registerTemplate(bad); } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
      const unknown = declaration(); unknown.manifest!.profiles[0].qualityLevelId = 'missing';
      rejected = false; try { client.registerTemplate(unknown); } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
    });

    it('preservesHighQualityDuringProtection', 0, async () => {
      register(); await service.injectDebugState({ thermalLevel: ThermalLevel.HOT });
      const ctx = context(); ctx.highQuality = true; ctx.accuracyFloor = ModelTier.HIGH_ACCURACY;
      const result = await run(ctx);
      expect(result.nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
      expect(result.nodes[0].executionPlan.executionProfile!.estimatedQualityLevel).assertEqual(ModelTier.HIGH_ACCURACY);
    });

    it('rejectsWhenQualityAndDeviceProtectionConflict', 0, async () => {
      const t = declaration(); t.manifest!.profiles[1].safeUnderPressure = false;
      register(t); await service.injectDebugState({ thermalLevel: ThermalLevel.HOT });
      const ctx = context(); ctx.highQuality = true;
      expect((await run(ctx)).status).assertEqual(TaskStatus.FAILED); expect(executor.calls).assertEqual(0);
    });

    it('usesConservativeFallbackForUnknownState', 0, async () => {
      register(); service.configureConstrainedPolicy(config());
      await service.injectDebugState({ thermalLevel: ThermalLevel.UNKNOWN });
      const result = await run(); expect(result.nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
      expect(result.nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('STATE_UNKNOWN_CONSERVATIVE');
    });

    it('usesConservativeFallbackForStaleSensorSample', 0, async () => {
      register(); service.updateRealDeviceState({ observations: [
        { field: 'thermal', source: 'test', known: true, observedAtMs: Date.now() - 11000 }] });
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
    });

    it('protectsLowBatteryAndMemoryPressure', 0, async () => {
      register(); await service.injectDebugState({ batteryPercent: 5, isCharging: false });
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
      await service.clearDebugState(); await service.injectDebugState({ memoryPressure: MemoryPressure.HIGH });
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
      await service.injectDebugState({ memoryPressure: MemoryPressure.CRITICAL });
      expect((await run()).status).assertEqual(TaskStatus.FAILED);
    });

    it('reevaluatesQueuedProfileBeforeDispatch', 0, async () => {
      register(); await service.pause();
      const handle = client.submit<string, string>('generic-profiled', 'input', context());
      await service.injectDebugState({ thermalLevel: ThermalLevel.HOT }); await service.resume();
      await handle.result; expect(executor.plans[0].executionProfile!.id).assertEqual('SAFE');
    });

    it('respectsDeclaredForegroundSupport', 0, async () => {
      const t = declaration(); t.manifest!.profiles.forEach((profile) => { profile.supportsForeground = false; });
      register(t); expect((await run()).status).assertEqual(TaskStatus.FAILED); expect(executor.calls).assertEqual(0);
    });

    it('expiredPolicyFallsBackLocally', 0, async () => {
      register(); const cfg = config(); cfg.expiresAtMs = Date.now() - 1; service.configureConstrainedPolicy(cfg);
      const result = await run(); expect(result.nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
      expect(result.nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('POLICY_EXPIRED');
    });

    it('unknownPolicyProfileFallsBackLocally', 0, async () => {
      register(); const cfg = config(); cfg.rules[0].allowedProfileIds.push('FOREIGN'); cfg.rules[0].preferredProfileId = 'FOREIGN';
      service.configureConstrainedPolicy(cfg);
      expect((await run()).nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('POLICY_CAPABILITY_MISMATCH');
    });

    it('shadowNeverCrossesUndeclaredTransition', 0, async () => {
      const t = declaration(); t.manifest!.profileTransitions = [{ from: 'DEFAULT', to: 'SAFE' }]; register(t);
      service.configureConstrainedPolicy(config()); const result = await run();
      expect(result.nodes[0].executionPlan.policyAudit!.shadowProfileId !== 'FAST').assertTrue();
    });

    it('canaryColdStartUsesBaselineThenAllowsLowRiskAction', 0, async () => {
      register(declaration(true)); service.configureConstrainedPolicy(config(ConstrainedPolicyMode.CANARY));
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('FAST');
      expect(executor.calls).assertEqual(3);
    });

    it('doesNotCanaryUnvalidatedForegroundQuality', 0, async () => {
      const t = declaration(); t.manifest!.profiles[2].qualityValidated = false; register(t);
      service.configureConstrainedPolicy(config(ConstrainedPolicyMode.CANARY)); await run(); await run();
      const result = await run(); expect(result.nodes[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
      expect(result.nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('PROFILE_NOT_VALIDATED_FOR_ROLLOUT');
    });

    it('requiresExplicitExperimentThresholdsAndActiveApproval', 0, () => {
      const cfg = config(ConstrainedPolicyMode.CANARY); cfg.thresholds = undefined;
      let rejected = false; try { service.configureConstrainedPolicy(cfg); } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
      const active = config(ConstrainedPolicyMode.ACTIVE); active.activeValidated = false;
      rejected = false; try { service.configureConstrainedPolicy(active); } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
    });

    it('enforcesImmutablePolicyVersion', 0, () => {
      const cfg = config(); service.configureConstrainedPolicy(cfg); cfg.mode = ConstrainedPolicyMode.OBSERVE;
      let rejected = false; try { service.configureConstrainedPolicy(cfg); } catch (_) { rejected = true; }
      expect(rejected).assertTrue();
    });

    it('runningVersionKeepsItsOwnFailureThreshold', 0, async () => {
      register(); const original = config(); service.configureConstrainedPolicy(original);
      executor.fail = true; executor.delayMs = 20;
      const started = new Promise<void>((resolve) => { executor.onStart = resolve; });
      const handle = client.submit<string, string>('generic-profiled', 'input', context());
      await started;
      const next = config(); next.version = 'next-version'; next.consecutiveFailureLimit = 1;
      service.configureConstrainedPolicy(next);
      const result = await handle.result;
      expect(result.nodes[0].executionPlan.policyVersion).assertEqual(original.version);
      expect(result.nodes[0].executionPlan.policyAudit!.fallbackReason === undefined).assertTrue();
      executor.fail = false; service.configureConstrainedPolicy(original);
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
    });

    it('enforcesCooldownAndExperimentEnd', 0, async () => {
      register(declaration(true)); const cfg = config(ConstrainedPolicyMode.CANARY); cfg.cooldownMs = 60000;
      service.configureConstrainedPolicy(cfg); await run(); await run();
      expect((await run()).nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('PROFILE_COOLDOWN');
      const expired = config(ConstrainedPolicyMode.CANARY); expired.version = 'expired';
      expired.experimentStartedAtMs = Date.now() - 70000; service.configureConstrainedPolicy(expired);
      expect((await run()).nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('EXPERIMENT_OUTSIDE_WINDOW');
    });

    it('stableAssignmentDoesNotDependOnEvaluationCount', 0, () => {
      expect(stablePolicyBucket('v:type:state:workflow')).assertEqual(stablePolicyBucket('v:type:state:workflow'));
      expect(stablePolicyBucket('v:type:state:workflow') >= 0).assertTrue();
      expect(stablePolicyBucket('v:type:state:workflow') < 10000).assertTrue();
    });

    it('mismatchedActualProfileFailsThenUsesFallback', 0, async () => {
      register(); executor.mismatch = true;
      const bad = await run(); expect(bad.status).assertEqual(TaskStatus.FAILED);
      expect(bad.nodes[0].errorCode).assertEqual('EXECUTOR_PROFILE_MISMATCH');
      executor.mismatch = false;
      const next = await run(); expect(next.nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
      expect(next.nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('EXECUTOR_PROFILE_MISMATCH');
    });

    it('unsupportedDefaultFallsBackBeforeExecute', 0, async () => {
      register(); executor.unsupportedDefault = true; const result = await run();
      expect(result.status).assertEqual(TaskStatus.SUCCEEDED); expect(executor.plans[0].executionProfile!.id).assertEqual('SAFE');
    });

    it('queuedUnsupportedProfileTripsCircuitAndUsesLegalFallback', 0, async () => {
      register(); await service.pause();
      const handle = client.submit<string, string>('generic-profiled', 'input', context());
      expect(service.getMetricsSnapshot().queuedCount).assertEqual(1);
      executor.unsupportedDefault = true;
      service.updateRealDeviceState({ batteryPercent: 79 });
      expect(executor.calls).assertEqual(0);
      await service.resume();
      const result = await handle.result;
      expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
      expect(result.nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
      expect(result.nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('EXECUTOR_UNSUPPORTED_CIRCUIT');
      expect(executor.calls).assertEqual(1);
    });

    it('criticalStateRejectsQueuedProfileWhileSchedulerRemainsPaused', 0, async () => {
      register(); await service.pause();
      const handle = client.submit<string, string>('generic-profiled', 'input', context());
      expect(service.getMetricsSnapshot().queuedCount).assertEqual(1);
      service.updateRealDeviceState({ thermalLevel: ThermalLevel.CRITICAL });
      expect(service.getMetricsSnapshot().queuedCount).assertEqual(0);
      const result = await handle.result;
      expect(result.status).assertEqual(TaskStatus.FAILED);
      expect(executor.calls).assertEqual(0);
    });

    it('consecutiveFailuresTripLocalCircuit', 0, async () => {
      register(); service.configureConstrainedPolicy(config()); executor.fail = true;
      await run(); await run(); executor.fail = false;
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
    });

    it('qualitySignalInvalidatesRunningLowerQualityResult', 0, async () => {
      const t = declaration(); t.manifest!.defaultProfileId = 'FAST'; register(t); executor.delayMs = 20;
      const handle = client.submit<string, string>('generic-profiled', 'input', context());
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      await handle.signal({ type: TaskSignalType.QUALITY_REQUIRED });
      const result = await handle.result; expect(result.output === null).assertTrue();
    });

    it('softDeadlineDoesNotTerminateSuccessfulWork', 0, async () => {
      register(); executor.delayMs = 20; const ctx = context(); ctx.targetLatencyMs = 1; ctx.softDeadlineMs = 2;
      const result = await run(ctx); expect(result.status).assertEqual(TaskStatus.SUCCEEDED);
      const log = service.getRecentLogs(1)[0]; expect(log.telemetry!.softDeadlineMissed).assertTrue();
    });

    it('feedbackNeedsOptInDisplayedResultAndValidOption', 0, async () => {
      register(); const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      expect(client.getFeedbackRequest(handle.workflowId) === null).assertTrue();
      service.setFeedbackEnabled(true);
      expect(client.getFeedbackRequest(handle.workflowId) === null).assertTrue();
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED });
      const request = client.getFeedbackRequest(handle.workflowId)!;
      expect(request !== null).assertTrue();
      await handle.signal({ type: TaskSignalType.USER_FEEDBACK, feedback: {
        taskRunId: request.taskRunId, kind: request.kind, option: FeedbackOption.TOO_HOT } });
      expect(service.getRecentLogs(1)[0].telemetry!.userFeedback === undefined).assertTrue();
      await handle.signal({ type: TaskSignalType.USER_FEEDBACK, feedback: {
        taskRunId: request.taskRunId, kind: request.kind, option: request.options[0] } });
      expect(service.getRecentLogs(1)[0].telemetry!.userFeedback!.option).assertEqual(request.options[0]);
      expect(client.getFeedbackRequest(handle.workflowId) === null).assertTrue();
      expect(service.getPolicyMetrics()[0].feedbackCount).assertEqual(1);
    });

    it('feedbackIsRateLimitedAndPageExitInvalidatesRequest', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const first = client.submit<string, string>('generic-profiled', 'input', context()); await first.result;
      await first.signal({ type: TaskSignalType.RESULT_DISPLAYED });
      expect(client.getFeedbackRequest(first.workflowId) !== null).assertTrue();
      await first.signal({ type: TaskSignalType.PAGE_LEFT }); expect(client.getFeedbackRequest(first.workflowId) === null).assertTrue();
      const second = client.submit<string, string>('generic-profiled', 'input', context()); await second.result;
      await second.signal({ type: TaskSignalType.RESULT_DISPLAYED });
      expect(client.getFeedbackRequest(second.workflowId) === null).assertTrue();
    });

    it('backgroundAndPreviewNeverAskForFeedback', 0, async () => {
      register(declaration(true)); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED });
      expect(client.getFeedbackRequest(handle.workflowId) === null).assertTrue();
    });

    it('criticalStateDiscardsUninterruptibleResultWithoutEarlyCompletion', 0, async () => {
      register(); executor.delayMs = 30;
      const handle = client.submit<string, string>('generic-profiled', 'input', context());
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      await service.injectDebugState({ thermalLevel: ThermalLevel.CRITICAL });
      const result = await handle.result;
      expect(result.output === null).assertTrue(); expect(result.nodes[0].executionDurationMs >= 20).assertTrue();
      expect(result.nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('DEVICE_PROTECTION_CIRCUIT');
    });

    it('killSwitchReturnsToSafeExecution', 0, async () => {
      register(); service.configureConstrainedPolicy(config()); service.disablePolicyOptimization();
      const result = await run(); expect(result.nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('POLICY_DISABLED');
      expect(service.getConstrainedPolicy().mode).assertEqual(ConstrainedPolicyMode.OBSERVE);
    });

    it('nonInferiorityFailureWindowStopsTreatment', 0, async () => {
      register(declaration(true)); const cfg = config(ConstrainedPolicyMode.CANARY); cfg.consecutiveFailureLimit = 10;
      service.configureConstrainedPolicy(cfg); await run(); await run();
      executor.fail = true; await run(); await run(); executor.fail = false;
      const result = await run(); expect(result.nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
      expect(result.nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('NON_INFERIORITY_STOP');
    });

    it('zeroRolloutNeverExecutesTreatment', 0, async () => {
      register(declaration(true)); const cfg = config(ConstrainedPolicyMode.CANARY); cfg.rolloutPercent = 0;
      service.configureConstrainedPolicy(cfg); await run(); await run();
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
    });

    it('approvedActiveStillHonorsQualityFloor', 0, async () => {
      register(); service.configureConstrainedPolicy(config(ConstrainedPolicyMode.ACTIVE)); await run(); await run();
      const ctx = context(); ctx.highQuality = true;
      const result = await run(ctx); expect(result.nodes[0].executionPlan.executionProfile!.estimatedQualityLevel).assertEqual(ModelTier.HIGH_ACCURACY);
    });

    it('canaryDoesNotMixInputSizeSamples', 0, async () => {
      register(declaration(true)); service.configureConstrainedPolicy(config(ConstrainedPolicyMode.CANARY)); await run(); await run();
      const ctx = context(); ctx.inputTokens = 128;
      expect((await run(ctx)).nodes[0].executionPlan.policyAudit!.fallbackReason).assertEqual('INSUFFICIENT_BASELINE_SAMPLES');
    });

    it('qualityFeedbackCannotOverwriteAnAnswer', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED }); const request = client.getFeedbackRequest(handle.workflowId)!;
      await handle.signal({ type: TaskSignalType.USER_FEEDBACK, feedback: {
        taskRunId: request.taskRunId, kind: request.kind, option: request.options[0] } });
      await handle.signal({ type: TaskSignalType.USER_FEEDBACK, feedback: {
        taskRunId: request.taskRunId, kind: request.kind, option: request.options[1] } });
      expect(service.getRecentLogs(1)[0].telemetry!.userFeedback!.option).assertEqual(request.options[0]);
    });

    it('backgroundVisibilityPreventsFeedback', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED });
      service.updateRealDeviceState({ appVisibility: AppVisibility.BACKGROUND });
      expect(client.getFeedbackRequest(handle.workflowId) === null).assertTrue();
    });

    it('corruptLocalStoreDisablesOptimizationWithoutBlockingTasks', 0, async () => {
      await client.dispose(); await service.shutdown(); const store = new MemoryStore(); store.raw = '{invalid';
      await service.initialize({ defaultPolicyMode: PolicyMode.ADAPTIVE, enableDebugInjection: true,
        metricsWindowSize: 100, upgradeStableDurationMs: 0, minimumTierHoldMs: 0, executors: [], policyStateStore: store });
      service.updateRealDeviceState({ batteryPercent: 80, isCharging: false, thermalLevel: ThermalLevel.NORMAL,
        memoryPressure: MemoryPressure.NORMAL, availableMemoryMb: 2048 });
      client = new SchedulerClient(service); register();
      expect(service.getPolicyStorageStatus()).assertEqual('STORE_INVALID_OR_UNAVAILABLE');
      expect((await run()).status).assertEqual(TaskStatus.SUCCEEDED);
    });

    it('foregroundFreshnessDropsLateResultAndRecordsExpiry', 0, async () => {
      register(); executor.delayMs = 30; const ctx = context(); ctx.freshnessMs = 10;
      const result = await run(ctx); expect(result.output === null).assertTrue();
      expect(result.nodes[0].status).assertEqual(TaskStatus.CANCELLED);
    });

    it('mixedCheckpointRunsAreNotAttributedToSingleProfileStatistics', 0, async () => {
      register(declaration(true)); executor.chunkCount = 2;
      executor.afterSlice = (): void => { service.updateRealDeviceState({ systemCpuUsage: 60 }); };
      expect((await run()).status).assertEqual(TaskStatus.SUCCEEDED);
      expect(service.getRecentLogs(1)[0].telemetry!.mixedExecution).assertTrue();
      expect(service.getPolicyMetrics()[0].cohort).assertEqual('MIXED');
    });

    it('approvedActiveCanExecuteValidatedProfileAfterBaseline', 0, async () => {
      register(); service.configureConstrainedPolicy(config(ConstrainedPolicyMode.ACTIVE)); await run(); await run();
      const result = await run(); expect(result.nodes[0].executionPlan.executionProfile!.id).assertEqual('FAST');
      expect(result.nodes[0].executionPlan.policyAudit!.cohort).assertEqual('TREATMENT');
    });

    it('cancellationWatchdogDoesNotPretendExecutorStopped', 0, async () => {
      register(); executor.delayMs = 2150;
      const handle = client.submit<string, string>('generic-profiled', 'input', context());
      await new Promise<void>((resolve) => setTimeout(resolve, 5)); await handle.cancel();
      const result = await handle.result;
      expect(result.status).assertEqual(TaskStatus.CANCELLED);
      expect(service.getRecentLogs(10).some((log) => log.status === TaskStatus.STOP_REQUESTED &&
        log.stopRequestedAt !== undefined && log.finishedAt === null &&
        log.errorCode === 'CANCELLATION_NOT_ACKNOWLEDGED')).assertTrue();
      expect(result.nodes[0].executionDurationMs >= 2000).assertTrue();
    });

    it('persistsCircuitAndOptInWithoutRawTelemetry', 0, async () => {
      await client.dispose(); await service.shutdown(); const store = new MemoryStore();
      await service.initialize({ defaultPolicyMode: PolicyMode.ADAPTIVE, enableDebugInjection: true,
        metricsWindowSize: 100, upgradeStableDurationMs: 0, minimumTierHoldMs: 0, executors: [], policyStateStore: store });
      service.updateRealDeviceState({ batteryPercent: 80, isCharging: false, thermalLevel: ThermalLevel.NORMAL,
        memoryPressure: MemoryPressure.NORMAL, availableMemoryMb: 2048 });
      client = new SchedulerClient(service); register(); executor.mismatch = true; await run();
      service.setFeedbackEnabled(true); await service.flushPolicyState();
      expect(store.raw!.indexOf('private-search-text') < 0).assertTrue();
      await client.dispose(); await service.shutdown();
      await service.initialize({ defaultPolicyMode: PolicyMode.ADAPTIVE, enableDebugInjection: true,
        metricsWindowSize: 100, upgradeStableDurationMs: 0, minimumTierHoldMs: 0, executors: [], policyStateStore: store });
      service.updateRealDeviceState({ batteryPercent: 80, isCharging: false, thermalLevel: ThermalLevel.NORMAL,
        memoryPressure: MemoryPressure.NORMAL, availableMemoryMb: 2048 });
      client = new SchedulerClient(service); executor.mismatch = false; register();
      expect(service.isFeedbackEnabled()).assertTrue();
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
    });
  });
}
