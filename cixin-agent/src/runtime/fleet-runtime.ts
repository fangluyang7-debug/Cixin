import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TaskGraph, TaskIntent } from '../contracts/cixin';
import { AttemptRecord, AttemptRequest, Candidate, FleetConstraints, FleetDecision, PeerConfig, Quote, QuoteRequest,
  RunRecord, TaskSubmission } from '../contracts/fleet';
import { Backend, DependencyFailurePolicy, DeviceStateSource, ModelTier, PrivacyPolicy } from '../scheduler/api/SchedulerTypes';
import { GlobalPlacementPolicy, PlacementDeviceProfile, PlacementLinkProfile, PlacementMode, PlacementSource } from '../scheduler/placement/PlacementPolicy';
import { planWorkflowCosts } from '../scheduler/policy/WorkflowPlanner';
import { BoardNode, attemptKey } from './board-node';
import { HttpTransport, PeerTransport } from './transport';
import { remoteAllowed, validateConstraints } from './tool-registry';
import { byteLength, digest, errorMessage, finite, identifier, invariant, JsonStore } from './util';

export function topological(graph: TaskGraph): TaskIntent[] {
  invariant(graph && identifier(graph.graphId) && Array.isArray(graph.nodes) && graph.nodes.length > 0 && graph.nodes.length <= 64, 'INVALID_GRAPH');
  const nodes = new Map(graph.nodes.map(node => [node.taskId, node]));
  invariant(nodes.size === graph.nodes.length, 'DUPLICATE_GRAPH_NODE');
  for (const node of graph.nodes) invariant(identifier(node.taskId) && identifier(node.toolId) &&
    typeof node.inputRef === 'string' && (!node.dependencies || Array.isArray(node.dependencies) &&
    node.dependencies.every(id => nodes.has(id) && id !== node.taskId)), 'INVALID_NODE_DEPENDENCY');
  const ordered: TaskIntent[] = [];
  const completed = new Set<string>();
  while (ordered.length < nodes.size) {
    const ready = graph.nodes.filter(node => !completed.has(node.taskId) && (node.dependencies ?? []).every(id => completed.has(id)));
    invariant(ready.length, 'GRAPH_CYCLE');
    for (const node of ready) { completed.add(node.taskId); ordered.push(node); }
  }
  return ordered;
}
const finished = (value: AttemptRecord): boolean => !['accepted', 'running'].includes(value.status);

export class FleetRuntime {
  readonly epoch = randomUUID();
  readonly runs: JsonStore<RunRecord>;
  private readonly placement = new GlobalPlacementPolicy();
  private readonly active = new Map<string, Promise<void>>();
  constructor(readonly node: BoardNode, readonly transport: PeerTransport = new HttpTransport()) {
    this.runs = new JsonStore(join(node.config.dataDir, 'runs'));
    for (const [id, run] of this.runs.all()) if (run.status === 'planning' || run.status === 'running')
      this.runs.put(id, { ...run, status: 'unknown', reason: 'COORDINATOR_RESTARTED_RECONCILE_ATTEMPT', updatedAt: Date.now() });
  }
  private save(run: RunRecord): void { run.updatedAt = Date.now(); this.runs.put(run.runId, run); }
  private peer(deviceId: string): PeerConfig { const peer = this.node.config.peers.find(p => p.deviceId === deviceId); invariant(peer, 'PEER_NOT_ENROLLED'); return peer; }
  private requirements(task: TaskSubmission, remainingMs: number): QuoteRequest {
    invariant(task && identifier(task.toolId) && Object.hasOwn(task, 'input'), 'INVALID_TASK');
    const constraints = task.constraints ?? {};
    validateConstraints(constraints);
    invariant(byteLength(task.input) <= 512 * 1024, 'INPUT_TOO_LARGE');
    const info = this.node.registry.info(task.toolId);
    return { toolId: task.toolId, constraints, remainingMs, inputBytes: byteLength(task.input),
      contractDigest: info.contractDigest, modelDigest: info.modelDigest };
  }
  private validateQuote(quote: Quote, expected: string, toolId: string): void {
    invariant(quote && quote.deviceId === expected && quote.toolId === toolId && identifier(quote.bootId) &&
      typeof quote.environmentKey === 'string' && typeof quote.accepted === 'boolean' && Array.isArray(quote.reasons) &&
      quote.state && quote.state.source === DeviceStateSource.REAL && finite(quote.queueMs) && finite(quote.computeMs) && finite(quote.sampleCount), 'INVALID_PEER_QUOTE');
    if (quote.accepted) invariant(quote.plan?.executionProfile && quote.plan.policyAudit &&
      quote.plan.prediction && finite(quote.plan.prediction.latencyMs, 1), 'MISSING_EXECUTION_PROFILE');
  }
  async plan(task: TaskSubmission, remainingMs = task.constraints?.deadlineMs ?? 10000): Promise<FleetDecision> {
    const request = this.requirements(task, remainingMs);
    const started = performance.now();
    const localId = this.node.config.deviceId;
    const tool = this.node.registry.get(task.toolId).descriptor;
    const candidates: Candidate[] = [];
    const links: PlacementLinkProfile[] = [];
    const collect = async (deviceId: string, peer?: PeerConfig) => {
      const candidate: Candidate = { deviceId, accepted: false, reasons: [], transferMs: 0, totalMs: 0, uncertaintyMs: 0 };
      candidates.push(candidate);
      try {
        if (request.constraints.allowedDeviceIds) invariant(request.constraints.allowedDeviceIds.includes(deviceId), 'DEVICE_NOT_ALLOWED');
        if (peer) invariant(remoteAllowed(tool, request.constraints, deviceId), 'REMOTE_DATA_POLICY_REJECTED');
        const before = performance.now();
        const quote = peer ? await this.transport.quote(peer, request) : await this.node.quote(request);
        const elapsed = performance.now() - before;
        this.validateQuote(quote, deviceId, task.toolId);
        quote.receivedAtMs = Date.now(); candidate.quote = quote;
        invariant(quote.accepted, quote.reasons.join(','));
        // Real local execution samples are mandatory before automatic remote placement.
        if (peer && this.node.config.mode === 'ACTIVE') invariant(quote.sampleCount >= this.node.config.minRemoteSamples, 'INSUFFICIENT_REMOTE_SAMPLES');
        if (peer) links.push({ fromDeviceId: localId, toDeviceId: deviceId, receivedAtMs: Date.now(), sampleAgeMs: 0,
          rttMs: elapsed, bytesPerSecond: peer.bytesPerSecond, protocolMs: 0 });
        candidate.accepted = true;
      } catch (error) { candidate.reasons.push(errorMessage(error)); }
    };
    await Promise.all([collect(localId), ...(this.node.config.mode === 'LOCAL_ONLY' ? [] :
      this.node.config.peers.map(peer => collect(peer.deviceId, peer)))]);
    const devices: PlacementDeviceProfile[] = candidates.filter(c => c.accepted).map(candidate => {
      const q = candidate.quote!; const state = q.state;
      const local = candidate.deviceId === localId;
      const fieldAge = (field: string): number | null => state.sampledAt?.[field] === undefined ? null :
        Math.max(0, state.capturedAt - state.sampledAt[field]);
      return { deviceId: candidate.deviceId, local, environmentKey: q.environmentKey, computeIsCurrentPrediction: true,
        source: PlacementSource.REAL, trusted: true, online: true,
        receivedAtMs: q.receivedAtMs!, heartbeatAgeMs: 0,
        thermalAgeMs: fieldAge('thermalLevel'), memoryAgeMs: fieldAge('availableMemoryMb'), cpuAgeMs: fieldAge('systemCpuUsage'),
        thermalLevel: state.thermalLevel, memoryPressure: state.memoryPressure,
        availableMemoryMb: state.availableMemoryMb, cpuUsage: state.systemCpuUsage,
        availableBackends: [q.plan!.executionProfile!.backend], modelVersions: [request.modelDigest], loadedModelVersions: [],
        queueWaitMs: q.queueMs, computeMs: q.computeMs, coldLoadMs: 0,
        allowUnknownThermalForCpuFallback: q.plan!.executionProfile!.backend === Backend.CPU &&
          q.plan!.executionProfile!.safeUnderPressure && q.plan!.executionProfile!.qualityValidated,
      };
    });
    const budget = remainingMs - (performance.now() - started);
    const signature = `${task.toolId}:${request.contractDigest}:${Math.floor(Math.log2(Math.max(1, request.inputBytes)))}`;
    const result = this.placement.evaluate({ capability: task.toolId, modelVersion: request.modelDigest,
      taskSignature: signature, deadlineMs: budget, userWaiting: true, qualityFloor: ModelTier.HIGH_ACCURACY,
      privacyPolicy: PrivacyPolicy.REMOTE_ALLOWED, networkAllowed: request.constraints.allowRemote === true,
      inputSanitized: request.constraints.inputSanitized === true, allowedDeviceIds: request.constraints.allowedDeviceIds,
      requiredBackend: Backend.CPU, allowedBackends: [Backend.CPU, Backend.GPU, Backend.NPU],
      minimumMemoryMb: tool.resourceHints.estimatedMemoryMb, inputBytes: request.inputBytes,
      outputBytes: 512 * 1024, // Protocol output cap, a conservative transfer bound.
    }, localId, devices, links, PlacementMode.SHADOW);
    for (const c of candidates) if (c.accepted) {
      const estimate = result.estimates.find(e => e.deviceId === c.deviceId);
      if (!estimate) { c.accepted = false; c.reasons.push('STALE_OR_UNAVAILABLE_DEVICE_METRICS'); continue; }
      c.transferMs = estimate.transferMs; c.totalMs = estimate.totalMs; c.uncertaintyMs = estimate.uncertaintyMs;
      if (estimate.totalMs + estimate.uncertaintyMs > budget) { c.accepted = false; c.reasons.push('DEADLINE_INFEASIBLE'); }
    }
    const local = candidates.find(c => c.deviceId === localId && c.accepted);
    const best = candidates.filter(c => c.accepted).sort((a, b) =>
      a.totalMs + a.uncertaintyMs - b.totalMs - b.uncertaintyMs || a.deviceId.localeCompare(b.deviceId))[0];
    // Preserve the original 10 ms hysteresis. No arbitrary first-node or board-model preference.
    const suggested = best && (!local || best.totalMs + best.uncertaintyMs + 10 < local.totalMs) ? best : local;
    const selected = this.node.config.mode === 'ACTIVE' ? suggested : local;
    return { mode: this.node.config.mode, status: selected ? 'ready' : 'blocked',
      selectedDeviceId: selected?.deviceId ?? null, suggestedDeviceId: suggested?.deviceId ?? null, candidates };
  }

  submit(task: TaskSubmission): RunRecord {
    const cloned = structuredClone(task);
    if (cloned.taskId !== undefined) invariant(identifier(cloned.taskId), 'INVALID_CLIENT_TASK_ID');
    this.requirements(cloned, cloned.constraints?.deadlineMs ?? 10000);
    invariant(this.active.size < this.node.config.maxPendingTasks, 'COORDINATOR_CAPACITY_EXCEEDED');
    const run: RunRecord = { runId: randomUUID(), clientTaskId: cloned.taskId,
      status: 'planning', createdAt: Date.now(), updatedAt: Date.now() };
    this.save(run);
    const work = this.execute(run, cloned).catch(error => { run.status = 'failed'; run.reason = errorMessage(error); this.save(run); })
      .finally(() => { this.active.delete(run.runId); });
    this.active.set(run.runId, work);
    return structuredClone(run);
  }

  private async execute(run: RunRecord, task: TaskSubmission): Promise<void> {
    const start = performance.now();
    const budget = Math.min(task.constraints?.deadlineMs ?? 10000, task.constraints?.maxLatencyMs ?? Infinity,
      this.node.registry.get(task.toolId).descriptor.constraints.maxLatencyMs ?? Infinity);
    run.decision = await this.plan(task, budget);
    if (run.decision.status === 'blocked') { run.status = 'blocked'; this.save(run); return; }
    const target = run.decision.selectedDeviceId!;
    const candidate = run.decision.candidates.find(c => c.deviceId === target)!;
    const peer = target === this.node.config.deviceId ? undefined : this.peer(target);
    const remainingMs = budget - (performance.now() - start) - candidate.transferMs;
    if (remainingMs < candidate.quote!.computeMs) { run.status = 'blocked'; run.reason = 'DEADLINE_EXPIRED_BEFORE_DISPATCH'; this.save(run); return; }
    const request: AttemptRequest = { ...this.requirements(task, remainingMs), input: task.input,
      originDeviceId: this.node.config.deviceId, epoch: this.epoch, attemptId: run.runId,
      targetDeviceId: target, bootId: candidate.quote!.bootId };
    run.attemptKey = attemptKey(request); run.targetDeviceId = target; run.status = 'running'; this.save(run);
    // Once sent, a lost response is ambiguous. Never send an automatic replacement elsewhere.
    try {
      let attempt = peer ? await this.transport.submit(peer, request) : await this.node.submit(request);
      this.validateAttempt(attempt, run);
      while (!finished(attempt) && performance.now() - start < budget) {
        await delay(Math.min(50, Math.max(1, budget - (performance.now() - start))));
        attempt = peer ? await this.transport.get(peer, run.attemptKey) : this.node.get(run.attemptKey)!;
        this.validateAttempt(attempt, run);
      }
      if (performance.now() - start >= budget) {
        if (!finished(attempt)) await (peer ? this.transport.cancel(peer, run.attemptKey) : this.node.cancel(run.attemptKey));
        run.status = finished(attempt) ? 'failed' : 'unknown';
        run.reason = 'SOURCE_DEADLINE_EXCEEDED_RESULT_DISCARDED';
        // Do not expose an output that arrived beyond the source budget.
        run.result = { ...attempt, result: attempt.result ? { ...attempt.result, output: null } : undefined };
      } else {
        run.result = attempt;
        run.status = attempt.status === 'completed' ? 'completed' : attempt.status === 'unknown' ? 'unknown' : 'failed';
        if (attempt.status === 'completed' && attempt.result?.executionPlan.policyAudit?.actualConfirmed) {
          this.placement.observe({ taskSignature: `${task.toolId}:${request.contractDigest}:${Math.floor(Math.log2(Math.max(1, request.inputBytes)))}`,
            modelVersion: request.modelDigest, environmentKey: candidate.quote!.environmentKey, deviceId: target,
            modelWasLoaded: false, source: PlacementSource.REAL, actualConfirmed: true,
            queueMs: attempt.result.queueDurationMs, modelLoadMs: 0, computeMs: attempt.result.executionDurationMs });
        }
      }
    } catch (error) { run.status = 'unknown'; run.reason = `DISPATCH_STATE_UNKNOWN:${errorMessage(error)}`; }
    this.save(run);
  }

  private validateAttempt(attempt: AttemptRecord, run: RunRecord): void {
    invariant(attempt && attempt.key === run.attemptKey && attempt.originDeviceId === this.node.config.deviceId &&
      ['accepted','running','completed','failed','cancelled','rejected','unknown'].includes(attempt.status), 'INVALID_ATTEMPT_RECEIPT');
    if (attempt.status === 'completed') invariant(attempt.result?.executionPlan.policyAudit?.actualConfirmed &&
      byteLength(attempt.result.output) <= 512 * 1024, 'UNCONFIRMED_OR_OVERSIZED_RESULT');
  }

  async reconcile(runId: string): Promise<RunRecord> {
    const run = this.runs.get(runId); invariant(run?.attemptKey && run.targetDeviceId, 'RUN_HAS_NO_ATTEMPT');
    invariant(!this.active.has(runId), 'RUN_STILL_ACTIVE');
    const attempt = run.targetDeviceId === this.node.config.deviceId ? this.node.get(run.attemptKey) :
      await this.transport.get(this.peer(run.targetDeviceId), run.attemptKey);
    invariant(attempt, 'ATTEMPT_NOT_FOUND'); this.validateAttempt(attempt, run);
    // Reconciliation is an audit action, never a late success or a new execution.
    run.result = { ...attempt, result: attempt.result ? { ...attempt.result, output: null } : undefined };
    run.reason = `RECONCILED_${attempt.status.toUpperCase()}_NO_REPLAY`;
    this.save(run); return run;
  }
  async cancel(runId: string): Promise<AttemptRecord | undefined> {
    const run = this.runs.get(runId); invariant(run?.attemptKey && run.targetDeviceId, 'RUN_HAS_NO_ATTEMPT');
    return run.targetDeviceId === this.node.config.deviceId ? this.node.cancel(run.attemptKey) :
      this.transport.cancel(this.peer(run.targetDeviceId), run.attemptKey);
  }
  async wait(runId: string): Promise<RunRecord | undefined> { await this.active.get(runId); return this.runs.get(runId); }

  recordClientTelemetry(runId: string, taskId: string, timing: import('../scheduler/api/SchedulerTypes').CloudClientTiming): RunRecord {
    const run = this.runs.get(runId);
    invariant(run, 'RUN_NOT_FOUND');
    invariant(run.clientTaskId !== undefined && run.clientTaskId === taskId, 'RUNTIME_CLIENT_TASK_MISMATCH');
    const values = [timing.requestMs, timing.inputBytes, timing.outputBytes];
    invariant(values.every(value => finite(value, 0, 128 * 1024 * 1024)), 'CLIENT_TIMING_INVALID');
    for (const value of [timing.uploadMs, timing.downloadMs]) {
      invariant(value === null || finite(value, 0, 128 * 1024 * 1024), 'CLIENT_TIMING_INVALID');
    }
    run.clientTelemetry = { taskId, observedAt: Date.now(), timing: structuredClone(timing) };
    this.save(run);
    return structuredClone(run);
  }

  submitGraph(graph: TaskGraph, inputs: Record<string, unknown>, constraints: FleetConstraints = {}): RunRecord {
    const copy = structuredClone(graph); const boundInputs = structuredClone(inputs);
    const ordered = topological(copy); validateConstraints(constraints);
    invariant(boundInputs && typeof boundInputs === 'object' && byteLength(boundInputs) <= 512 * 1024, 'INVALID_GRAPH_INPUTS');
    for (const node of ordered) {
      this.node.registry.get(node.toolId); validateConstraints(node.constraints ?? {});
      invariant(!node.checkpointPolicy?.enabled && !node.fallbackPolicy?.enabled, 'GRAPH_RESUME_OR_AUTOMATIC_RETRY_NOT_IMPLEMENTED');
      if (node.inputRef.startsWith('task:')) invariant((node.dependencies ?? []).includes(node.inputRef.slice(5)), 'INPUT_REF_NOT_A_DEPENDENCY');
      else invariant(Object.hasOwn(boundInputs, node.inputRef), 'MISSING_GRAPH_INPUT');
    }
    invariant(this.active.size < this.node.config.maxPendingTasks, 'COORDINATOR_CAPACITY_EXCEEDED');
    const run: RunRecord = { runId: randomUUID(), clientTaskId: copy.clientTaskId,
      taskGraph: copy, status: 'running', nodes: {}, createdAt: Date.now(), updatedAt: Date.now() };
    this.save(run);
    const work = (async () => {
      const start = performance.now();
      const deadline = constraints.deadlineMs ?? 10000;
      const privacyRank = ['public', 'internal', 'sensitive', 'high'] as const;
      const propagated = new Map<string, FleetConstraints>();
      const estimates = Object.fromEntries(ordered.map(n => [n.taskId,
        this.node.registry.get(n.toolId).template.qualityLevels[0].estimatedLatencyMs]));
      const costs = planWorkflowCosts(ordered.map(n => ({ id: n.taskId, templateId: n.toolId,
        dependsOn: n.dependencies ?? [], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW })), estimates);
      for (const node of ordered) {
        const input = node.inputRef.startsWith('task:') ? run.nodes![node.inputRef.slice(5)].result?.result?.output : boundInputs[node.inputRef];
        const inherited = (node.dependencies ?? []).map(id => propagated.get(id)!);
        const policy: FleetConstraints = { ...constraints, ...node.constraints };
        policy.privacy = privacyRank[Math.max(privacyRank.indexOf(constraints.privacy ?? 'public'),
          privacyRank.indexOf(node.constraints?.privacy ?? 'public'),
          privacyRank.indexOf(this.node.registry.get(node.toolId).descriptor.constraints.privacy),
          ...inherited.map(p => privacyRank.indexOf(p.privacy ?? 'public')))];
        const nodeConstraints = (node.constraints ?? {}) as FleetConstraints;
        policy.allowRemote = constraints.allowRemote === true && nodeConstraints.allowRemote !== false && inherited.every(p => p.allowRemote === true);
        const lists = [constraints.allowedDeviceIds, nodeConstraints.allowedDeviceIds, ...inherited.map(p => p.allowedDeviceIds)].filter((v): v is string[] => v !== undefined);
        if (lists.length) policy.allowedDeviceIds = lists[0].filter(id => lists.every(list => list.includes(id)));
        if (constraints.locality === 'local_only' || node.constraints?.locality === 'local_only' ||
          this.node.registry.get(node.toolId).descriptor.constraints.locality === 'local_only' || inherited.some(p => p.locality === 'local_only'))
          policy.locality = 'local_only';
        policy.deadlineMs = Math.min(node.constraints?.deadlineMs ?? Infinity, deadline - (performance.now() - start));
        if (policy.deadlineMs < costs.find(c => c.nodeId === node.taskId)!.serialRemainingMs) {
          run.status = 'blocked'; run.reason = 'WORKFLOW_REMAINING_BUDGET_INFEASIBLE'; break;
        }
        propagated.set(node.taskId, policy);
        const child: RunRecord = { runId: randomUUID(), status: 'planning', createdAt: Date.now(), updatedAt: Date.now() };
        await this.execute(child, { toolId: node.toolId, input, constraints: policy });
        run.nodes![node.taskId] = child; this.save(run);
        if (child.status !== 'completed') { run.status = child.status; run.reason = `NODE_${node.taskId}_${child.status}`; break; }
      }
      if (Object.keys(run.nodes!).length === ordered.length && Object.values(run.nodes!).every(n => n.status === 'completed')) run.status = 'completed';
      this.save(run);
    })().catch(error => { run.status = 'failed'; run.reason = errorMessage(error); this.save(run); })
      .finally(() => { this.active.delete(run.runId); });
    this.active.set(run.runId, work); return structuredClone(run);
  }
  async close(): Promise<void> { await Promise.allSettled(this.active.values()); }
}
