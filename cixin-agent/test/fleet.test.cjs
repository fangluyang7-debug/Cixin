const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { FleetRuntime, topological } = require('../dist/runtime/fleet-runtime');
const { BoardNode } = require('../dist/runtime/board-node');
const { serve } = require('../dist/runtime/http-server');
const { HttpTransport } = require('../dist/runtime/transport');
const { makeNode, task, request, completed, attemptKey, types, config, temporary, cleanup } = require('./helpers.cjs');

test('local Cixin tool runs through the migrated constrained scheduler and persisted receipt', async t => {
  const node = await makeNode(t); const runtime = new FleetRuntime(node);
  const run = runtime.submit(task()); const done = await runtime.wait(run.runId);
  assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.equal(done.result.result.output[0].id, 'first');
  assert.equal(done.result.result.executionPlan.policyAudit.actualConfirmed, true);
  assert.equal(runtime.runs.get(run.runId).status, 'completed');
  assert.ok(!JSON.stringify(runtime.runs.get(run.runId)).includes('"query"'));
});
test('shared client task id and segmented timing remain correlated without storing input', async t => {
  const node = await makeNode(t); const runtime = new FleetRuntime(node);
  const run = runtime.submit({ ...task(), taskId: 'phone_shared_1' });
  await runtime.wait(run.runId);
  const recorded = runtime.recordClientTelemetry(run.runId, 'phone_shared_1', {
    requestMs: 35, uploadMs: 4, downloadMs: 6, inputBytes: 128, outputBytes: 512 });
  assert.equal(recorded.clientTaskId, 'phone_shared_1');
  assert.equal(recorded.clientTelemetry.timing.uploadMs, 4);
  assert.ok(!JSON.stringify(recorded).includes('"query"'));
  assert.throws(() => runtime.recordClientTelemetry(run.runId, 'another_task', {
    requestMs: 1, uploadMs: null, downloadMs: null, inputBytes: 0, outputBytes: 0 }),
  /RUNTIME_CLIENT_TASK_MISMATCH/);
});
test('concurrent duplicate attempt IDs execute once; payload changes are rejected', async t => {
  let count = 0;
  const node = await makeNode(t, 'node', tool => { const execute = tool.executor.execute;
    tool.executor.execute = (...args) => { count++; return execute(...args); }; });
  const value = request(node);
  const results = await Promise.all([node.submit(value), node.submit(value), node.submit(value)]);
  await completed(node, results[0].key); assert.equal(count, 1);
  await assert.rejects(node.submit({ ...value, input: {} }), /DIFFERENT_PAYLOAD/);
});
test('model/contract mismatch, wrong target, expired budgets and critical memory never execute', async t => {
  const node = await makeNode(t);
  assert.equal((await node.quote(request(node, { modelDigest: 'different' }))).accepted, false);
  assert.equal((await node.quote(request(node, { remainingMs: -1 }))).accepted, false);
  await assert.rejects(node.submit(request(node, { targetDeviceId: 'another' })), /WRONG_TARGET/);
  node.adapter.patch.availableMemoryMb = 100;
  const result = await node.submit(request(node));
  assert.equal(result.status, 'rejected'); assert.match(result.reason, /MEMORY/);
});
test('target rechecks actual resource pressure after a successful quote', async t => {
  const node = await makeNode(t);
  const value = request(node); assert.equal((await node.quote(value)).accepted, true);
  node.adapter.patch.thermalLevel = types.ThermalLevel.CRITICAL;
  const result = await node.submit(value); assert.equal(result.status, 'rejected');
  assert.match(result.reason, /THERMAL_CRITICAL/);
});
test('tool latency contract still expires a slow executor even with a longer caller deadline', async t => {
  let executed = false;
  const node = await makeNode(t, 'bounded', tool => {
    tool.descriptor.constraints.maxLatencyMs = 300;
    const execute = tool.executor.execute;
    tool.executor.execute = async (...args) => {
      executed = true;
      await new Promise(resolve => setTimeout(resolve, 450));
      return execute(...args);
    };
  });
  const runtime = new FleetRuntime(node);
  const run = runtime.submit(task({ deadlineMs: 10000 }));
  const done = await runtime.wait(run.runId);
  assert.equal(executed, true);
  assert.notEqual(done.status, 'completed');
  const attempt = await completed(node, done.attemptKey);
  assert.equal(attempt.result.output, null);
  assert.notEqual(attempt.status, 'completed');
});
test('cancellation retains occupied slot until uninterruptible executor acknowledges', async t => {
  let finish;
  const node = await makeNode(t, 'node', tool => { const execute = tool.executor.execute;
    tool.executor.execute = async (...args) => { await new Promise(resolve => { finish = resolve; }); return execute(...args); }; });
  const submitted = await node.submit(request(node));
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  await node.cancel(submitted.key);
  assert.equal(node.scheduler.getMetricsSnapshot().runningCount, 1);
  assert.equal(node.get(submitted.key).status, 'running');
  finish(); const result = await completed(node, submitted.key);
  assert.equal(result.status, 'cancelled'); assert.equal(result.result.output, null);
});
test('persisted unfinished attempt is unknown after restart and never automatically rerun', async t => {
  const node = await makeNode(t); const value = request(node); const key = attemptKey(value);
  const { digest } = require('../dist/runtime/util');
  node.attempts.put(key, { key, originDeviceId: 'local', bootId: node.bootId, requestDigest: digest(value),
    status: 'running', createdAt: Date.now(), updatedAt: Date.now() });
  const restarted = new BoardNode(node.config, node.adapter, node.registry);
  assert.equal(restarted.get(key).status, 'unknown');
  assert.equal((await restarted.submit(value)).status, 'unknown');
  await assert.rejects(restarted.submit({ ...value, attemptId: 'new' }), /TARGET_RESTARTED/);
});

async function fleet(t, mode = 'ACTIVE') {
  const remote = await makeNode(t, 'board-b');
  const local = await makeNode(t, 'p1-controller', tool => { tool.template.qualityLevels[0].estimatedLatencyMs = 2000; });
  const token = 'only-a-test-token-with-32-characters'; process.env.CIXIN_TEST_TOKEN = token;
  const server = await serve(new FleetRuntime(remote), token, '127.0.0.1', 0);
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  local.config.mode = mode;
  local.config.peers = [{ deviceId: 'board-b', url: `http://127.0.0.1:${server.address().port}`,
    tokenEnv: 'CIXIN_TEST_TOKEN', bytesPerSecond: 100_000_000 }];
  return { local, remote, runtime: new FleetRuntime(local), server, token };
}
test('two HTTP nodes perform real remote execution and return matching audited results', async t => {
  const { runtime } = await fleet(t);
  const run = runtime.submit(task({ allowRemote: true, deadlineMs: 10000, allowedDeviceIds: ['board-b'] }));
  const done = await runtime.wait(run.runId);
  assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.equal(done.targetDeviceId, 'board-b'); assert.equal(done.result.result.output[0].id, 'first');
});
test('shadow computes remote alternatives while keeping actual execution local', async t => {
  const { runtime, remote } = await fleet(t, 'SHADOW');
  const run = runtime.submit(task({ allowRemote: true })); const done = await runtime.wait(run.runId);
  assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.equal(done.targetDeviceId, 'p1-controller'); assert.equal(done.decision.suggestedDeviceId, 'board-b');
  assert.equal(remote.attempts.all().length, 0);
});
test('remote consent, privacy, model compatibility and sample minimum are hard gates', async t => {
  const { runtime, local, remote } = await fleet(t);
  for (const constraints of [{ allowRemote: false }, { allowRemote: true, privacy: 'high' }, { allowRemote: true, locality: 'local_only' }]) {
    const plan = await runtime.plan(task(constraints)); assert.equal(plan.selectedDeviceId, local.config.deviceId);
    assert.equal(plan.candidates.find(c => c.deviceId === 'board-b').accepted, false);
  }
  local.config.minRemoteSamples = 3;
  const plan = await runtime.plan(task({ allowRemote: true }));
  assert.match(plan.candidates.find(c => c.deviceId === 'board-b').reasons.join(), /INSUFFICIENT_REMOTE_SAMPLES/);
  local.config.minRemoteSamples = 0; remote.registry.get('catalog.vector_search').modelDigest = 'wrong-model';
  assert.equal((await runtime.plan(task({ allowRemote: true }))).candidates.find(c => c.deviceId === 'board-b').accepted, false);
});
test('lost dispatch reply produces unknown and does not fall back to local execution', async t => {
  const { runtime, local, remote } = await fleet(t); const http = new HttpTransport();
  runtime.transport.submit = async (peer, value) => { await http.submit(peer, value); throw new Error('simulated response loss'); };
  const run = runtime.submit(task({ allowRemote: true, allowedDeviceIds: ['board-b'] }));
  const done = await runtime.wait(run.runId); assert.equal(done.status, 'unknown');
  assert.equal(local.attempts.all().length, 0); assert.equal(remote.attempts.all().length, 1);
  await completed(remote, done.attemptKey);
  const audit = await runtime.reconcile(run.runId); assert.equal(audit.status, 'unknown');
  assert.equal(audit.result.result.output, null);
});
test('HTTP rejects missing auth, oversized request and unconfigured planner', async t => {
  const { server, token } = await fleet(t); const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/api/v1/runtime/tools`)).status, 401);
  const response = await fetch(`${url}/api/v1/runtime/agent/plan`, { method: 'POST',
    headers: { authorization: `Bearer ${token}` }, body: '{}' });
  assert.equal((await response.json()).reason, 'AGENT_PLANNER_NOT_CONFIGURED');
  const oversized = await fetch(`${url}/api/v1/runtime/tasks`, { method: 'POST',
    headers: { authorization: `Bearer ${token}` }, body: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(oversized.status, 400);
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const submitted = await fetch(`${url}/api/v1/runtime/tasks`, { method: 'POST', headers,
    body: JSON.stringify({ ...task(), taskId: 'phone_http_1' }) });
  assert.equal(submitted.status, 202);
  const created = await submitted.json();
  const telemetry = await fetch(`${url}/api/v1/runtime/runs/${created.runId}/client-telemetry`, {
    method: 'POST', headers, body: JSON.stringify({ taskId: 'phone_http_1', timing: {
      requestMs: 20, uploadMs: 3, downloadMs: 5, inputBytes: 120, outputBytes: 480 } }) });
  assert.equal(telemetry.status, 200);
  assert.equal((await telemetry.json()).clientTelemetry.timing.downloadMs, 5);
  let terminal = false;
  for (let i = 0; i < 100; i++) {
    const response = await fetch(`${url}/api/v1/runtime/runs/${created.runId}`, { headers });
    const current = await response.json();
    if (!['planning', 'running'].includes(current.status)) { terminal = true; break; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(terminal, true);
});
test('DAG dependencies and shared deadline execute through Cixin TaskGraph; cycles reject', async t => {
  const node = await makeNode(t); const runtime = new FleetRuntime(node);
  const graph = { graphId: 'g1', goal: 'two searches', nodes: [
    { taskId: 'b', toolId: 'catalog.vector_search', inputRef: 'b-input', dependencies: ['a'] },
    { taskId: 'a', toolId: 'catalog.vector_search', inputRef: 'a-input', dependencies: [] },
  ] };
  const run = runtime.submitGraph(graph, { 'a-input': task().input, 'b-input': task().input });
  const done = await runtime.wait(run.runId); assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.deepEqual(Object.keys(done.nodes), ['a', 'b']);
  graph.nodes[1].dependencies = ['b']; assert.throws(() => topological(graph), /GRAPH_CYCLE/);
});
test('DAG privacy inherited from dependencies prevents disclosure by later public nodes', async t => {
  const { runtime } = await fleet(t);
  const graph = { graphId: 'private-graph', goal: 'privacy propagation', nodes: [
    { taskId: 'a', toolId: 'catalog.vector_search', inputRef: 'input', constraints: { privacy: 'high' } },
    { taskId: 'b', toolId: 'catalog.vector_search', inputRef: 'input', dependencies: ['a'], constraints: { privacy: 'public' } },
  ] };
  const run = runtime.submitGraph(graph, { input: task().input }, { allowRemote: true });
  const done = await runtime.wait(run.runId); assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.equal(done.nodes.b.targetDeviceId, 'p1-controller');
  assert.equal(done.nodes.b.decision.candidates.find(c => c.deviceId === 'board-b').accepted, false);
});
