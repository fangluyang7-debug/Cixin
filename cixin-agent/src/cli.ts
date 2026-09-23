import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { LinuxBoardAdapter } from './platform/linux-board';
import { loadConfig } from './runtime/config';
import { ToolRegistry } from './runtime/tool-registry';
import { vectorSearchTool } from './plugins/vector-search';
import { processWorkerTool } from './plugins/process-worker';
import { BoardNode } from './runtime/board-node';
import { FleetRuntime } from './runtime/fleet-runtime';
import { serve } from './runtime/http-server';
import { invariant } from './runtime/util';
import { acquireProcessLock } from './runtime/process-lock';

async function main(): Promise<void> {
  const path = resolve(process.argv[2] ?? 'config/host.example.json');
  const config = loadConfig(path);
  const token = process.env[config.tokenEnv];
  invariant(token && token.length >= 24, `SET_${config.tokenEnv}_TO_A_RANDOM_TOKEN`);
  const adapter = await LinuxBoardAdapter.create(config);
  const registry = new ToolRegistry(); registry.register(vectorSearchTool());
  for (const worker of config.workers ?? []) registry.register(processWorkerTool(worker));
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const release = acquireProcessLock(join(config.dataDir, 'runtime.lock'));
  let startedNode: BoardNode | undefined;
  try {
    const node = new BoardNode(config, adapter, registry); startedNode = node; await node.start();
    const runtime = new FleetRuntime(node); const server = await serve(runtime, token);
    console.log(JSON.stringify({ event: 'ready', device: adapter.identity, mode: config.mode,
      address: `http://${config.host}:${config.port}`, missingNpuRequiresWorker: true }));
    let stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      server.close(); await node.close(); await runtime.close(); release();
    };
    process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
  } catch (error) { if (startedNode?.scheduler.isInitialized()) await startedNode.close(); release(); throw error; }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
