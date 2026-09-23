const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '../dist/scheduler');
const load = file => require(file.replace(/\.ets$/u, '.js'));
test('test-placement source regression', async () => {
const types = load(path.join(root, 'api/SchedulerTypes.ets'));
const placement = load(path.join(root, 'placement/PlacementPolicy.ets'));
const now = 100000;
const task = () => ({ capability: 'encode', modelVersion: 'v1', taskSignature: 'encode:v1:2',
  deadlineMs: 500, userWaiting: true, qualityFloor: types.ModelTier.HIGH_ACCURACY,
  privacyPolicy: types.PrivacyPolicy.REMOTE_ALLOWED, networkAllowed: true, inputSanitized: false,
  requiredBackend: types.Backend.CPU, minimumMemoryMb: 50, inputBytes: 1000, outputBytes: 1000 });
const device = (deviceId, local, computeMs) => ({ deviceId, local,
  source: local ? placement.PlacementSource.REAL : placement.PlacementSource.MOCK,
  trusted: true, online: true, receivedAtMs: now, heartbeatAgeMs: 0, thermalAgeMs: 0,
  memoryAgeMs: 0, cpuAgeMs: 0, thermalLevel: types.ThermalLevel.NORMAL,
  memoryPressure: types.MemoryPressure.NORMAL, availableMemoryMb: 1000, cpuUsage: 20,
  availableBackends: [types.Backend.CPU], modelVersions: ['v1'], loadedModelVersions: ['v1'],
  queueWaitMs: 0, computeMs, coldLoadMs: 100 });
const link = () => ({ fromDeviceId: 'local', toDeviceId: 'tablet', receivedAtMs: now,
  sampleAgeMs: 0, rttMs: 10, bytesPerSecond: 1000000, protocolMs: 2 });
const decide = (request, remote, channel = link()) => new placement.GlobalPlacementPolicy().evaluate(
  request, 'local', [device('local', true, 200), remote], [channel], placement.PlacementMode.SHADOW, now);

let count = 0;
const check = (name, fn) => { fn(); count++; process.stdout.write(`PASS ${name}\n`); };
check('shadow never dispatches', () => {
  const answer = decide(task(), device('tablet', false, 30));
  assert.equal(answer.suggestedDeviceId, 'tablet');
  assert.equal(answer.actualDeviceId, 'local');
  assert.equal(answer.dispatchAllowed, false);
});
check('privacy and network permission are hard constraints', () => {
  const request = task(); request.privacyPolicy = types.PrivacyPolicy.LOCAL_ONLY;
  assert.equal(decide(request, device('tablet', false, 30)).suggestedDeviceId, 'local');
  request.privacyPolicy = types.PrivacyPolicy.SANITIZED_REMOTE;
  assert.equal(decide(request, device('tablet', false, 30)).suggestedDeviceId, 'local');
  request.inputSanitized = true; request.networkAllowed = false;
  assert.equal(decide(request, device('tablet', false, 30)).suggestedDeviceId, 'local');
});
check('field TTL is independent of heartbeat', () => {
  const remote = device('tablet', false, 30); remote.memoryAgeMs = 3001;
  assert.equal(decide(task(), remote).suggestedDeviceId, 'local');
});
check('network and cold load can outweigh compute', () => {
  const remote = device('tablet', false, 30); remote.loadedModelVersions = []; remote.coldLoadMs = 200;
  const answer = decide(task(), remote);
  assert.equal(answer.suggestedDeviceId, 'local');
  assert.equal(answer.estimates.find(item => item.deviceId === 'tablet').modelLoadMs, 200);
});
check('stale link is excluded', () => {
  const channel = link(); channel.sampleAgeMs = 3001;
  assert.equal(decide(task(), device('tablet', false, 30), channel).suggestedDeviceId, 'local');
});
check('local-only mode ignores remote', () => {
  const answer = new placement.GlobalPlacementPolicy().evaluate(task(), 'local',
    [device('local', true, 200), device('tablet', false, 30)], [link()], placement.PlacementMode.LOCAL_ONLY, now);
  assert.equal(answer.estimates.length, 1);
});
check('missing local estimate never causes remote dispatch', () => {
  const answer = new placement.GlobalPlacementPolicy().evaluate(task(), 'local',
    [device('tablet', false, 30)], [link()], placement.PlacementMode.SHADOW, now);
  assert.equal(answer.dispatchAllowed, false);
  assert.equal(answer.suggestedDeviceId, 'local');
});
check('injected local state keeps a mock provenance label', () => {
  const state = { source: types.DeviceStateSource.INJECTED, sampledAt: {},
    thermalLevel: types.ThermalLevel.NORMAL, memoryPressure: types.MemoryPressure.NORMAL,
    availableMemoryMb: 1000, systemCpuUsage: 10, availableBackends: [types.Backend.CPU] };
  const profile = placement.localDeviceProfile('local', state, ['v1'], [], 40, 50, now);
  assert.equal(profile.source, placement.PlacementSource.MOCK);
  assert.deepEqual(profile.loadedModelVersions, []);
});
check('only confirmed real execution trains placement costs', () => {
  const policy = new placement.GlobalPlacementPolicy();
  const sample = { taskSignature: task().taskSignature, modelVersion: 'v1', deviceId: 'tablet',
    modelWasLoaded: true, source: placement.PlacementSource.MOCK, actualConfirmed: true,
    queueMs: 0, modelLoadMs: 0, computeMs: 10 };
  for (let i = 0; i < 3; i++) policy.observe(sample);
  let answer = policy.evaluate(task(), 'local', [device('local', true, 200),
    device('tablet', false, 100)], [link()], placement.PlacementMode.SHADOW, now);
  assert.equal(answer.estimates.find(item => item.deviceId === 'tablet').computeMs, 100);
  sample.source = placement.PlacementSource.REAL;
  for (let i = 0; i < 3; i++) policy.observe(sample);
  answer = policy.evaluate(task(), 'local', [device('local', true, 200),
    device('tablet', false, 100)], [link()], placement.PlacementMode.SHADOW, now);
  assert.equal(answer.estimates.find(item => item.deviceId === 'tablet').computeMs, 10);
  assert.equal(answer.dispatchAllowed, false);
});
process.stdout.write(`${count} placement checks passed\n`);

});
