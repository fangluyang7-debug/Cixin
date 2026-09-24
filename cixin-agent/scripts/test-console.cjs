// Optional browser regression: requires Playwright in the Node module search path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { chromium } = require('playwright');
const { LinuxBoardAdapter } = require('../dist/platform/linux-board');
const { ToolRegistry } = require('../dist/runtime/tool-registry');
const { vectorSearchTool } = require('../dist/plugins/vector-search');
const { BoardNode } = require('../dist/runtime/board-node');
const { FleetRuntime } = require('../dist/runtime/fleet-runtime');
const { serve } = require('../dist/runtime/http-server');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cixin-console-smoke-'));
  const config = { deviceId: 'host-browser-test', family: 'host', host: '127.0.0.1', port: 0,
    tokenEnv: 'CIXIN_BROWSER_TEST_TOKEN', dataDir: directory, mode: 'LOCAL_ONLY', minRemoteSamples: 3,
    maxConcurrentLocalTasks: 1, cpuWorkerBudget: 2, maxPendingTasks: 32, peers: [] };
  const registry = new ToolRegistry(); registry.register(vectorSearchTool());
  const node = new BoardNode(config, await LinuxBoardAdapter.create(config), registry);
  let browser, server, runtime;
  const artifacts = path.resolve(__dirname, '../data/console-test'); fs.mkdirSync(artifacts, { recursive: true });
  try {
    await node.start(); runtime = new FleetRuntime(node);
    const token = randomBytes(32).toString('hex');
    server = await serve(runtime, token, '127.0.0.1', 0);
    const url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true,
      ...(process.env.CIXIN_BROWSER_EXECUTABLE ? { executablePath: process.env.CIXIN_BROWSER_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 1536, height: 1050 } });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const dashboard = await context.newPage();
    await dashboard.goto(`${url}/dashboard/`);
    assert.equal(await dashboard.locator('#cpu').innerText(), '--');
    const app = await context.newPage(); await app.goto(`${url}/demo/`);
    await app.locator('#token').fill(token); await app.locator('#authForm button[type=submit]').click();
    await app.waitForFunction(() => !document.querySelector('#tool').disabled);
    await app.locator('#payload').fill('invalid-json'); await app.locator('#submit').click();
    await app.waitForFunction(() => document.querySelector('#notice').textContent.includes('输入无效'));
    assert.equal(runtime.runs.all().length, 0);
    await app.locator('#taskFile').setInputFiles(path.resolve(__dirname, '../examples/vector-task.json'));
    await app.waitForFunction(() => document.querySelector('#inputOrigin').textContent.includes('vector-task.json'));
    await app.locator('#submit').click();
    await app.waitForFunction(() => document.querySelector('#taskStatus').textContent.includes('已完成'));
    assert.match(await app.locator('#output').innerText(), /shoe-a/);
    assert.equal(runtime.runs.all().length, 1);
    await dashboard.locator('#token').fill(token); await dashboard.locator('#authForm button[type=submit]').click();
    await dashboard.waitForFunction(() => document.querySelector('#runCount').textContent.includes('1 RUNS'));
    assert.match(await dashboard.locator('#receipt').innerText(), /已确认/);
    assert.match(await dashboard.locator('#thermal').innerText(), /UNKNOWN/);
    assert.match(await dashboard.locator('#capabilities').innerText(), /未接入/);
    const canvasHasSamples = await dashboard.locator('#history').evaluate(canvas => {
      const values = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < values.length; i += 4) if (values[i + 1] > 180 && values[i] < 100 && values[i + 3] > 200) return true;
      return false;
    });
    assert.ok(canvasHasSamples, 'Actual CPU/memory sample pixels must be visible');
    await dashboard.screenshot({ path: path.join(artifacts, 'dashboard-desktop.png'), fullPage: true });
    await app.screenshot({ path: path.join(artifacts, 'demo-desktop.png'), fullPage: true });
    for (const page of [dashboard, app]) {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No mobile horizontal overflow');
    }
    await dashboard.screenshot({ path: path.join(artifacts, 'dashboard-mobile.png'), fullPage: true });
    await app.screenshot({ path: path.join(artifacts, 'demo-mobile.png'), fullPage: true });
    await dashboard.locator('#pause').click();
    const stamp = await dashboard.locator('#capturedAt').innerText();
    await new Promise(resolve => setTimeout(resolve, 2200));
    assert.equal(await dashboard.locator('#capturedAt').innerText(), stamp);
    assert.match(await dashboard.locator('#connectionState').innerText(), /暂停/);
    await dashboard.locator('#pause').click();
    await dashboard.waitForFunction(() => document.querySelector('#connectionState').textContent === '已连接');
    await dashboard.route('**/api/v1/runtime/dashboard', route => route.abort('failed'));
    await dashboard.waitForFunction(() => document.querySelector('#connectionState').textContent === '连接失败');
    assert.ok(await dashboard.locator('body').evaluate(body => body.classList.contains('stale')));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', source: 'real-host-adapter', realRuns: runtime.runs.all().length,
      checks: ['authenticated App -> Runtime -> dashboard', 'real receipt', 'unknown sensors', 'input error', 'pause', 'connection loss', 'desktop/mobile layout', 'canvas sample pixels'], artifacts }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    if (runtime) await runtime.close(); await node.close();
    const absolute = path.resolve(directory);
    if (path.dirname(absolute) === path.resolve(os.tmpdir()) && path.basename(absolute).startsWith('cixin-console-smoke-')) fs.rmSync(absolute, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
