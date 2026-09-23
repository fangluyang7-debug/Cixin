const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { LinuxBoardAdapter } = require('../dist/platform/linux-board');
const { processWorkerTool } = require('../dist/plugins/process-worker');
const { vectorSearchTool } = require('../dist/plugins/vector-search');
const { CancellationController } = require('../dist/scheduler/executor/CancellationController');
const { AdaptiveCostModel } = require('../dist/scheduler/policy/AdaptiveCostModel');
const { acquireProcessLock } = require('../dist/runtime/process-lock');
const { temporary, cleanup, config, types } = require('./helpers.cjs');

test('host adapter reports real CPU/memory and keeps unavailable sensors unknown', async t => {
  const directory = temporary(); t.after(() => cleanup(directory));
  const adapter = await LinuxBoardAdapter.create(config('host', directory));
  const first = await adapter.sample(); assert.equal(first.batteryPercent, null);
  assert.equal(first.batteryApplicable, false); assert.equal(first.thermalLevel, types.ThermalLevel.UNKNOWN);
  assert.deepEqual(first.availableBackends, [types.Backend.CPU]);
  assert.ok(first.totalMemoryMb > 0 && first.availableMemoryMb > 0);
  const sensor = path.join(directory, 'temperature'); fs.writeFileSync(sensor, '90000');
  const withSensor = await LinuxBoardAdapter.create({ ...config('host', directory), thermal: {
    path: sensor, warmC: 60, hotC: 70, criticalC: 85 } });
  assert.equal((await withSensor.sample()).thermalLevel, types.ThermalLevel.CRITICAL);
  if (process.platform !== 'linux' || process.arch !== 'arm64')
    await assert.rejects(LinuxBoardAdapter.create({ ...config('host', directory), family: 'cix', boardModel: 'CIX P1' }), /LINUX_ARM64/);
});
function workerFixture(t, args = []) {
  const directory = temporary(); t.after(() => cleanup(directory));
  const model = path.join(directory, 'test-model.bin'); fs.writeFileSync(model, 'test-fixture-not-a-real-model');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(model)).digest('hex');
  const sample = vectorSearchTool();
  const manifest = { protocolVersion: 1, descriptor: sample.descriptor, template: sample.template,
    model: { path: 'test-model.bin', sha256 }, runtime: { name: 'test-cpu', version: '1' } };
  const manifestPath = path.join(directory, 'manifest.json'); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const config = { manifestPath, command: process.execPath, args: [path.join(__dirname, 'fixtures/worker.cjs'), ...args] };
  return { tool: processWorkerTool(config), manifest, model };
}
test('worker verifies on-disk model, runtime and actual execution receipt', async t => {
  const { tool, manifest, model } = workerFixture(t);
  assert.equal((await tool.probe()).available, true);
  const signal = new CancellationController().signal;
  const result = await tool.executor.execute({ value: 42 }, { executionProfile: manifest.template.manifest.profiles[0] }, signal);
  assert.equal(result.output.echo.value, 42); assert.equal(result.telemetry.actualBackend, 'CPU');
  fs.writeFileSync(model, 'replaced-model'); assert.equal((await tool.probe()).available, false);
});
test('wrong backend probes stay unavailable and process cancellation waits for child exit', async t => {
  assert.equal((await workerFixture(t, ['--wrong-backend']).tool.probe()).available, false);
  const { tool, manifest } = workerFixture(t); const cancel = new CancellationController();
  const promise = tool.executor.execute({ wait: true }, { executionProfile: manifest.template.manifest.profiles[0] }, cancel.signal);
  setTimeout(() => cancel.cancel(), 50);
  await assert.rejects(promise, /TASK_CANCELLED/);
});
test('cost samples stay isolated across board kernel/runtime environments', () => {
  const model = new AdaptiveCostModel(); const tool = vectorSearchTool();
  const profile = tool.template.manifest.profiles[0]; const level = tool.template.qualityLevels[0];
  const state = { thermalLevel: types.ThermalLevel.NORMAL, memoryPressure: types.MemoryPressure.NORMAL,
    systemCpuUsage: 0, source: types.DeviceStateSource.REAL };
  const task = { capability: tool.descriptor.toolId, template: tool.template, context: {}, metadata: { environmentKey: 'p1-kernel-a' } };
  for (let i = 0; i < 5; i++) model.observe(task, state, profile, 2);
  assert.equal(model.predict(task, state, profile, level).sampleCount, 5);
  assert.equal(model.predict({ ...task, metadata: { environmentKey: 'p1-kernel-b' } }, state, profile, level).sampleCount, 0);
});
test('one data directory cannot be admitted by two live processes', t => {
  const directory = temporary(); t.after(() => cleanup(directory));
  const lock = path.join(directory, 'runtime.lock'); const release = acquireProcessLock(lock);
  assert.throws(() => acquireProcessLock(lock), /ALREADY_IN_USE/); release();
  const again = acquireProcessLock(lock); again();
});
