import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { AttemptRecord, AttemptRequest, BoardAdapter, NodeSnapshot, Quote, QuoteRequest, RuntimeConfig } from '../contracts/fleet';
import { SchedulerService } from '../scheduler/api/SchedulerService';
import { AccuracyPreference, Backend, PolicyMode, QueueAction, TaskHandle, TaskRequest, TaskStatus } from '../scheduler/api/SchedulerTypes';
import { ToolRegistry, contextFor, remoteAllowed, validateConstraints } from './tool-registry';
import { byteLength, digest, errorMessage, finite, identifier, invariant, JsonStore } from './util';

export const attemptKey = (request: Pick<AttemptRequest, 'originDeviceId' | 'epoch' | 'attemptId'>): string =>
  digest([request.originDeviceId, request.epoch, request.attemptId]);
const terminal = (record: AttemptRecord): boolean => !['accepted', 'running'].includes(record.status);

export class BoardNode {
  readonly bootId = randomUUID();
  readonly scheduler = new SchedulerService();
  readonly attempts: JsonStore<AttemptRecord>;
  private readonly handles = new Map<string, TaskHandle<unknown>>();
  private readonly pending = new Set<string>();
  private sampler?: ReturnType<typeof setInterval>;
  private sampling = false;
  private closed = false;

  constructor(readonly config: RuntimeConfig, readonly adapter: BoardAdapter, readonly registry: ToolRegistry) {
    this.attempts = new JsonStore(join(config.dataDir, 'attempts'));
    for (const [key, record] of this.attempts.all()) if (!terminal(record)) {
      this.attempts.put(key, { ...record, status: 'unknown', reason: 'NODE_RESTARTED_NO_AUTOMATIC_REPLAY', updatedAt: Date.now() });
    }
  }

  async start(): Promise<void> {
    const policyFile = join(this.config.dataDir, `policy-${this.adapter.identity.environmentKey}.json`);
    await this.scheduler.initialize({ defaultPolicyMode: PolicyMode.ADAPTIVE, enableDebugInjection: false,
      metricsWindowSize: 100, minimumTierHoldMs: 30000, upgradeStableDurationMs: 5000, executors: [],
      maxConcurrentLocalTasks: this.config.maxConcurrentLocalTasks, cpuWorkerBudget: this.config.cpuWorkerBudget,
      policyStateStore: {
        load: async () => { try { return readFileSync(policyFile, 'utf8'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error;
        } },
        save: async value => { writeFileSync(`${policyFile}.tmp`, value, { mode: 0o600 }); renameSync(`${policyFile}.tmp`, policyFile); },
      },
    });
    for (const tool of this.registry.values()) {
      const executor = tool.executor;
      this.scheduler.registerExecutor({ ...executor, execute: async (input, plan, signal, checkpoint) => {
        const probe = await tool.probe();
        invariant(probe.available, probe.reason ?? 'EXECUTOR_PROBE_FAILED');
        const result = await executor.execute(input, plan, signal, checkpoint);
        invariant(byteLength(result.output) <= 512 * 1024, 'OUTPUT_TOO_LARGE');
        return result;
      } });
    }
    await this.refresh();
    this.sampler = setInterval(() => {
      if (this.sampling || this.closed) return;
      this.sampling = true;
      this.refresh().catch(() => { /* Old observations expire in DeviceStateController. */ })
        .finally(() => { this.sampling = false; });
    }, 1000);
    this.sampler.unref();
  }

  async refresh(): Promise<void> {
    const backends = new Set<Backend>();
    for (const tool of this.registry.values()) {
      try { if ((await tool.probe()).available) for (const profile of tool.template.manifest!.profiles) backends.add(profile.backend); }
      catch { /* A failed model probe never advertises an accelerator. */ }
    }
    // Slow SDK probes must not make an earlier resource observation appear freshly sampled.
    const patch = await this.adapter.sample();
    patch.availableBackends = [...new Set([...(patch.availableBackends ?? []), ...backends])];
    this.scheduler.updateRealDeviceState(patch);
  }

  async snapshot(): Promise<NodeSnapshot> {
    await this.refresh();
    const missing: string[] = [];
    const tools = [];
    for (const tool of this.registry.values()) {
      const probe = await tool.probe();
      if (probe.available) tools.push(this.registry.info(tool.descriptor.toolId));
      else missing.push(`${tool.descriptor.toolId}:${probe.reason ?? 'UNAVAILABLE'}`);
    }
    if (!this.registry.values().some(t => t.template.manifest?.profiles.some(p => p.backend === Backend.NPU)))
      missing.push('NOE_NPU_WORKER_NOT_CONFIGURED');
    return { protocolVersion: 1, bootId: this.bootId, identity: this.adapter.identity,
      state: this.scheduler.getDeviceState(), tools, missingCapabilities: missing };
  }

  private request(value: QuoteRequest, input: unknown, taskId?: string): TaskRequest<unknown> {
    const tool = this.registry.get(value.toolId);
    const budget = Math.min(value.remainingMs, value.constraints.maxLatencyMs ?? Infinity,
      tool.descriptor.constraints.maxLatencyMs ?? Infinity);
    const context = contextFor(value.constraints, budget);
    context.inputShape = [Math.max(1, value.inputBytes)];
    const template = structuredClone(tool.template);
    // Every model/SDK/kernel combination has a separate cost bucket.
    template.resourceHints.modelVersion = `${tool.modelDigest}:${tool.runtimeVersion}`;
    template.resourceHints.baselineInputElements = 1024;
    return { taskId, taskType: template.taskType, inferenceLocation: template.inferenceLocation,
      capability: value.toolId, input, accuracyPreference: AccuracyPreference.QUALITY_FIRST,
      allowDegrade: false, allowPause: false, timeoutMs: Math.min(template.timeoutMs, budget),
      latencyBudgetMs: budget, template, context,
      submittedAt: Date.now(), metadata: { environmentKey: this.adapter.identity.environmentKey } };
  }

  async quote(value: QuoteRequest): Promise<Quote> {
    const state = () => this.scheduler.getDeviceState();
    try {
      invariant(!this.closed, 'NODE_STOPPING');
      invariant(value && identifier(value.toolId) && finite(value.inputBytes, 0, 512 * 1024), 'INVALID_QUOTE');
      validateConstraints(value.constraints);
      const tool = this.registry.get(value.toolId);
      const info = this.registry.info(value.toolId);
      invariant(tool.descriptor.constraints.energyBudgetMah === undefined && tool.descriptor.constraints.costBudgetMinorUnits === undefined,
        'UNMEASURED_TOOL_BUDGET');
      invariant(info.contractDigest === value.contractDigest && info.modelDigest === value.modelDigest, 'TOOL_OR_MODEL_MISMATCH');
      invariant(tool.descriptor.constraints.allowLocal && tool.descriptor.constraints.locality !== 'cloud_only' &&
        value.constraints.locality !== 'cloud_only', 'CLOUD_EXECUTOR_NOT_CONFIGURED');
      invariant((value.constraints.minimumQuality ?? 0) <= (tool.descriptor.quality.minimumScore ?? 0), 'QUALITY_NOT_VALIDATED');
      const probe = await tool.probe();
      invariant(probe.available, probe.reason ?? 'EXECUTOR_UNAVAILABLE');
      await this.refresh();
      const limit = Math.min(value.remainingMs, tool.descriptor.constraints.maxLatencyMs ?? Infinity);
      const request = this.request({ ...value, remainingMs: limit }, null);
      const plan = this.scheduler.evaluate({ ...request, latencyBudgetMs: request.latencyBudgetMs ?? null });
      const reasons = [...plan.reasonCodes];
      let accepted = plan.queueAction === QueueAction.ENQUEUE;
      if (!tool.executor.supports(plan)) { accepted = false; reasons.push('EXECUTOR_PROFILE_UNSUPPORTED'); }
      if ((plan.executionProfile?.workerCount ?? Infinity) > this.config.cpuWorkerBudget) {
        accepted = false; reasons.push('WORKER_BUDGET_EXCEEDED');
      }
      const metrics = this.scheduler.getMetricsSnapshot();
      // Pending work has unknown input sizes. Refuse a speculative queue bound on a busy target.
      const busy = metrics.runningCount + metrics.queuedCount > 0;
      if (busy) { accepted = false; reasons.push('TARGET_BUSY_RETRY_AFTER_COMPLETION'); }
      return { deviceId: this.config.deviceId, bootId: this.bootId,
        environmentKey: `${this.adapter.identity.environmentKey}:${tool.runtimeVersion}:${tool.modelDigest}`,
        toolId: value.toolId, accepted, reasons, plan, state: state(), queueMs: 0,
        computeMs: plan.prediction?.latencyMs ?? Infinity, sampleCount: plan.prediction?.sampleCount ?? 0 };
    } catch (error) {
      return { deviceId: this.config.deviceId, bootId: this.bootId, environmentKey: this.adapter.identity.environmentKey,
        toolId: value?.toolId ?? '', accepted: false, reasons: [errorMessage(error)], state: state(),
        queueMs: 0, computeMs: 0, sampleCount: 0 };
    }
  }

  async submit(value: AttemptRequest): Promise<AttemptRecord> {
    invariant(value && [value.originDeviceId, value.epoch, value.attemptId, value.targetDeviceId].every(identifier), 'INVALID_ATTEMPT_ID');
    invariant(value.targetDeviceId === this.config.deviceId, 'WRONG_TARGET_DEVICE');
    const key = attemptKey(value);
    const requestDigest = digest(value);
    const existing = this.attempts.get(key);
    if (existing) { invariant(existing.requestDigest === requestDigest, 'ATTEMPT_ID_REUSED_WITH_DIFFERENT_PAYLOAD'); return existing; }
    invariant(value.bootId === this.bootId, 'TARGET_RESTARTED_REQUOTE_REQUIRED');
    invariant(!this.closed && this.pending.size < this.config.maxPendingTasks, 'NODE_CAPACITY_EXCEEDED');
    let record: AttemptRecord = { key, requestDigest, originDeviceId: value.originDeviceId, bootId: this.bootId,
      status: 'accepted', createdAt: Date.now(), updatedAt: Date.now() };
    this.attempts.put(key, record);
    this.pending.add(key); // Reserved before the first await: concurrent duplicates cannot execute twice.
    const arrival = performance.now();
    try {
      invariant(byteLength(value.input) === value.inputBytes, 'INPUT_SIZE_MISMATCH');
      if (value.originDeviceId !== this.config.deviceId) invariant(
        remoteAllowed(this.registry.get(value.toolId).descriptor, value.constraints, this.config.deviceId), 'REMOTE_DATA_POLICY_REJECTED');
      const quote = await this.quote(value);
      invariant(quote.accepted, quote.reasons.join(','));
      invariant(this.attempts.get(key)?.status !== 'cancelled', 'CANCELLED_BEFORE_ADMISSION');
      const remainingMs = value.remainingMs - (performance.now() - arrival);
      invariant(remainingMs > quote.computeMs, 'INSUFFICIENT_REMAINING_DEADLINE');
      const handle = await this.scheduler.submitTask<unknown, unknown>(this.request({ ...value, remainingMs }, value.input, key));
      this.handles.set(key, handle);
      record = { ...record, status: 'running', updatedAt: Date.now() };
      this.attempts.put(key, record);
      void handle.result.then(result => {
        const status = result.status === TaskStatus.SUCCEEDED ? 'completed' :
          result.status === TaskStatus.CANCELLED || result.status === TaskStatus.TIMED_OUT ? 'cancelled' : 'failed';
        this.attempts.put(key, { ...record, result, status, updatedAt: Date.now() });
      }).finally(() => { this.handles.delete(key); this.pending.delete(key); });
      return record;
    } catch (error) {
      record = { ...record, status: this.attempts.get(key)?.status === 'cancelled' ? 'cancelled' : 'rejected',
        reason: errorMessage(error), updatedAt: Date.now() };
      this.attempts.put(key, record); this.pending.delete(key); return record;
    }
  }

  get(key: string): AttemptRecord | undefined { return this.attempts.get(key); }
  async cancel(key: string): Promise<AttemptRecord | undefined> {
    const record = this.attempts.get(key);
    if (!record || terminal(record)) return record;
    const handle = this.handles.get(key);
    if (handle) await handle.cancel(); // STOP_REQUESTED still occupies the execution slot.
    else this.attempts.put(key, { ...record, status: 'cancelled', reason: 'CANCELLED_BEFORE_ADMISSION', updatedAt: Date.now() });
    return this.attempts.get(key);
  }
  async close(): Promise<void> { this.closed = true; clearInterval(this.sampler); await this.scheduler.shutdown(); }
}
