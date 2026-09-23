const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BoardNode, attemptKey } = require('../dist/runtime/board-node');
const { ToolRegistry } = require('../dist/runtime/tool-registry');
const { vectorSearchTool } = require('../dist/plugins/vector-search');
const { byteLength } = require('../dist/runtime/util');
const types = require('../dist/scheduler/api/SchedulerTypes');

const input = { query: [1, 0], vectors: [{ id: 'first', values: [1, 0] }, { id: 'second', values: [0, 1] }], limit: 1 };
const task = constraints => ({ toolId: 'catalog.vector_search', input: structuredClone(input), constraints });
function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cixin-agent-test-')); }
function cleanup(directory) {
  const absolute = path.resolve(directory);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith('cixin-agent-test-'))
    throw new Error('Unsafe test cleanup target');
  fs.rmSync(absolute, { recursive: true, force: true });
}
function config(deviceId, directory) {
  return { deviceId, family: 'host', host: '127.0.0.1', port: 0, tokenEnv: 'CIXIN_TEST_TOKEN', dataDir: directory,
    mode: 'ACTIVE', minRemoteSamples: 0, maxConcurrentLocalTasks: 1, cpuWorkerBudget: 2,
    maxPendingTasks: 16, peers: [] };
}
function adapter(deviceId) {
  // A deterministic test fixture, never presented as hardware measurements.
  return { identity: { deviceId, family: 'host', model: 'TEST_FIXTURE', os: 'test', arch: 'test', kernel: 'test',
    runtime: 'test', environmentKey: `fixture-${deviceId}` },
    patch: { batteryApplicable: false, batteryPercent: null, isCharging: null,
      thermalLevel: types.ThermalLevel.NORMAL, memoryPressure: types.MemoryPressure.NORMAL,
      totalMemoryMb: 4096, freeMemoryMb: 2048, availableMemoryMb: 2048,
      systemCpuUsage: 0, appCpuUsage: 0, appVisibility: types.AppVisibility.FOREGROUND, availableBackends: [types.Backend.CPU] },
    async sample() { return { ...this.patch }; } };
}
async function makeNode(t, id = 'local', changeTool = () => {}, overrides = {}) {
  const directory = temporary();
  const registry = new ToolRegistry(); const tool = vectorSearchTool(); changeTool(tool); registry.register(tool);
  const node = new BoardNode({ ...config(id, directory), ...overrides }, adapter(id), registry);
  await node.start();
  t.after(async () => { await node.close(); cleanup(directory); });
  return node;
}
function request(node, overrides = {}) {
  const info = node.registry.info('catalog.vector_search');
  return { toolId: info.descriptor.toolId, contractDigest: info.contractDigest, modelDigest: info.modelDigest,
    constraints: { deadlineMs: 10000, allowRemote: true }, remainingMs: 10000, inputBytes: byteLength(input),
    originDeviceId: node.config.deviceId, epoch: 'epoch-1', attemptId: 'attempt-1',
    targetDeviceId: node.config.deviceId, bootId: node.bootId, input: structuredClone(input), ...overrides };
}
async function completed(node, key) {
  for (let i = 0; i < 500; i++) {
    const result = node.get(key);
    if (result && !['accepted', 'running'].includes(result.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Attempt did not finish');
}
module.exports = { input, task, temporary, cleanup, config, adapter, makeNode, request, completed, attemptKey, types };
