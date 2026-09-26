import { routeStatus } from '../scheduler/api/RemoteRouteProfile';
import { AttemptRecord, Candidate, NodeSnapshot, RunRecord } from '../contracts/fleet';
import { ExecutionPlan, TaskResult } from '../scheduler/api/SchedulerTypes';
import { FleetRuntime } from './fleet-runtime';
import { errorMessage, invariant } from './util';

// Explicit projections keep application inputs, outputs, graph goals and credentials out of telemetry.
function planView(plan?: ExecutionPlan) {
  if (!plan) return null;
  return {
    inferenceLocation: plan.inferenceLocation, priority: plan.priority, queueAction: plan.queueAction,
    reasonCodes: plan.reasonCodes, policyVersion: plan.policyVersion,
    profile: plan.executionProfile ? {
      id: plan.executionProfile.id, backend: plan.executionProfile.backend,
      modelTier: plan.executionProfile.modelTier, workerCount: plan.executionProfile.workerCount,
    } : null,
    prediction: plan.prediction ? {
      latencyMs: plan.prediction.latencyMs, sampleCount: plan.prediction.sampleCount,
      source: plan.prediction.source, confidence: plan.prediction.confidence,
    } : null,
    actualConfirmed: plan.policyAudit?.actualConfirmed === true,
    fallbackReason: plan.policyAudit?.fallbackReason ?? null,
  };
}

function resultView(result?: TaskResult<unknown>) {
  if (!result) return null;
  return {
    taskId: result.taskId, status: result.status, queueDurationMs: result.queueDurationMs,
    executionDurationMs: result.executionDurationMs, totalDurationMs: result.totalDurationMs,
    errorCode: result.errorCode ?? null, stopRequestedAt: result.stopRequestedAt ?? null,
    plan: planView(result.executionPlan),
  };
}

function attemptView(record: AttemptRecord) {
  return {
    key: record.key, originDeviceId: record.originDeviceId, bootId: record.bootId,
    status: record.status, reason: record.reason ?? null, createdAt: record.createdAt,
    updatedAt: record.updatedAt, result: resultView(record.result),
  };
}

function candidateView(candidate: Candidate) {
  const quote = candidate.quote;
  return {
    deviceId: candidate.deviceId, accepted: candidate.accepted, reasons: candidate.reasons,
    // Rejected candidates start with zero-valued placeholders in the placement algorithm.
    // They are not measured zero-latency paths and must not appear as such in the console.
    transferMs: candidate.accepted ? candidate.transferMs : null,
    totalMs: candidate.accepted ? candidate.totalMs : null,
    uncertaintyMs: candidate.accepted ? candidate.uncertaintyMs : null,
    route: candidate.route ? { routeId: candidate.route.routeId, source: candidate.route.source,
      rttMs: candidate.route.rttMs, uplinkMbps: candidate.route.uplinkMbps, downlinkMbps: candidate.route.downlinkMbps,
      estimatedUploadMs: candidate.route.estimatedUploadMs, estimatedDownloadMs: candidate.route.estimatedDownloadMs,
      observedAt: candidate.route.observedAt, status: routeStatus(candidate.route),
      invalidationReason: candidate.route.invalidationReason ?? null } : null,
    quote: quote ? {
      receivedAt: quote.receivedAtMs ?? null, accepted: quote.accepted, reasons: quote.reasons,
      queueMs: quote.accepted ? quote.queueMs : null,
      computeMs: quote.plan?.prediction?.latencyMs ?? null,
      sampleCount: quote.sampleCount, plan: planView(quote.plan),
    } : null,
  };
}

function runBase(run: RunRecord) {
  return {
    runId: run.runId, status: run.status, reason: run.reason ?? null,
    createdAt: run.createdAt, updatedAt: run.updatedAt,
    targetDeviceId: run.targetDeviceId ?? null,
    routeEvents: run.routeEvents ?? [],
    decision: run.decision ? {
      mode: run.decision.mode, status: run.decision.status,
      selectedDeviceId: run.decision.selectedDeviceId, suggestedDeviceId: run.decision.suggestedDeviceId,
      candidates: run.decision.candidates.map(candidateView),
    } : null,
    result: run.result ? attemptView(run.result) : null,
  };
}

function runView(run: RunRecord) {
  return {
    ...runBase(run),
    graph: run.taskGraph ? {
      graphId: run.taskGraph.graphId,
      nodes: run.taskGraph.nodes.map(node => ({
        taskId: node.taskId, toolId: node.toolId, dependencies: node.dependencies ?? [],
      })),
    } : null,
    nodes: Object.entries(run.nodes ?? {}).map(([taskId, child]) => ({ taskId, ...runBase(child) })),
  };
}

function nodeView(snapshot: NodeSnapshot) {
  return {
    bootId: snapshot.bootId, identity: snapshot.identity, state: snapshot.state,
    tools: snapshot.tools.map(tool => ({ toolId: tool.descriptor.toolId,
      version: tool.descriptor.version, modelDigest: tool.modelDigest, runtimeVersion: tool.runtimeVersion })),
    missingCapabilities: snapshot.missingCapabilities,
  };
}

async function observe(deviceId: string, local: boolean, sample: () => Promise<NodeSnapshot>) {
  const start = performance.now();
  try {
    const snapshot = await sample();
    invariant(snapshot?.protocolVersion === 1 && snapshot.identity?.deviceId === deviceId &&
      snapshot.state && Array.isArray(snapshot.tools) && Array.isArray(snapshot.missingCapabilities), 'INVALID_NODE_SNAPSHOT');
    return { deviceId, local, status: 'observed' as const, receivedAt: Date.now(),
      requestDurationMs: performance.now() - start, error: null, snapshot: nodeView(snapshot) };
  } catch (error) {
    return { deviceId, local, status: 'unavailable' as const, receivedAt: Date.now(),
      requestDurationMs: performance.now() - start, error: errorMessage(error), snapshot: null };
  }
}

async function capture(runtime: FleetRuntime) {
  const config = runtime.node.config;
  const nodes = await Promise.all([
    observe(config.deviceId, true, () => runtime.node.snapshot()),
    ...config.peers.map(peer => observe(peer.deviceId, false, () => runtime.transport.snapshot(peer))),
  ]);
  const recent = <T extends { updatedAt: number }>(entries: Array<[string, T]>) =>
    entries.map(([, value]) => value).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
  return {
    schemaVersion: 1, capturedAt: Date.now(), coordinatorId: config.deviceId, mode: config.mode,
    limits: { maxConcurrentLocalTasks: config.maxConcurrentLocalTasks,
      cpuWorkerBudget: config.cpuWorkerBudget, minRemoteSamples: config.minRemoteSamples },
    nodes, scheduler: runtime.node.scheduler.getMetricsSnapshot(),
    runs: recent(runtime.runs.all()).map(runView), attempts: recent(runtime.node.attempts.all()).map(attemptView),
    storage: { audit: 'local-json', cloudDatabase: 'not-configured' },
  };
}

// A single bounded poll per runtime, shared across browser tabs. Monitoring never quotes or submits tasks.
export function dashboardReader(runtime: FleetRuntime): () => Promise<Awaited<ReturnType<typeof capture>>> {
  let pending: ReturnType<typeof capture> | undefined;
  let cache: Awaited<ReturnType<typeof capture>> | undefined;
  return () => {
    if (pending) return pending;
    if (cache && Date.now() - cache.capturedAt < 1500) return Promise.resolve(cache);
    pending = capture(runtime).then(value => { cache = value; return value; }).finally(() => { pending = undefined; });
    return pending;
  };
}
