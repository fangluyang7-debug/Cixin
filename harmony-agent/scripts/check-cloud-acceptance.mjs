import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const stages = ['receive', 'asset', 'quality-check', 'crop', 'category', 'product-profile',
  'embedding', 'vector-search', 'price-stock', 'rank', 'answer', 'result'];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// GET only. Readiness itself performs the server's small COS/model probes.
// Exported for fixture tests; no credentials, response bodies or signed URLs in the report.
export async function checkCloudAcceptance(baseUrl, { runId, infrastructureOnly = false, fetchImpl = fetch } = {}) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Provide a public HTTPS origin without credentials, path or query.');
  }
  if (runId && !/^run_[A-Za-z0-9_-]+$/.test(runId)) throw new Error('Invalid runId.');
  if (runId && infrastructureOnly) throw new Error('Infrastructure-only checks cannot certify a shopping run.');
  const checks = [];
  const add = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });
  const get = async path => {
    try {
      const response = await fetchImpl(url.origin + path, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      const body = await response.json().catch(() => null);
      add(path, response.ok && body?.success === true, `HTTP ${response.status}; API envelope ${body?.success === true ? 'valid' : 'absent/failed'}`);
      return body?.success === true && response.ok ? body.data : null;
    } catch {
      add(path, false, 'Connection, timeout or redirect failure');
      return null;
    }
  };
  const health = await get('/api/v1/health');
  add('api-process', health?.status === 'ok' && health?.service === 'api-server', 'Expected api-server liveness');
  const readiness = await get(infrastructureOnly ? '/api/v1/health/infrastructure' : '/api/v1/health/readiness');
  for (const dependency of infrastructureOnly ? ['database', 'cos'] : ['database', 'cos', 'chat', 'vision', 'embedding']) {
    add(`readiness:${dependency}`, readiness?.available === true && readiness?.checks?.[dependency]?.available === true,
      'A real successful dependency probe is required');
  }
  const registry = await get('/api/v1/runtime/tools');
  const ids = new Set((Array.isArray(registry?.tools) ? registry.tools : []).map(tool => tool.toolId));
  const expected = ['shopping.text', 'shopping.read', 'shopping.refine', ...stages.map(stage => `shopping.stage.${stage}`)];
  const missing = expected.filter(id => !ids.has(id));
  add('deployed-workflow-version', missing.length === 0, missing.length ? `Missing tools: ${missing.join(', ')}` : 'All required workflow tools registered');
  if (runId) {
    const run = await get(`/api/v1/runtime/runs/${encodeURIComponent(runId)}`);
    add('image-run-completed', run?.runId === runId && run?.status === 'completed', 'Provide a successful phone image-search run');
    add('client-correlation', typeof run?.taskGraph?.clientTaskId === 'string' &&
      run?.clientTelemetry?.taskId === run.taskGraph.clientTaskId, 'Client task and uploaded timing must correlate');
    const assignments = run?.executionPlan?.assignments ?? [];
    const order = run?.executionPlan?.executionOrder ?? [];
    add('image-stage-order', stages.every((id, index) => order[index] === id) && order.length === stages.length,
      'All twelve image stages must execute in dependency order');
    for (const id of stages) {
      const assignment = assignments.find(item => item.taskId === id);
      const record = run?.telemetry?.find(item => item.taskId === id);
      const timing = record?.metadata?.segmentedTiming;
      add(`executed:${id}`, assignment?.status === 'succeeded' && Boolean(assignment.startedAt && assignment.finishedAt) &&
        record?.success === true && record?.fallbackOccurred === false && record?.executorId === 'zeabur-shopping-workflow' &&
        ['storageReadMs', 'storageWriteMs', 'queueMs', 'executionMs', 'modelMs'].every(key => finite(timing?.[key])),
      'Successful assignment and server timing required; local fallback forbidden');
    }
    add('phone-transfer-timing', ['requestMs', 'uploadMs', 'downloadMs'].every(key => finite(run?.clientTelemetry?.timing?.[key])),
      'Missing/null transfer measurements remain an acceptance gap');
  }
  return { checkedAt: new Date().toISOString(), origin: url.origin, runId: runId ?? null,
    scope: infrastructureOnly ? 'infrastructure-only-models-not-accepted' : runId ? 'deployment-and-image-run-evidence' : 'deployment-readiness-only',
    passed: checks.every(check => check.passed), checks,
    remaining: [...(infrastructureOnly ? ['Model integration and successful shopping workflow evidence'] : []), 'Native build and phone text/image UI evidence', 'Real failure, timeout and cancellation evidence',
      'Product/index data compatibility and displayed result verification'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    while (args.length) {
      const key = args.shift();
      if (key === '--infrastructure-only') { options[key] = true; continue; }
      if (!['--base-url', '--run-id', '--output'].includes(key) || !args.length || args[0].startsWith('--')) {
        throw new Error('Usage: npm run api:acceptance -- --base-url https://HOST [--infrastructure-only | --run-id run_ID] [--output report.json]');
      }
      options[key] = args.shift();
    }
    if (!options['--base-url']) throw new Error('--base-url is required');
    const report = await checkCloudAcceptance(options['--base-url'], { runId: options['--run-id'], infrastructureOnly: options['--infrastructure-only'] === true });
    const output = JSON.stringify(report, null, 2) + '\n';
    if (options['--output']) await writeFile(options['--output'], output, { flag: 'wx' });
    console.log(output);
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
