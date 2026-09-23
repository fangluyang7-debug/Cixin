import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { FleetRuntime } from './fleet-runtime';
import { errorMessage, invariant } from './util';
import { AttemptRequest, FleetConstraints, QuoteRequest, TaskSubmission } from '../contracts/fleet';
import { TaskGraph } from '../contracts/cixin';

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { size += chunk.length; invariant(size <= 1024 * 1024, 'REQUEST_TOO_LARGE'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function respond(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value));
}
export async function serve(runtime: FleetRuntime, token: string, host = runtime.node.config.host,
  port = runtime.node.config.port): Promise<Server> {
  invariant(token.length >= 24, 'RUNTIME_TOKEN_MUST_HAVE_AT_LEAST_24_CHARACTERS');
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/healthz' && request.method === 'GET') { respond(response, 200, { status: 'ok' }); return; }
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { respond(response, 401, { error: 'UNAUTHORIZED' }); return; }
      const path = url.pathname;
      if (request.method === 'GET') {
        if (path === '/api/v1/node/snapshot' || path === '/api/v1/runtime/snapshot') {
          respond(response, 200, { ...(await runtime.node.snapshot()), mode: runtime.node.config.mode,
            scheduler: runtime.node.scheduler.getMetricsSnapshot() }); return;
        }
        if (path === '/api/v1/runtime/tools') { respond(response, 200, runtime.node.registry.values().map(t => runtime.node.registry.info(t.descriptor.toolId))); return; }
        const attempt = path.match(/^\/api\/v1\/node\/attempts\/([a-f0-9]{64})$/);
        if (attempt) { const value = runtime.node.get(attempt[1]); respond(response, value ? 200 : 404, value ?? { error: 'NOT_FOUND' }); return; }
        const run = path.match(/^\/api\/v1\/runtime\/runs\/([a-f0-9-]{36})$/);
        if (run) { const value = runtime.runs.get(run[1]); respond(response, value ? 200 : 404, value ?? { error: 'NOT_FOUND' }); return; }
      }
      if (request.method === 'POST') {
        const input = await body(request);
        if (path === '/api/v1/node/quote') { respond(response, 200, await runtime.node.quote(input as QuoteRequest)); return; }
        if (path === '/api/v1/node/attempts') { respond(response, 202, await runtime.node.submit(input as AttemptRequest)); return; }
        if (path === '/api/v1/runtime/plan') { respond(response, 200, await runtime.plan(input as TaskSubmission)); return; }
        if (path === '/api/v1/runtime/tasks') { respond(response, 202, runtime.submit(input as TaskSubmission)); return; }
        if (path === '/api/v1/runtime/graphs') {
          invariant(input && typeof input === 'object', 'INVALID_GRAPH_REQUEST');
          const value = input as { taskGraph: TaskGraph; inputs: Record<string, unknown>; constraints?: FleetConstraints };
          respond(response, 202, runtime.submitGraph(value.taskGraph, value.inputs, value.constraints)); return;
        }
        if (path === '/api/v1/runtime/agent/plan') {
          respond(response, 200, { status: 'blocked', reason: 'AGENT_PLANNER_NOT_CONFIGURED' }); return;
        }
        const attempt = path.match(/^\/api\/v1\/node\/attempts\/([a-f0-9]{64})\/cancel$/);
        if (attempt) { const value = await runtime.node.cancel(attempt[1]); respond(response, value ? 200 : 404, value ?? { error: 'NOT_FOUND' }); return; }
        const run = path.match(/^\/api\/v1\/runtime\/runs\/([a-f0-9-]{36})\/(cancel|reconcile)$/);
        if (run) { respond(response, 200, run[2] === 'cancel' ? await runtime.cancel(run[1]) : await runtime.reconcile(run[1])); return; }
      }
      respond(response, 404, { error: 'NOT_FOUND' });
    } catch (error) { if (!response.headersSent) respond(response, 400, { error: errorMessage(error) }); else response.end(); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.keepAliveTimeout = 5000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return server;
}
