import { RuntimeWorkScope } from './runtime-work-scope';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ExecutorRegistryService } from './executor-registry.service';
import { RuntimeRunService } from './runtime-run.service';
import { TelemetryService } from './telemetry.service';
import { TelemetryRecord } from './runtime.contracts';

@Injectable()
export class RuntimeRunnerService {
  private readonly active = new Map<string, { controller: AbortController; pending?: Promise<void>; grace?: ReturnType<typeof setTimeout> }>();
  constructor(private readonly runs: RuntimeRunService,
    private readonly registry: ExecutorRegistryService,
    private readonly telemetry: TelemetryService) {}

  cancel(runId: string): boolean {
    const active = this.active.get(runId);
    if (!active) return false;
    active.controller.abort(new Error('RUNTIME_CANCELLED'));
    return true;
  }

  async execute<T>(runId: string, input: unknown, externalSignal?: AbortSignal): Promise<T> {
    const run = this.runs.get(runId);
    if (!run || !run.taskGraph || !run.executionPlan) throw new Error('RUNTIME_RUN_NOT_PLANNED');
    if (run.status === 'blocked') throw new ServiceUnavailableException({ code: 'RUNTIME_BLOCKED', runId,
      requirements: run.executionPlan.missingRequirements });
    if (run.status !== 'ready' || this.active.has(runId)) throw new ConflictException('RUNTIME_ALREADY_EXECUTED');
    const { executionPlan: plan, taskGraph: graph } = run;
    const outputs = new Map<string, unknown>();
    const controller = new AbortController();
    const cancelExternal = () => controller.abort(new Error('RUNTIME_CANCELLED'));
    externalSignal?.addEventListener('abort', cancelExternal, { once: true });
    if (externalSignal?.aborted) cancelExternal();
    const active: { controller: AbortController; pending?: Promise<void>; grace?: ReturnType<typeof setTimeout> } = { controller };
    this.active.set(runId, active);
    run.executionState = 'running';
    const requestStop = () => {
      run.executionState = 'stop_requested';
      run.stopRequestedAt ??= new Date().toISOString();
      run.updatedAt = run.stopRequestedAt;
      run.stopReason = controller.signal.reason?.message === 'RUNTIME_TIMEOUT' ? 'RUNTIME_TIMEOUT' : 'RUNTIME_CANCELLED';
      active.grace = setTimeout(() => {
        if (run.executionState === 'stop_requested') {
          run.executionState = 'stop_unconfirmed';
          run.updatedAt = new Date().toISOString();
        }
      }, 5000);
      active.grace.unref?.();
    };
    controller.signal.addEventListener('abort', requestStop, { once: true });
    if (controller.signal.aborted) requestStop();
    run.status = 'running';
    const started = Date.now();
    try {
      // Validate the entire plan before the first side effect.
      if (plan.executionOrder.length !== graph.nodes.length ||
          new Set(plan.executionOrder).size !== graph.nodes.length ||
          plan.assignments.length !== graph.nodes.length) throw new Error('RUNTIME_INCOMPLETE_PLAN');
      for (const taskId of plan.executionOrder) {
        const task = graph.nodes.find(node => node.taskId === taskId);
        const assignment = plan.assignments.find(item => item.taskId === taskId);
        if (!task || !assignment || assignment.toolId !== task.toolId) throw new Error('RUNTIME_INVALID_ASSIGNMENT');
        this.registry.require(assignment.executorId, assignment.toolId);
        const index = plan.executionOrder.indexOf(taskId);
        if ((task.dependencies ?? []).some(id => !plan.executionOrder.slice(0, index).includes(id))) {
          throw new Error('RUNTIME_DEPENDENCY_ORDER_INVALID');
        }
      }
      for (const taskId of plan.executionOrder) {
        const task = graph.nodes.find(node => node.taskId === taskId)!;
        const assignment = plan.assignments.find(item => item.taskId === taskId)!;
        if ((task.dependencies ?? []).some(id => !outputs.has(id))) throw new Error('RUNTIME_DEPENDENCY_FAILED');
        const began = Date.now();
        assignment.status = 'running';
        assignment.startedAt = new Date(began).toISOString();
        const timeoutMs = Math.max(1, Math.min(task.constraints?.maxLatencyMs ?? 120000,
          (task.constraints?.deadlineMs ?? 120000) - (began - started)));
        let fallbackOccurred = false;
        const measurements = { storageReadMs: 0, storageWriteMs: 0, modelMs: 0 };
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abortListener: (() => void) | undefined;
        let settled = true;
        let settlement: Promise<void> | undefined;
        try {
          controller.signal.throwIfAborted();
          const deadline = new Promise<never>((_, reject) => {
            abortListener = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', abortListener, { once: true });
            timer = setTimeout(() => controller.abort(new Error('RUNTIME_TIMEOUT')), timeoutMs);
          });
          settled = false;
          const work = RuntimeWorkScope.run(controller.signal, measurements, () => this.registry.require(assignment.executorId, assignment.toolId).execute({
            runId, task, assignment, input, outputs, signal: controller.signal,
          }));
          settlement = work.then(() => { settled = true; }, () => { settled = true; });
          active.pending = settlement;
          const result = await Promise.race([work, deadline]);
          controller.signal.throwIfAborted();
          if (result && typeof result === 'object') {
            const value = result as { fallback?: unknown; session?: { degraded?: boolean } };
            fallbackOccurred = Boolean(value.fallback) || value.session?.degraded === true;
          }
          outputs.set(taskId, result);
          assignment.status = 'succeeded';
        } catch (error) {
          const reason = controller.signal.aborted ? controller.signal.reason : error;
          assignment.errorCode = reason instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(reason.message)
            ? reason.message : 'RUNTIME_EXECUTION_FAILED';
          assignment.status = assignment.errorCode === 'RUNTIME_TIMEOUT' ? 'timed_out'
            : assignment.errorCode === 'RUNTIME_CANCELLED' ? 'cancelled' : 'failed';
          throw reason;
        } finally {
          if (timer) clearTimeout(timer);
          if (abortListener) controller.signal.removeEventListener('abort', abortListener);
          const recordSettled = () => {
            assignment.finishedAt = new Date().toISOString();
            const record: TelemetryRecord = {
              executionId: `${runId}:${taskId}`, taskId, toolId: task.toolId,
              executorId: assignment.executorId, startedAt: assignment.startedAt!,
              finishedAt: assignment.finishedAt, latencyMs: Date.now() - began,
              latencyScope: 'execution_only', memoryPeakMb: process.memoryUsage().rss / 1048576,
              metadata: { segmentedTiming: { ...measurements, queueMs: 0, uploadMs: null, downloadMs: null,
                executionMs: Math.max(0, Date.now() - began - measurements.storageReadMs - measurements.storageWriteMs) },
                segmentSource: 'server-monotonic-clock', memorySource: 'process-rss-at-stage-finish', transferTiming: 'not-observable-on-server',
                cancellation: 'executor promise settled; remote acknowledgement unavailable; committed side effects are not rolled back',
                stopRequestedAt: run.stopRequestedAt ?? null },
              fallbackOccurred, success: assignment.status === 'succeeded', errorCode: assignment.errorCode,
            };
            this.runs.recordTelemetry(runId, record);
            this.telemetry.record(record);
          };
          if (settled) recordSettled();
          else active.pending = settlement!.then(recordSettled);
        }
      }
      this.runs.complete(runId, 'workflow_completed');
      return outputs.get(plan.executionOrder[plan.executionOrder.length - 1]) as T;
    } catch (error) {
      const code = controller.signal.aborted ? controller.signal.reason?.message :
        plan.assignments.find(item => item.status === 'failed')?.errorCode ??
        (error instanceof Error && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'RUNTIME_EXECUTION_FAILED');
      this.runs.fail(runId, code);
      if (code === 'RUNTIME_TIMEOUT') run.status = 'timed_out';
      if (code === 'RUNTIME_CANCELLED') run.status = 'cancelled';
      for (const assignment of plan.assignments) {
        if (assignment.status === 'planned') {
          assignment.status = run.status === 'cancelled' ? 'cancelled' : 'blocked';
          assignment.errorCode = 'RUNTIME_PREDECESSOR_FAILED';
          assignment.finishedAt = new Date().toISOString();
        }
      }
      throw new ServiceUnavailableException({ code, runId });
    } finally {
      const cleanup = () => {
        if (active.grace) clearTimeout(active.grace);
        run.executionState = 'settled';
        run.executionSettledAt = new Date().toISOString();
        run.updatedAt = run.executionSettledAt;
        this.active.delete(runId);
        controller.signal.removeEventListener('abort', requestStop);
      };
      if (active.pending) void active.pending.then(cleanup, cleanup);
      else cleanup();
      externalSignal?.removeEventListener('abort', cancelExternal);
    }
  }
}
