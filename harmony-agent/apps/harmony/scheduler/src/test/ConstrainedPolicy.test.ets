import { afterEach, beforeEach, describe, expect, it } from '@ohos/hypium';
import {
  AppVisibility, Backend, CancellationSignal, ConstrainedPolicyConfig, ConstrainedPolicyMode, AccuracyPreference, TaskProfile, FeedbackKind,
  DuplicatePolicy, ExecutionPlan, ExecutorResult, ExecutorTelemetry, FeedbackOption,
  InferenceLocation, Interruptibility, MemoryPressure, ModelTier, PolicyMode, PrivacyPolicy,
  SchedulerClient, SchedulerService, TaskContext, TaskSignalType, TaskStatus, TaskTemplate,
  TaskType, ThermalLevel, WorkloadExecutor, PolicyStateStore, QualityLevel, WorkflowResult, TaskCheckpoint, ActiveTaskSnapshot,
  SchedulerLogEntry, AppExperienceObservation
} from '../../Index';
import { stablePolicyBucket } from '../main/ets/policy/ProfileContract';
import { ConstrainedPolicy } from '../main/ets/policy/ConstrainedPolicy';
import { SemanticPolicy } from '../main/ets/policy/SemanticPolicy';
import { FeedbackController } from '../main/ets/policy/FeedbackController';

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
  public executionPath: string = 'taskpool';
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
      executionPath: this.executionPath,
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

    it('activeSnapshotsAreDetachedReadOnlyAndExcludeRawInput', 0, async () => {
      register(); let observed: ActiveTaskSnapshot[] = [];
      executor.onStart = () => {
        observed = service.getActiveTasks();
        expect(observed.length).assertEqual(1);
        expect(observed[0].status).assertEqual(TaskStatus.RUNNING);
        expect(observed[0].targetLatencyMs).assertEqual(100);
        expect(observed[0].deadlineMs).assertEqual(3000);
        observed[0].executionPlan.executionProfile!.id = 'UI_MUTATION';
        expect(service.getActiveTasks()[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
      };
      expect((await run()).status).assertEqual(TaskStatus.SUCCEEDED);
      expect(observed.length).assertEqual(1);
      expect(JSON.stringify(observed).indexOf('private-search-text') < 0).assertTrue();
      expect(service.getActiveTasks().length).assertEqual(0);
      expect(service.getRecentLogs(20).some((log) => log.status === TaskStatus.RUNNING)).assertTrue();
      expect(executor.calls).assertEqual(1);
    });

    it('pausedQueueIsVisibleWithoutDispatchingOrCancellingIt', 0, async () => {
      register(); await service.pause();
      const handle = client.submit<string, string>('generic-profiled', 'private-search-text', context());
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(service.getActiveTasks().length).assertEqual(1);
      expect(service.getActiveTasks()[0].startedAt === null).assertTrue();
      expect(executor.calls).assertEqual(0);
      await service.resume(); expect((await handle.result).status).assertEqual(TaskStatus.SUCCEEDED);
    });

    it('availabilityExplainsConsentDisplayAnswerAndOwnershipWithoutConsumingQuota', 0, async () => {
      register();
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      expect(client.getFeedbackAvailability(handle.workflowId).reason).assertEqual('CONSENT_REQUIRED');
      service.setFeedbackEnabled(true);
      expect(client.getFeedbackAvailability(handle.workflowId).reason).assertEqual('RESULT_NOT_DISPLAYED');
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      for (let i = 0; i < 10; i++) { expect(client.getFeedbackAvailability(handle.workflowId).eligible).assertTrue(); }
      const other = new SchedulerClient(service);
      expect(other.getFeedbackAvailability(handle.workflowId).reason).assertEqual('WORKFLOW_NOT_READY');
      await other.dispose();
      const question = client.getFeedbackRequest(handle.workflowId)!;
      expect(question !== null).assertTrue();
      expect(client.submitFeedback(handle.workflowId, { taskRunId: question.taskRunId,
        kind: question.kind, option: question.options[0] }).accepted).assertTrue();
      expect(client.getFeedbackAvailability(handle.workflowId).reason).assertEqual('ALREADY_ANSWERED');
      const next = client.submit<string, string>('generic-profiled', 'input', context()); await next.result;
      await next.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      expect(client.getFeedbackAvailability(next.workflowId).reason).assertEqual('CAPABILITY_DAILY_LIMIT');
    });

    it('availabilityDistinguishesRunningFailedAndBackgroundTasks', 0, async () => {
      register(); service.setFeedbackEnabled(true); executor.fail = true;
      const handle = client.submit<string, string>('generic-profiled', 'input', context());
      expect(client.getFeedbackAvailability(handle.workflowId).reason).assertEqual('WORKFLOW_NOT_READY');
      await handle.result;
      expect(client.getFeedbackAvailability(handle.workflowId).reason).assertEqual('TASK_NOT_SUCCESSFUL');
      service.updateRealDeviceState({ appVisibility: AppVisibility.BACKGROUND });
      expect(client.getFeedbackAvailability(handle.workflowId).reason).assertEqual('APP_BACKGROUND');
    });

    it('asksAboutToleranceBeforeUncertainQualityAndNeverAboutDeviceMetrics', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      const base: SchedulerLogEntry = service.getRecentLogs(1)[0];
      const questionKind = (log: SchedulerLogEntry): FeedbackKind => {
        const controller = new FeedbackController(); controller.setEnabled(true);
        return controller.request(log)!.kind;
      };
      const copy = (capability: string, thermal: ThermalLevel, missed: boolean): SchedulerLogEntry => {
        const log: SchedulerLogEntry = JSON.parse(JSON.stringify(base)) as SchedulerLogEntry;
        log.taskId = capability; log.capability = capability; log.deviceState.thermalLevel = thermal;
        log.telemetry!.feedbackRequest = undefined; log.telemetry!.softDeadlineMissed = missed;
        return log;
      };
      expect(questionKind(copy('thermal-profiled', ThermalLevel.HOT, true)))
        .assertEqual(FeedbackKind.RESPONSE_TIME);
      expect(questionKind(copy('slow-profiled', ThermalLevel.UNKNOWN, true)))
        .assertEqual(FeedbackKind.RESPONSE_TIME);
      expect(questionKind(copy('smoothness-profiled', ThermalLevel.NORMAL, false)))
        .assertEqual(FeedbackKind.RESULT_UTILITY);
      const unknown = copy('unknown-metrics', ThermalLevel.UNKNOWN, false);
      unknown.telemetry!.appExperience = undefined;
      const controller = new FeedbackController(); controller.setEnabled(true);
      expect(controller.request(unknown) === null).assertTrue();
      unknown.deviceState.thermalLevel = ThermalLevel.HOT;
      expect(controller.request(unknown) === null).assertTrue();
    });

    it('hostResponseObservationRaisesPriorityWithoutOverwritingExecutorTiming', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      const observation: AppExperienceObservation = { responseReadyMs: 1800 };
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: observation });
      observation.responseReadyMs = 0;
      const log = service.getRecentLogs(1)[0];
      expect(log.telemetry!.appExperience!.responseReadyMs).assertEqual(1800);
      expect(log.telemetry!.softDeadlineMissed).assertFalse();
      const question = client.getFeedbackRequest(handle.workflowId)!;
      expect(question.kind).assertEqual(FeedbackKind.RESPONSE_TIME);
      expect(question.selectionReason).assertEqual('SLOW_RESPONSE_ACCEPTABILITY_UNKNOWN');
      expect(question.priority).assertEqual(80);
    });

    it('knownHostObservationsSkipQuestionsWithoutUsingQuotaOrCreatingTrainingLabels', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const first = client.submit<string, string>('generic-profiled', 'input', context()); await first.result;
      await first.signal({ type: TaskSignalType.RESULT_DISPLAYED,
        experience: { responseReadyMs: 10, resultQualityUncertain: true, resultUseful: true } });
      expect(client.getFeedbackAvailability(first.workflowId).reason).assertEqual('NO_QUESTION_NEEDED');
      expect(client.getFeedbackRequest(first.workflowId) === null).assertTrue();
      expect(service.getRecentLogs(1)[0].telemetry!.userFeedback === undefined).assertTrue();
      const next = client.submit<string, string>('generic-profiled', 'input', context()); await next.result;
      await next.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      expect(client.getFeedbackRequest(next.workflowId)!.kind).assertEqual(FeedbackKind.RESULT_UTILITY);
    });

    it('invalidHostMeasurementsStayUnknownAndConsumptionIsNotAQualityLabel', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { responseReadyMs: -1 } });
      expect(service.getRecentLogs(1)[0].telemetry!.appExperience!.responseReadyMs === undefined).assertTrue();
      await handle.signal({ type: TaskSignalType.RESULT_CONSUMED,
        experience: { responseReadyMs: NaN, resultQualityUncertain: true } });
      const log = service.getRecentLogs(1)[0];
      expect(log.telemetry!.appExperience!.responseReadyMs === undefined).assertTrue();
      expect(log.telemetry!.appExperience!.resultQualityUncertain).assertTrue();
      expect(client.getFeedbackAvailability(handle.workflowId).reason).assertEqual('NO_QUESTION_NEEDED');
      expect(log.telemetry!.userFeedback === undefined).assertTrue();
    });

    it('feedbackDiagnosticsKeepIntervalDailyAndExpiryLimits', 0, async () => {
      register(); const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      const log = service.getRecentLogs(1)[0]; const controller = new FeedbackController();
      controller.setEnabled(true); const now = 20000 * 86400000 + 3600000;
      for (let i = 0; i < 10; i++) { expect(controller.inspect(log, now).reason).assertEqual('READY'); }
      expect(controller.request(log, now) !== null).assertTrue();
      expect(controller.inspect(log, now + 120001).reason).assertEqual('INVITATION_EXPIRED');
      log.telemetry!.feedbackRequest = undefined;
      expect(controller.inspect(log, now + 120001).reason).assertEqual('CAPABILITY_DAILY_LIMIT');
      log.capability = 'different-capability'; log.taskId = 'second';
      expect(controller.inspect(log, now + 120001).reason).assertEqual('INTERVAL_LIMIT');
      expect(controller.inspect(log, now + 120001).nextAllowedAtMs).assertEqual(now + 1800000);
      expect(controller.request(log, now + 1800000) !== null).assertTrue();
      log.telemetry!.feedbackRequest = undefined; log.capability = 'third-capability';
      log.telemetry!.softDeadlineMissed = true;
      expect(controller.inspect(log, now + 3600000).reason).assertEqual('DAILY_LIMIT');
      expect(controller.inspect(log, now + 86400000).reason).assertEqual('READY');
    });

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

    it('legacyPolicyModesDoNotOverrideManifestObservationBaseline', 0, async () => {
      register();
      await service.setPolicyMode(PolicyMode.FIXED_POWER_SAVING);
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
      await service.setPolicyMode(PolicyMode.FIXED_PERFORMANCE);
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
    });

    it('rejectsSerialFallbackEvenWhenReportedProfileFieldsMatch', 0, async () => {
      register(); executor.executionPath = 'serial_fallback';
      const result = await run();
      expect(result.status).assertEqual(TaskStatus.FAILED);
      expect(result.nodes[0].errorCode).assertEqual('EXECUTOR_PROFILE_MISMATCH');
      expect(service.getRecentLogs(1)[0].telemetry!.actual!.executionPath).assertEqual('serial_fallback');
      executor.executionPath = 'taskpool';
      expect((await run()).nodes[0].executionPlan.executionProfile!.id).assertEqual('SAFE');
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

    it('calibratedWeightsReachFutureUtilityWithoutChangingObserveExecution', 0, async () => {
      register(); const settings = config(ConstrainedPolicyMode.OBSERVE); settings.rules = [];
      service.configureConstrainedPolicy(settings);
      const policy = new ConstrainedPolicy(); policy.configure(settings);
      const task: TaskProfile = { capability: 'generic-profiled', taskType: TaskType.USER_INITIATED,
        inferenceLocation: InferenceLocation.LOCAL_DEVICE, accuracyPreference: AccuracyPreference.BALANCED,
        latencyBudgetMs: 3000, timeoutMs: 5000, allowDegrade: true, allowPause: false,
        template: declaration(), context: context() };
      const costs = new SemanticPolicy(); const state = service.getDeviceState();
      const before = policy.evaluate(task, state, costs);
      // Synthetic policy-level samples deliberately do not bypass the public UI quota.
      for (let index = 0; index < 2; index++) {
        await run(); const log = service.getRecentLogs(1)[0];
        policy.observe(task, log);
        log.telemetry!.userFeedback = { taskRunId: log.taskId, kind: FeedbackKind.RESPONSE_TIME, option: FeedbackOption.SLOW };
        const receipt = policy.feedback('generic-profiled', log);
        expect(receipt.effect).assertEqual(index === 0 ? 'COLLECTING' : 'CALIBRATED');
      }
      const after = policy.evaluate(task, state, costs);
      expect(after.policyAudit!.utility!.targetPressure > before.policyAudit!.utility!.targetPressure).assertTrue();
      expect(after.policyAudit!.utility!.feedbackPenalty).assertEqual(3);
      expect(after.executionProfile!.id).assertEqual(before.executionProfile!.id);
      expect(after.utilityScore).assertEqual(before.utilityScore);
      expect(after.priority).assertEqual(before.priority);
      expect(task.context!.targetLatencyMs).assertEqual(100);
    });
    it('feedbackReceiptLinksAnswerToCalibrationAndRejectsDuplicate', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'private-input', context());
      const result = await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      const request = client.getFeedbackRequest(handle.workflowId)!;
      const receipt = client.submitFeedback(handle.workflowId, { taskRunId: request.taskRunId,
        kind: request.kind, option: request.options[0] });
      expect(receipt.accepted).assertTrue(); expect(receipt.effect).assertEqual('COLLECTING');
      expect(receipt.after!.profileSamples).assertEqual(1);
      expect(receipt.after!.latencyWeight).assertEqual(5); expect(receipt.after!.qualityWeight).assertEqual(3);
      expect(result.nodes[0].executionPlan.executionProfile!.id).assertEqual('DEFAULT');
      const duplicate = client.submitFeedback(handle.workflowId, { taskRunId: request.taskRunId,
        kind: request.kind, option: request.options[0] });
      expect(duplicate.accepted).assertFalse();
      receipt.after!.latencyWeight = 999;
      expect(service.getRecentLogs(1)[0].telemetry!.feedbackReceipt!.after!.latencyWeight).assertEqual(5);
      expect(service.exportAudit().indexOf('private-input') < 0).assertTrue();
    });
    it('feedbackReceiptCannotCrossWorkflowOwnership', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      const request = client.getFeedbackRequest(handle.workflowId)!;
      const other = new SchedulerClient(service);
      const denied = other.submitFeedback(handle.workflowId, { taskRunId: request.taskRunId,
        kind: request.kind, option: request.options[0] });
      expect(denied.accepted).assertFalse(); await other.dispose();
      expect(service.getRecentLogs(1)[0].telemetry!.userFeedback === undefined).assertTrue();
    });
    it('feedbackReceiptRejectsRevokedConsentAndPageExit', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      const request = client.getFeedbackRequest(handle.workflowId)!;
      service.setFeedbackEnabled(false);
      expect(client.submitFeedback(handle.workflowId, { taskRunId: request.taskRunId,
        kind: request.kind, option: request.options[0] }).accepted).assertFalse();
      service.setFeedbackEnabled(true); await handle.signal({ type: TaskSignalType.PAGE_LEFT });
      expect(client.submitFeedback(handle.workflowId, { taskRunId: request.taskRunId,
        kind: request.kind, option: request.options[0] }).accepted).assertFalse();
    });
    it('reenablingConsentCannotResurrectAnOldInvitation', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      const request = client.getFeedbackRequest(handle.workflowId)!;
      service.setFeedbackEnabled(false); service.setFeedbackEnabled(true);
      expect(client.submitFeedback(handle.workflowId, { taskRunId: request.taskRunId,
        kind: request.kind, option: request.options[0] }).accepted).assertFalse();
    });
    it('ignoredResultInvalidatesOutstandingFeedback', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      const request = client.getFeedbackRequest(handle.workflowId)!;
      await handle.signal({ type: TaskSignalType.RESULT_IGNORED });
      expect(client.submitFeedback(handle.workflowId, { taskRunId: request.taskRunId,
        kind: request.kind, option: request.options[0] }).accepted).assertFalse();
    });
    it('oldVersionFeedbackIsRecordedWithoutTrainingNewVersion', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      const request = client.getFeedbackRequest(handle.workflowId)!;
      service.configureConstrainedPolicy(config());
      const receipt = client.submitFeedback(handle.workflowId, { taskRunId: request.taskRunId,
        kind: request.kind, option: request.options[0] });
      expect(receipt.accepted).assertTrue(); expect(receipt.effect).assertEqual('RECORDED_ONLY');
      expect(receipt.after === undefined).assertTrue();
    });
    it('feedbackNeedsOptInDisplayedResultAndValidOption', 0, async () => {
      register(); const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      expect(client.getFeedbackRequest(handle.workflowId) === null).assertTrue();
      service.setFeedbackEnabled(true);
      expect(client.getFeedbackRequest(handle.workflowId) === null).assertTrue();
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
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
      await first.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      expect(client.getFeedbackRequest(first.workflowId) !== null).assertTrue();
      await first.signal({ type: TaskSignalType.PAGE_LEFT }); expect(client.getFeedbackRequest(first.workflowId) === null).assertTrue();
      const second = client.submit<string, string>('generic-profiled', 'input', context()); await second.result;
      await second.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
      expect(client.getFeedbackRequest(second.workflowId) === null).assertTrue();
    });

    it('backgroundAndPreviewNeverAskForFeedback', 0, async () => {
      register(declaration(true)); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
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
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } }); const request = client.getFeedbackRequest(handle.workflowId)!;
      await handle.signal({ type: TaskSignalType.USER_FEEDBACK, feedback: {
        taskRunId: request.taskRunId, kind: request.kind, option: request.options[0] } });
      await handle.signal({ type: TaskSignalType.USER_FEEDBACK, feedback: {
        taskRunId: request.taskRunId, kind: request.kind, option: request.options[1] } });
      expect(service.getRecentLogs(1)[0].telemetry!.userFeedback!.option).assertEqual(request.options[0]);
    });

    it('backgroundVisibilityPreventsFeedback', 0, async () => {
      register(); service.setFeedbackEnabled(true);
      const handle = client.submit<string, string>('generic-profiled', 'input', context()); await handle.result;
      await handle.signal({ type: TaskSignalType.RESULT_DISPLAYED, experience: { resultQualityUncertain: true } });
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
