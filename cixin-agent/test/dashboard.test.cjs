const assert = require('node:assert/strict');
const test = require('node:test');
const { FleetRuntime } = require('../dist/runtime/fleet-runtime');
const { dashboardReader } = require('../dist/runtime/dashboard');
const { serve } = require('../dist/runtime/http-server');
const { makeNode, task, types } = require('./helpers.cjs');

async function consoleServer(t, runtime) {
  const token = 'dashboard-test-token-at-least-24-chars';
  const server = await serve(runtime, token, '127.0.0.1', 0);
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } };
}

test('console serves offline assets without exposing authenticated runtime APIs or arbitrary files', async t => {
  const node = await makeNode(t);
  const { url, headers } = await consoleServer(t, new FleetRuntime(node));
  for (const path of ['/dashboard/', '/demo/', '/console.css', '/dashboard.js', '/demo.js', '/client.js']) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    const asset = await response.text();
    assert.doesNotMatch(asset, /Math\.random|startSimulation|jitterValue|https:\/\/fonts/);
  }
  assert.equal((await fetch(`${url}/api/v1/runtime/dashboard`)).status, 401);
  assert.equal((await fetch(`${url}/config/host.example.json`, { headers })).status, 404);
  assert.equal((await fetch(`${url}/__proto__`, { headers })).status, 404);
  assert.equal((await fetch(`${url}/api/v1/runtime/tasks`, { method: 'POST', body: '{}' })).status, 401);
});

test('App HTTP submission reaches execution and the dashboard reports measured receipts without business payloads', async t => {
  const node = await makeNode(t);
  const runtime = new FleetRuntime(node);
  const { url, headers } = await consoleServer(t, runtime);
  const submission = task(); submission.input.vectors[0].id = 'private-product-output';
  const response = await fetch(`${url}/api/v1/runtime/tasks`, { method: 'POST', headers, body: JSON.stringify(submission) });
  assert.equal(response.status, 202);
  const run = await response.json(); const done = await runtime.wait(run.runId);
  assert.equal(done.status, 'completed');
  const appResponse = await fetch(`${url}/api/v1/runtime/runs/${run.runId}`, { headers });
  assert.equal((await appResponse.json()).result.result.output[0].id, 'private-product-output');
  const dashboard = await (await fetch(`${url}/api/v1/runtime/dashboard`, { headers })).json();
  const displayed = dashboard.runs.find(value => value.runId === run.runId);
  assert.equal(displayed.status, done.status);
  assert.equal(displayed.targetDeviceId, node.config.deviceId);
  assert.equal(displayed.result.result.executionDurationMs, done.result.result.executionDurationMs);
  assert.equal(displayed.result.result.plan.actualConfirmed, true);
  assert.equal(dashboard.scheduler.taskCount, 1);
  assert.equal(dashboard.storage.cloudDatabase, 'not-configured');
  assert.doesNotMatch(JSON.stringify(dashboard), /private-product-output|"output"|"query"|"vectors"|dashboard-test-token/);
});

test('dashboard retains unknown resources and does not turn rejected path placeholders into measured zeros', async t => {
  const node = await makeNode(t); node.adapter.patch.thermalLevel = types.ThermalLevel.UNKNOWN;
  node.adapter.patch.systemCpuUsage = null;
  node.adapter.patch.availableMemoryMb = 50;
  const runtime = new FleetRuntime(node);
  const run = runtime.submit(task()); await runtime.wait(run.runId);
  const snapshot = await dashboardReader(runtime)();
  const local = snapshot.nodes[0].snapshot;
  assert.equal(local.state.systemCpuUsage, null);
  assert.equal(local.state.thermalLevel, 'UNKNOWN');
  assert.ok(local.missingCapabilities.includes('NOE_NPU_WORKER_NOT_CONFIGURED'));
  assert.equal(snapshot.runs[0].status, 'blocked');
  assert.equal(snapshot.runs[0].decision.candidates[0].accepted, false);
  assert.equal(snapshot.runs[0].decision.candidates[0].totalMs, null);
  assert.equal(snapshot.runs[0].decision.candidates[0].transferMs, null);
});

test('remote snapshot failures remain explicit, peers are validated, and concurrent observers share one read', async t => {
  const node = await makeNode(t);
  node.config.peers = ['good', 'failed', 'wrong'].map(deviceId => ({ deviceId, url: 'http://127.0.0.1:1', tokenEnv: 'TEST', bytesPerSecond: 1 }));
  let reads = 0;
  const snapshot = await node.snapshot();
  const runtime = new FleetRuntime(node, { snapshot: async peer => {
    reads++;
    if (peer.deviceId === 'failed') throw new Error('PEER_HTTP_503');
    return { ...snapshot, identity: { ...snapshot.identity, deviceId: peer.deviceId === 'wrong' ? 'other' : peer.deviceId } };
  } });
  const read = dashboardReader(runtime);
  const values = await Promise.all([read(), read(), read()]);
  assert.equal(reads, 3);
  assert.strictEqual(values[0], values[1]);
  assert.equal(values[0].nodes.find(item => item.deviceId === 'good').status, 'observed');
  for (const id of ['failed', 'wrong']) {
    const item = values[0].nodes.find(item => item.deviceId === id);
    assert.equal(item.status, 'unavailable'); assert.equal(item.snapshot, null);
  }
  assert.equal(values[0].nodes.find(item => item.deviceId === 'wrong').error, 'INVALID_NODE_SNAPSHOT');
  assert.equal(runtime.runs.all().length, 0);
  assert.equal(node.attempts.all().length, 0);
});

test('DAG telemetry includes dependencies but strips graph goals, input references and nested outputs', async t => {
  const node = await makeNode(t); const runtime = new FleetRuntime(node);
  const graph = { graphId: 'test-graph', goal: 'private-goal', nodes: [
    { taskId: 'first-step', toolId: 'catalog.vector_search', inputRef: 'private-input-ref' },
  ] };
  const run = runtime.submitGraph(graph, { 'private-input-ref': task().input }); await runtime.wait(run.runId);
  const snapshot = await dashboardReader(runtime)();
  const displayed = snapshot.runs.find(item => item.runId === run.runId);
  assert.equal(displayed.graph.nodes[0].taskId, 'first-step');
  assert.equal(displayed.nodes[0].status, 'completed');
  assert.doesNotMatch(JSON.stringify(snapshot), /private-goal|private-input-ref|"output"|"inputRef"/);
});
