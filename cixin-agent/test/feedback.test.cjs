const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../dist/scheduler');
const load = file => require(file.replace(/\.ets$/u, '.js'));

// A step participates in the experience question when it can adjust scheduling parameters, not only
// when it succeeds. A user who waits too long and leaves must still be asked about the wait.
test('feedback asks about the wait without requiring success', async () => {
  const types = load(path.join(root, 'api/SchedulerTypes.ets'));
  const { SchedulerService } = load(path.join(root, 'api/SchedulerService.ets'));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function template(capability) {
    const level = { id: 'q', modelTier: types.ModelTier.HIGH_ACCURACY, estimatedLatencyMs: 10,
      estimatedMemoryMb: 16, relativeEnergyCost: 1, supportedBackends: [types.Backend.CPU],
      supportedThreadCounts: [1] };
    const profile = { id: 'P', qualityLevelId: 'q', modelTier: types.ModelTier.HIGH_ACCURACY,
      backend: types.Backend.CPU, workerCount: 1, allowWarmup: false, supportsForeground: true,
      supportsBackground: true, estimatedQualityLevel: types.ModelTier.HIGH_ACCURACY,
      safeUnderPressure: true, qualityValidated: true, lowRisk: true };
    return { capability, concurrentSafe: false, taskType: types.TaskType.USER_INITIATED,
      inferenceLocation: types.InferenceLocation.LOCAL_DEVICE, qualityLevels: [level],
      interruptibility: types.Interruptibility.NON_INTERRUPTIBLE,
      duplicatePolicy: types.DuplicatePolicy.KEEP_ALL, privacyPolicy: types.PrivacyPolicy.LOCAL_ONLY,
      resourceHints: { modelVersion: 'test-v1', baselineInputTokens: 1 }, timeoutMs: 3000,
      manifest: { defaultProfileId: 'P', fallbackProfileId: 'P', profiles: [profile], profileTransitions: [] } };
  }
  function request(capability, taskId) {
    return { taskId, taskType: types.TaskType.USER_INITIATED,
      inferenceLocation: types.InferenceLocation.LOCAL_DEVICE, capability, input: capability,
      accuracyPreference: types.AccuracyPreference.QUALITY_FIRST, latencyBudgetMs: 3000,
      allowDegrade: false, allowPause: false, timeoutMs: 3000, template: template(capability),
      context: { userVisible: true, userWaiting: true, accuracyFloor: types.ModelTier.HIGH_ACCURACY,
        deadlineMs: 3000, inputTokens: 1 } };
  }
  const executor = capability => ({ capability, inferenceLocation: types.InferenceLocation.LOCAL_DEVICE,
    supports: () => true, dispose: async () => {} });
  const telemetry = () => ({ profileId: 'P', actualModelTier: types.ModelTier.HIGH_ACCURACY,
    actualBackend: types.Backend.CPU, actualThreads: 1, workerCount: 1 });

  const service = new SchedulerService();
  await service.initialize({ defaultPolicyMode: types.PolicyMode.ADAPTIVE, enableDebugInjection: false,
    metricsWindowSize: 100, upgradeStableDurationMs: 0, minimumTierHoldMs: 0,
    maxConcurrentLocalTasks: 2, cpuWorkerBudget: 2, executors: [] });
  service.updateRealDeviceState({ batteryPercent: 80, isCharging: false,
    thermalLevel: types.ThermalLevel.NORMAL, memoryPressure: types.MemoryPressure.NORMAL,
    totalMemoryMb: 4096, freeMemoryMb: 2048, availableMemoryMb: 2048,
    systemCpuUsage: 0, appCpuUsage: 0, appVisibility: types.AppVisibility.FOREGROUND });
  service.setFeedbackEnabled(true);
  try {
    let finish;
    service.registerExecutor({ ...executor('wait'), execute: () => new Promise(resolve => { finish = () => resolve({
      output: 'wait', telemetry: telemetry() }); }) });
    const handle = await service.submitTask(request('wait', 'task-wait'));
    await delay(20);
    await service.signalTask('task-wait', { type: types.TaskSignalType.PAGE_LEFT });
    finish();
    assert.equal((await handle.result).status, types.TaskStatus.CANCELLED);

    assert.equal(service.getFeedbackAvailability('task-wait').eligible, true);
    const question = service.getFeedbackRequest('task-wait');
    assert.ok(question, 'a cancelled step that can adjust scheduling parameters must be asked');
    assert.equal(question.kind, types.FeedbackKind.RESPONSE_TIME);
    assert.equal(question.selectionReason, 'NO_RESULT_ACCEPTABILITY_UNKNOWN');
    assert.equal(question.suggestedAfter, 'NEXT_IDLE');
    assert.ok(question.options.includes(types.FeedbackOption.NO_RESULT));
    process.stdout.write('PASS cancelled step is asked about the wait instead of being blocked\n');

    const receipt = service.submitFeedback({ taskRunId: 'task-wait', kind: question.kind,
      option: types.FeedbackOption.NO_RESULT });
    assert.equal(receipt.accepted, true);
    // Wait feedback calibrates speed even when a cancellation stopped the run before the profile was confirmed.
    assert.equal(receipt.effect, 'COLLECTING');
    process.stdout.write('PASS wait answer enters bounded speed calibration without a confirmed profile\n');

    service.registerExecutor({ ...executor('quick'), execute: async () => ({ output: 'quick', telemetry: telemetry() }) });
    const quick = await service.submitTask(request('quick', 'task-quick'));
    assert.equal((await quick.result).status, types.TaskStatus.SUCCEEDED);
    await service.signalTask('task-quick', { type: types.TaskSignalType.RESULT_DISPLAYED });
    assert.equal(service.getFeedbackAvailability('task-quick').reason, 'NO_QUESTION_NEEDED');
    process.stdout.write('PASS a clean fast success still asks nothing\n');
  } finally {
    await service.shutdown();
  }
});
