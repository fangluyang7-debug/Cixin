const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../dist/scheduler');
const load = file => require(file.replace(/\.ets$/u, '.js'));
test('test-local-algorithm source regression', async () => {
const types = load(path.join(root, 'api/SchedulerTypes.ets'));
const { AdaptiveCostModel } = load(path.join(root, 'policy/AdaptiveCostModel.ets'));
const { SemanticPolicy } = load(path.join(root, 'policy/SemanticPolicy.ets'));
const { ConstrainedPolicy } = load(path.join(root, 'policy/ConstrainedPolicy.ets'));
const { planWorkflowCosts, workflowUrgencyBonus, estimatedWorkflowCompletion } =
  load(path.join(root, 'policy/WorkflowPlanner.ets'));
const { marginalAccelerationBonus } = load(path.join(root, 'policy/MarginalAllocation.ets'));
const { InterferenceModel } = load(path.join(root, 'policy/InterferenceModel.ets'));

let count = 0;
const check = (name, fn) => { fn(); count++; process.stdout.write(`PASS ${name}\n`); };
const dag = [
  { id: 'start', dependsOn: [] }, { id: 'long', dependsOn: ['start'] },
  { id: 'short', dependsOn: ['start'] }, { id: 'join', dependsOn: ['long', 'short'] }
];
check('critical path and current serialized work stay distinct', () => {
  const plan = planWorkflowCosts(dag, { start: 2, long: 40, short: 10, join: 5 });
  assert.equal(plan[0].criticalPathMs, 47);
  assert.equal(plan[0].serialRemainingMs, 57);
  assert.equal(plan[2].serialRemainingMs, 15);
});
check('workflow urgency rises as budget shrinks', () => {
  assert.ok(workflowUrgencyBonus(100, 80, 10, 40) > workflowUrgencyBonus(100, 0, 10, 40));
  assert.equal(workflowUrgencyBonus(undefined, 0, 10, 40), 0);
});
check('remaining serial work contributes to deadline feasibility', () => {
  assert.equal(estimatedWorkflowCompletion({ workflowRemainingSerialMs: 75,
    workflowCurrentNodeEstimateMs: 40 }, 60), 95);
  assert.equal(estimatedWorkflowCompletion({}, 60), 60);
});

const state = { thermalLevel: types.ThermalLevel.NORMAL, memoryPressure: types.MemoryPressure.NORMAL,
  systemCpuUsage: 0, source: types.DeviceStateSource.REAL };
const fast = { id: 'FAST', qualityLevelId: 'q', workerCount: 2, backend: types.Backend.CPU,
  modelTier: types.ModelTier.HIGH_ACCURACY, estimatedQualityLevel: types.ModelTier.HIGH_ACCURACY,
  supportsForeground: true, supportsBackground: true, safeUnderPressure: true,
  qualityValidated: true, lowRisk: false, allowWarmup: false };
const slow = { ...fast, id: 'SLOW', workerCount: 1 };
const level = { id: 'q', estimatedLatencyMs: 100, estimatedMemoryMb: 32, relativeEnergyCost: 1 };
const task = { capability: 'encode', submittedAt: Date.now(), context: {
  inputTokens: 32, accuracyFloor: types.ModelTier.HIGH_ACCURACY, deadlineMs: 3000 },
template: { resourceHints: { modelVersion: 'v1', baselineInputTokens: 32 },
  manifest: { defaultProfileId: 'FAST', profiles: [fast, slow] } } };
check('worker prior is cautious and not linear speedup', () => {
  const model = new AdaptiveCostModel();
  const a = model.predict(task, state, fast, level);
  const b = model.predict(task, state, slow, level);
  assert.ok(b.latencyMs > a.latencyMs);
  assert.ok(b.latencyMs < a.latencyMs * 2);
  assert.equal(a.p95LatencyMs, undefined);
});
check('actual samples calibrate only their exact profile', () => {
  const model = new AdaptiveCostModel();
  for (let i = 0; i < 20; i++) model.observe(task, state, fast, 20);
  const trained = model.predict(task, state, fast, level);
  const untrained = model.predict(task, state, slow, level);
  assert.equal(trained.sampleCount, 20);
  assert.equal(trained.p95LatencyMs, 20);
  assert.ok(trained.latencyMs < untrained.latencyMs);
  model.observe(task, state, fast, -1);
  assert.equal(model.predict(task, state, fast, level).sampleCount, 20);
});
check('marginal gain needs measured compatible profiles', () => {
  const baseline = { ...fast, qualityValidated: true };
  const alternative = { ...slow, qualityValidated: true, workerCount: 4 };
  const measured = { latencyMs: 100, sampleCount: 10 };
  const better = { latencyMs: 60, sampleCount: 10 };
  assert.ok(marginalAccelerationBonus(baseline, measured, alternative, better, 100) > 0);
  assert.equal(marginalAccelerationBonus(baseline, measured, alternative,
    { ...better, sampleCount: 0 }, 100), 0);
  assert.equal(marginalAccelerationBonus(baseline, measured,
    { ...alternative, qualityValidated: false }, better, 100), 0);
});
check('new cost model feeds the existing constrained policy safely', () => {
  const profile = { ...task, taskType: types.TaskType.USER_INITIATED,
    inferenceLocation: types.InferenceLocation.LOCAL_DEVICE, allowDegrade: false,
    allowPause: false, timeoutMs: 3000 };
  profile.context = { ...task.context, userVisible: true, userWaiting: true,
    workflowRemainingSerialMs: 75, workflowCurrentNodeEstimateMs: 40 };
  profile.template = { ...task.template, capability: 'encode', interruptibility: types.Interruptibility.NON_INTERRUPTIBLE,
    qualityLevels: [level], manifest: { ...task.template.manifest, fallbackProfileId: 'FAST',
      profileTransitions: [] } };
  level.modelTier = types.ModelTier.HIGH_ACCURACY;
  const current = { ...state, batteryPercent: 80, isCharging: false,
    appVisibility: types.AppVisibility.FOREGROUND, availableMemoryMb: 2048,
    availableBackends: [types.Backend.CPU], observations: [] };
  const plan = new ConstrainedPolicy().evaluate(profile, current, new SemanticPolicy());
  assert.equal(plan.executionProfile.id, 'FAST');
  assert.equal(plan.queueAction, types.QueueAction.ENQUEUE);
  assert.equal(plan.prediction.source, 'PROFILE_PRIOR_UNCALIBRATED');
});
check('remote cloud quality is not downgraded by local device pressure', () => {
  const remoteLevel = { id: 'cloud', modelTier: types.ModelTier.HIGH_ACCURACY,
    estimatedLatencyMs: 100, estimatedMemoryMb: 32, relativeEnergyCost: 1,
    supportedBackends: [types.Backend.CPU], supportedThreadCounts: [1] };
  const profile = { taskType: types.TaskType.USER_INITIATED,
    inferenceLocation: types.InferenceLocation.REMOTE_CLOUD, capability: 'product_search',
    accuracyPreference: types.AccuracyPreference.QUALITY_FIRST, latencyBudgetMs: 3000,
    allowDegrade: false, allowPause: false, timeoutMs: 3000,
    remoteOptions: { provider: 'cloud-shopping-api', maxRetries: 0, maxConcurrency: 1, allowLocalFallback: false },
    context: { userVisible: true, userWaiting: true, accuracyFloor: types.ModelTier.HIGH_ACCURACY,
      deadlineMs: 3000, freshnessMs: 3000, networkAllowed: true, highQuality: true },
    template: { capability: 'product_search', taskType: types.TaskType.USER_INITIATED,
      inferenceLocation: types.InferenceLocation.REMOTE_CLOUD, privacyPolicy: types.PrivacyPolicy.REMOTE_ALLOWED,
      qualityLevels: [remoteLevel], resourceHints: { modelVersion: 'zeabur-shopping-workflow-v1' } } };
  const pressured = { batteryApplicable: false, batteryPercent: null, isCharging: null,
    thermalLevel: types.ThermalLevel.HOT, memoryPressure: types.MemoryPressure.HIGH,
    appVisibility: types.AppVisibility.FOREGROUND, recentLatencyMs: null, queueDepth: 0,
    systemCpuUsage: 90, appCpuUsage: null, totalMemoryMb: 4096, freeMemoryMb: 256,
    availableMemoryMb: 256, availableBackends: [], source: types.DeviceStateSource.REAL,
    capturedAt: Date.now() };
  const plan = new SemanticPolicy().evaluate(profile, pressured, types.PolicyMode.ADAPTIVE);
  assert.equal(plan.queueAction, types.QueueAction.ENQUEUE);
  assert.equal(plan.qualityLevelId, 'cloud');
  pressured.thermalLevel = types.ThermalLevel.CRITICAL;
  assert.equal(new SemanticPolicy().evaluate(profile, pressured, types.PolicyMode.ADAPTIVE).queueAction,
    types.QueueAction.REJECT);
});
check('interference waits for solo baselines and learns a pair', () => {
  const model = new InterferenceModel();
  model.observe('a:v1:P', 'b:v1:P', 200, 100, 0);
  assert.equal(model.slowdown('a:v1:P', 'b:v1:P'), null);
  for (let i = 0; i < 3; i++) model.observe('a:v1:P', 'b:v1:P', 200, 100, 5);
  assert.equal(model.slowdown('b:v1:P', 'a:v1:P'), 2);
});
process.stdout.write(`${count} local algorithm checks passed\n`);

});
