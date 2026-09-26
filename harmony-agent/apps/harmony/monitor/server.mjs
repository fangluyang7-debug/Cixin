import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const HOST = '0.0.0.0';
const PORT = Number(process.env.HARMONY_MONITOR_PORT ?? 8765);
const TOKEN = process.env.HARMONY_MONITOR_TOKEN ?? randomBytes(12).toString('base64url');
const MAX_BODY = 512 * 1024;
let latest = null;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function authorized(request) {
  const value = request.headers.authorization ?? '';
  const candidate = Buffer.from(value.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(TOKEN);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
    ...headers
  });
  response.end(body);
}

function pick(source, fields) {
  const target = {};
  for (const field of fields) {
    if (source?.[field] !== undefined) target[field] = source[field];
  }
  return target;
}

function safeCode(value, pattern = /^[A-Z0-9_.-]{1,80}$/) {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function safeReason(value) {
  if (typeof value !== 'string') return undefined;
  const code = value.split(':', 1)[0];
  return safeCode(code, /^[A-Z0-9_.-]{1,48}(?:\([-0-9.]{1,16}\))?$/);
}

function safeCapability(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(value)
    ? value : undefined;
}

function cleanProfile(profile) {
  return {
    id: safeCode(profile?.id, /^[A-Za-z0-9_.-]{1,80}$/),
    modelTier: safeCode(profile?.modelTier),
    backend: safeCode(profile?.backend),
    ...pick(profile, ['workerCount', 'retrievalDimensions', 'candidateCount', 'batchSize'])
  };
}

function cleanPrediction(prediction) {
  return pick(prediction, ['p50LatencyMs', 'p95LatencyMs', 'latencyMs', 'memoryMb', 'relativeEnergyCost',
    'thermalRisk', 'deadlineMissRisk', 'confidence', 'sampleCount', 'source']);
}

function cleanRoute(route) {
  if (!route) return undefined;
  const result = {};
  for (const key of ['rttMs', 'uplinkMbps', 'downlinkMbps', 'cloudQueueMs', 'estimatedUploadMs',
    'estimatedDownloadMs', 'estimatedTotalMs', 'observedAt', 'bandwidthAt', 'dependenciesAt', 'costEstimate']) {
    result[key] = typeof route[key] === 'number' && Number.isFinite(route[key]) ? route[key] : null;
  }
  return { ...result, routeId: safeCapability(route.routeId), backend: safeCapability(route.backend),
    source: safeCapability(route.source), invalidationReason: safeReason(route.invalidationReason) };
}
function cleanActual(actual) {
  if (!actual) return undefined;
  const timing = {};
  for (const key of ['requestMs', 'uploadMs', 'downloadMs', 'inputBytes', 'outputBytes']) {
    const v = actual.cloudTiming?.[key]; timing[key] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  }
  return { ...pick(actual, ['profileId', 'actualModelTier', 'actualBackend', 'actualThreads',
    'workerCount', 'executionPath', 'peakMemoryMb', 'candidateCount', 'retrievalDimensions']),
    cloudRunId: safeCapability(actual.cloudRunId), cloudTiming: timing,
    routeEvents: Array.isArray(actual.routeEvents) ? actual.routeEvents.slice(-64).map(event => ({
      phase: safeCapability(event.phase), timestamp: Number.isFinite(event.timestamp) ? event.timestamp : null,
      durationMs: Number.isFinite(event.durationMs) ? event.durationMs : null,
      errorCode: safeReason(event.errorCode) })) : [] };
}

function cleanPlan(plan) {
  if (!plan) return null;
  return {
    queueAction: safeCode(plan.queueAction),
    inferenceLocation: safeCode(plan.inferenceLocation),
    executionProfile: cleanProfile(plan.executionProfile),
    reasonCodes: Array.isArray(plan.reasonCodes) ? plan.reasonCodes.slice(0, 24).map(safeReason).filter(Boolean) : [],
    prediction: cleanPrediction(plan.prediction),
    routeCandidate: cleanRoute(plan.routeCandidate),
    policyAudit: pick(plan.policyAudit, ['mode', 'version', 'baselineProfileId', 'shadowProfileId',
      'actualProfileId', 'cohort', 'stateBucket', 'actualConfirmed'])
      && { ...pick(plan.policyAudit, ['mode', 'version', 'baselineProfileId', 'shadowProfileId',
        'actualProfileId', 'cohort', 'stateBucket', 'actualConfirmed']),
      fallbackReason: safeReason(plan.policyAudit?.fallbackReason) }
  };
}

function cleanTask(task) {
  return {
    ...pick(task, ['status', 'queuedAt', 'startedAt', 'stopRequestedAt',
      'targetLatencyMs', 'softDeadlineMs', 'deadlineMs', 'highQuality']),
    taskId: safeCode(task.taskId, /^[A-Za-z0-9_.:-]{1,96}$/),
    capability: safeCapability(task.capability),
    taskType: safeCode(task.taskType),
    executionPlan: cleanPlan(task.executionPlan)
  };
}

function cleanEvent(event) {
  const telemetry = event.telemetry;
  return {
    ...pick(event, ['status', 'queuedAt', 'startedAt', 'finishedAt',
      'queueDurationMs', 'executionDurationMs', 'totalDurationMs', 'stopRequestedAt']),
    taskId: safeCode(event.taskId, /^[A-Za-z0-9_.:-]{1,96}$/),
    taskType: safeCode(event.taskType),
    capability: safeCapability(event.capability),
    deviceState: pick(event.deviceState, ['source', 'appVisibility', 'thermalLevel', 'batteryPercent',
      'availableMemoryMb', 'memoryPressure', 'systemCpuUsage', 'capturedAt']),
    executionPlan: cleanPlan(event.executionPlan),
    telemetry: telemetry ? {
      ...pick(telemetry, ['endToEndDurationMs', 'softDeadlineMissed', 'deadlineMissed', 'resultDisplayed',
        'resultConsumed', 'checkpointCount', 'mixedExecution']),
      actual: cleanActual(telemetry.actual),
    } : undefined
  };
}

function cleanSnapshot(input) {
  if (!input || input.schemaVersion !== 1 || input.connected !== true || !input.state || !input.metrics ||
    !Array.isArray(input.activeTasks) || !Array.isArray(input.events)) return null;
  return {
    schemaVersion: 1,
    sequence: Number.isSafeInteger(input.sequence) ? input.sequence : 0,
    capturedAt: Number.isFinite(input.capturedAt) ? input.capturedAt : Date.now(),
    state: pick(input.state, ['source', 'appVisibility', 'batteryPercent', 'isCharging', 'thermalLevel',
      'recentLatencyMs', 'queueDepth', 'systemCpuUsage', 'appCpuUsage', 'memoryPressure', 'totalMemoryMb',
      'freeMemoryMb', 'availableMemoryMb', 'availableBackends', 'capturedAt', 'sampledAt']),
    metrics: pick(input.metrics, ['evaluationCount', 'taskCount', 'runningCount', 'queuedCount', 'pausedCount',
      'averageLatencyMs', 'p95LatencyMs', 'averageQueueDurationMs', 'degradeCount', 'failureCount',
      'cancellationCount', 'policySwitchCount', 'capturedAt']),
    activeTasks: input.activeTasks.slice(0, 64).map(cleanTask),
    events: input.events.slice(0, 24).map(cleanEvent),
    policyMode: typeof input.policyMode === 'string' ? input.policyMode.slice(0, 40) : 'UNKNOWN',
    policyVersion: typeof input.policyVersion === 'string' ? input.policyVersion.slice(0, 80) : '',
    feedbackEnabled: input.feedbackEnabled === true
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (!authorized(request)) return send(response, 401, 'Unauthorized');
    if (request.method === 'GET' && url.pathname === '/api/snapshot') {
      return send(response, 200, JSON.stringify({ receivedAt: latest?.receivedAt ?? null, snapshot: latest?.snapshot ?? null }),
        { 'Content-Type': 'application/json; charset=utf-8' });
    }
    if (request.method === 'POST' && url.pathname === '/api/snapshot') {
      let size = 0;
      const chunks = [];
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
        else request.destroy();
      });
      request.on('end', () => {
        if (size > MAX_BODY) return send(response, 413, 'Payload too large');
        try {
          const snapshot = cleanSnapshot(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          if (!snapshot) return send(response, 400, 'Invalid scheduler snapshot');
          latest = { receivedAt: Date.now(), snapshot };
          send(response, 204, '');
        } catch (_) { send(response, 400, 'Invalid JSON'); }
      });
      return;
    }
    return send(response, 404, 'Not found');
  }

  if (request.method !== 'GET') return send(response, 405, 'Method not allowed');
  const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['index.html', 'app.js', 'style.css'].includes(filename)) return send(response, 404, 'Not found');
  try {
    const contents = await readFile(join(ROOT, filename));
    send(response, 200, contents, { 'Content-Type': MIME[extname(filename)] });
  } catch (_) { send(response, 404, 'Not found'); }
});

server.listen(PORT, HOST, () => {
  console.log(`Harmony Scheduler Monitor: http://localhost:${PORT}`);
  console.log(`Pairing code: ${TOKEN}`);
  console.log('Use the computer LAN IPv4 address in the phone app; keep both devices on a trusted local network.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
