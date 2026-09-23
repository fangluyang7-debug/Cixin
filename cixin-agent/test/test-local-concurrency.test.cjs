const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../dist/scheduler');
const load = file => require(file.replace(/\.ets$/u, '.js'));
test('test-local-concurrency source regression', async () => {
const types = load(path.join(root, 'api/SchedulerTypes.ets'));
const { SchedulerService } = load(path.join(root, 'api/SchedulerService.ets'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function template(capability, concurrentSafe) {
  const level = { id: 'q', modelTier: types.ModelTier.HIGH_ACCURACY, estimatedLatencyMs: 10,
    estimatedMemoryMb: 16, relativeEnergyCost: 1, supportedBackends: [types.Backend.CPU],
    supportedThreadCounts: [1] };
  const profile = { id: 'P', qualityLevelId: 'q', modelTier: types.ModelTier.HIGH_ACCURACY,
    backend: types.Backend.CPU, workerCount: 1, allowWarmup: false, supportsForeground: true,
    supportsBackground: true, estimatedQualityLevel: types.ModelTier.HIGH_ACCURACY,
    safeUnderPressure: true, qualityValidated: true, lowRisk: true };
  return { capability, concurrentSafe, taskType: types.TaskType.USER_INITIATED,
    inferenceLocation: types.InferenceLocation.LOCAL_DEVICE, qualityLevels: [level],
    interruptibility: types.Interruptibility.NON_INTERRUPTIBLE,
    duplicatePolicy: types.DuplicatePolicy.KEEP_ALL, privacyPolicy: types.PrivacyPolicy.LOCAL_ONLY,
    resourceHints: { modelVersion: 'test-v1', baselineInputTokens: 1 }, timeoutMs: 3000,
    manifest: { defaultProfileId: 'P', fallbackProfileId: 'P', profiles: [profile], profileTransitions: [] } };
}

function request(capability, concurrentSafe) {
  return { taskId: `task-${capability}`, taskType: types.TaskType.USER_INITIATED,
    inferenceLocation: types.InferenceLocation.LOCAL_DEVICE, capability, input: capability,
    accuracyPreference: types.AccuracyPreference.QUALITY_FIRST, latencyBudgetMs: 3000,
    allowDegrade: false, allowPause: false, timeoutMs: 3000,
    template: template(capability, concurrentSafe), context: { userVisible: true, userWaiting: true,
      accuracyFloor: types.ModelTier.HIGH_ACCURACY, deadlineMs: 3000, inputTokens: 1 } };
}

async function scenario(concurrentSafe, protect = false, cpuWorkerBudget = 2) {
  const service = new SchedulerService();
  await service.initialize({ defaultPolicyMode: types.PolicyMode.ADAPTIVE, enableDebugInjection: false,
    metricsWindowSize: 100, upgradeStableDurationMs: 0, minimumTierHoldMs: 0,
    maxConcurrentLocalTasks: 2, cpuWorkerBudget, executors: [] });
  service.updateRealDeviceState({ batteryPercent: 80, isCharging: false,
    thermalLevel: types.ThermalLevel.NORMAL, memoryPressure: types.MemoryPressure.NORMAL,
    totalMemoryMb: 4096, freeMemoryMb: 2048, availableMemoryMb: 2048,
    systemCpuUsage: 0, appCpuUsage: 0, appVisibility: types.AppVisibility.FOREGROUND });
  const resolvers = [];
  let started = 0;
  for (const capability of ['a', 'b']) {
    service.registerExecutor({ capability, inferenceLocation: types.InferenceLocation.LOCAL_DEVICE,
      supports: () => true,
      execute: () => { started++; return new Promise(resolve => resolvers.push(() => resolve({
        output: capability, telemetry: { profileId: 'P', actualModelTier: types.ModelTier.HIGH_ACCURACY,
          actualBackend: types.Backend.CPU, actualThreads: 1, workerCount: 1 } }))); },
      dispose: async () => {} });
  }
  const a = await service.submitTask(request('a', concurrentSafe));
  const b = await service.submitTask(request('b', concurrentSafe));
  await delay(20);
  const initial = started;
  const running = service.getMetricsSnapshot().runningCount;
  if (protect) {
    service.updateRealDeviceState({ thermalLevel: types.ThermalLevel.CRITICAL });
    assert.equal(service.getMetricsSnapshot().runningCount, 2);
  }
  while (resolvers.length) resolvers.shift()();
  await delay(20);
  while (resolvers.length) resolvers.shift()();
  const outcomes = await Promise.all([a.result, b.result]);
  await service.shutdown();
  return { initial, running, outcomes };
}

const parallel = await scenario(true);
assert.equal(parallel.initial, 2);
assert.equal(parallel.running, 2);
assert.ok(parallel.outcomes.every(item => item.status === types.TaskStatus.SUCCEEDED));
process.stdout.write('PASS explicitly safe tasks share two bounded slots\n');
const exclusive = await scenario(false);
assert.equal(exclusive.initial, 1);
assert.equal(exclusive.running, 1);
assert.ok(exclusive.outcomes.every(item => item.status === types.TaskStatus.SUCCEEDED));
process.stdout.write('PASS default exclusive tasks remain serial\n');
const limited = await scenario(true, false, 1);
assert.equal(limited.initial, 1);
assert.ok(limited.outcomes.every(item => item.status === types.TaskStatus.SUCCEEDED));
process.stdout.write('PASS CPU worker budget blocks overlapping safe tasks\n');
const protectedPair = await scenario(true, true);
assert.ok(protectedPair.outcomes.every(item => item.status === types.TaskStatus.CANCELLED));
process.stdout.write('PASS critical device protection stops both running tasks\n');

const service = new SchedulerService();
await service.initialize({ defaultPolicyMode: types.PolicyMode.ADAPTIVE, enableDebugInjection: false,
  metricsWindowSize: 100, upgradeStableDurationMs: 0, minimumTierHoldMs: 0,
  maxConcurrentLocalTasks: 2, cpuWorkerBudget: 2, executors: [] });
service.updateRealDeviceState({ batteryPercent: 80, isCharging: false,
  thermalLevel: types.ThermalLevel.NORMAL, memoryPressure: types.MemoryPressure.NORMAL,
  totalMemoryMb: 4096, freeMemoryMb: 2048, availableMemoryMb: 2048,
  systemCpuUsage: 0, appCpuUsage: 0, appVisibility: types.AppVisibility.FOREGROUND });
let firstFinish;
let secondStart = 0;
service.registerExecutor({ capability: 'a', inferenceLocation: types.InferenceLocation.LOCAL_DEVICE,
  supports: () => true, execute: () => new Promise(resolve => { firstFinish = () => resolve({
    output: 'a', telemetry: { profileId: 'P', actualModelTier: types.ModelTier.HIGH_ACCURACY,
      actualBackend: types.Backend.CPU, actualThreads: 1, workerCount: 1 } }); }), dispose: async () => {} });
service.registerExecutor({ capability: 'b', inferenceLocation: types.InferenceLocation.LOCAL_DEVICE,
  supports: () => true, execute: async () => { secondStart++; return { output: 'b', telemetry: {
    profileId: 'P', actualModelTier: types.ModelTier.HIGH_ACCURACY,
    actualBackend: types.Backend.CPU, actualThreads: 1, workerCount: 1 } }; }, dispose: async () => {} });
const first = await service.submitTask(request('a', false));
const second = await service.submitTask(request('b', true));
await delay(20);
await first.cancel();
await delay(20);
assert.equal(secondStart, 0);
assert.equal(service.getMetricsSnapshot().runningCount, 1);
firstFinish();
await Promise.all([first.result, second.result]);
assert.equal(secondStart, 1);
await service.shutdown();
process.stdout.write('PASS cancellation does not release an unconfirmed running slot\n');

});
