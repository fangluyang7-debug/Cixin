import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(import.meta.dirname, '../apps/harmony/scheduler/src/main/ets');
const cache = new Map();

function load(file) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const source = fs.readFileSync(resolved, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: resolved, reportDiagnostics: true
  });
  const errors = (result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: fileName => fileName, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'
  }));
  const module = { exports: {} };
  cache.set(resolved, module);
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) throw new Error(`Unexpected import: ${specifier}`);
    return load(path.resolve(path.dirname(resolved), `${specifier}.ets`));
  };
  vm.runInThisContext(`(function(require,module,exports){${result.outputText}\n})`, { filename: resolved })(
    localRequire, module, module.exports);
  return module.exports;
}

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
process.stdout.write(`${count} placement checks passed\n`);
