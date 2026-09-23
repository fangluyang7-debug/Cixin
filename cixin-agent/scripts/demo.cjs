const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { LinuxBoardAdapter } = require('../dist/platform/linux-board');
const { BoardNode } = require('../dist/runtime/board-node');
const { FleetRuntime } = require('../dist/runtime/fleet-runtime');
const { ToolRegistry } = require('../dist/runtime/tool-registry');
const { vectorSearchTool } = require('../dist/plugins/vector-search');
const { serve } = require('../dist/runtime/http-server');
const { config, temporary, cleanup, task } = require('../test/helpers.cjs');

(async () => {
  const nodes = []; const directories = []; let server;
  try {
    process.env.CIXIN_DEMO_TOKEN = randomBytes(32).toString('hex');
    for (const id of ['host-controller', 'host-worker']) {
      const directory = temporary(); directories.push(directory);
      const settings = { ...config(id, directory), tokenEnv: 'CIXIN_DEMO_TOKEN' };
      const registry = new ToolRegistry(); registry.register(vectorSearchTool());
      const node = new BoardNode(settings, await LinuxBoardAdapter.create(settings), registry);
      await node.start(); nodes.push(node);
    }
    server = await serve(new FleetRuntime(nodes[1]), process.env.CIXIN_DEMO_TOKEN, '127.0.0.1', 0);
    nodes[0].config.peers = [{ deviceId: 'host-worker', url: `http://127.0.0.1:${server.address().port}`,
      tokenEnv: 'CIXIN_DEMO_TOKEN', bytesPerSecond: 10_000_000 }];
    await delay(100); // Two CPU counter samples; not a simulated idle/temperature reading.
    const runtime = new FleetRuntime(nodes[0]);
    const run = runtime.submit(task({ allowRemote: true, allowedDeviceIds: ['host-worker'], deadlineMs: 10000 }));
    const result = await runtime.wait(run.runId);
    console.log(JSON.stringify({ scope: 'Two localhost HTTP nodes on one physical host; not P1 acceptance',
      minRemoteSamples: 0, linkRate: 'demo configuration, not a benchmark', result }, null, 2));
    if (result.status !== 'completed') process.exitCode = 1;
  } finally {
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    for (const node of nodes) await node.close();
    for (const directory of directories) cleanup(directory);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
