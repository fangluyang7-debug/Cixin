import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCloudAcceptance } from './check-cloud-acceptance.mjs';

const stages = ['receive', 'asset', 'quality-check', 'crop', 'category', 'product-profile',
  'embedding', 'vector-search', 'price-stock', 'rank', 'answer', 'result'];
const tools = ['shopping.text', 'shopping.read', 'shopping.refine', ...stages.map(id => `shopping.stage.${id}`)];
function fixture(overrides = {}) {
  return async address => {
    const path = new URL(address).pathname;
    const data = {
      '/api/v1/health': { service: 'api-server', status: 'ok' },
      '/api/v1/health/readiness': { available: true, checks: Object.fromEntries(
        ['database', 'cos', 'chat', 'vision', 'embedding'].map(id => [id, { available: true }])) },
      '/api/v1/runtime/tools': { tools: tools.map(toolId => ({ toolId })) },
      ...overrides,
    }[path];
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  };
}
test('readiness success does not claim complete phone acceptance', async () => {
  const report = await checkCloudAcceptance('https://test.example', { fetchImpl: fixture() });
  assert.equal(report.passed, true);
  assert.equal(report.scope, 'deployment-readiness-only');
  assert.ok(report.remaining.length);
});
test('gateway empty 404 fails rather than accepting HTTPS connectivity', async () => {
  const report = await checkCloudAcceptance('https://test.example', { fetchImpl: async () => new Response('', { status: 404 }) });
  assert.equal(report.passed, false);
});
test('old deployed tools and unavailable dependencies fail', async () => {
  const report = await checkCloudAcceptance('https://test.example', { fetchImpl: fixture({
    '/api/v1/runtime/tools': { tools: [] }, '/api/v1/health/readiness': { available: false },
  }) });
  assert.equal(report.checks.find(check => check.name === 'deployed-workflow-version').passed, false);
  assert.equal(report.checks.find(check => check.name === 'readiness:cos').passed, false);
});
test('completed label alone is insufficient without actual stage/phone telemetry', async () => {
  const report = await checkCloudAcceptance('https://test.example', { runId: 'run_test', fetchImpl: fixture({
    '/api/v1/runtime/runs/run_test': { runId: 'run_test', status: 'completed' },
  }) });
  assert.equal(report.passed, false);
  assert.equal(report.checks.find(check => check.name === 'phone-transfer-timing').passed, false);
});
test('credential-bearing URLs are rejected before fetching', async () => {
  await assert.rejects(checkCloudAcceptance('https://secret@test.example'), /without credentials/);
});
test('infrastructure-only report explicitly excludes model acceptance', async () => {
  const report = await checkCloudAcceptance('https://test.example', { infrastructureOnly: true,
    fetchImpl: fixture({ '/api/v1/health/infrastructure': { available: true, shoppingAvailable: false,
      checks: { database: { available: true }, cos: { available: true } } } }) });
  assert.equal(report.passed, true);
  assert.equal(report.scope, 'infrastructure-only-models-not-accepted');
  assert.equal(report.checks.some(item => item.name === 'readiness:vision'), false);
});
