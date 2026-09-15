import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createId } from "../../common/utils/id";
import { ExecutionAssignment, RuntimeCheckpoint, RuntimeRun, TaskGraph, TaskIntent, TelemetryRecord, TerminalProtectionEvent } from "./runtime.contracts";
import { PlatformDiscoveryService } from "./platform-discovery.service";
import { ResourcePredictorService, adviceFor } from "./resource-predictor.service";
import { RuntimeEventBusService } from "./runtime-event-bus.service";
import { RuntimeRunService } from "./runtime-run.service";
import { TelemetryService } from "./telemetry.service";
import { ToolRegistryService } from "./tool-registry.service";

/** The adapter owns its side effects. capture/restore must cover every mutable resource it changes. */
export interface GuardedToolHandler {
  toolId: string;
  executorId: string;
  modelId?: string;
  supportsAbort: true;
  capture(): Promise<unknown>;
  execute(input: {
    task: TaskIntent; assignment: ExecutionAssignment; goal: string;
    outputs: Readonly<Record<string, unknown>>; signal: AbortSignal;
    runId: string; executionId: string; checkpointId: string;
  }): Promise<{ output: unknown; memoryPeakMb: number; energyMah?: number; quality?: number }>;
  restore(checkpoint: unknown): Promise<void>;
}

type Active = { controller: AbortController; reason?: string; advice: string[]; startedAt: number;
  current?: ExecutionAssignment; checkpoint?: RuntimeCheckpoint; closed?: boolean };

@Injectable()
export class GuardedExecutionService {
  private readonly handlers = new Map<string, GuardedToolHandler>();
  private readonly active = new Map<string, Active>();
  private readonly starting = new Set<string>();

  constructor(
    private readonly runs: RuntimeRunService,
    private readonly platforms: PlatformDiscoveryService,
    private readonly predictor: ResourcePredictorService,
    private readonly tools: ToolRegistryService,
    private readonly telemetry: TelemetryService,
    private readonly events: RuntimeEventBusService,
  ) {}

  register(handler: GuardedToolHandler) {
    if (!handler.supportsAbort || !handler.capture || !handler.restore || !handler.execute) throw new Error("GUARDED_HANDLER_CONTRACT_INVALID");
    const key = handlerKey(handler);
    if (this.handlers.has(key)) throw new Error(`GUARDED_HANDLER_ALREADY_REGISTERED:${key}`);
    this.handlers.set(key, handler);
  }

  cancel(runId: string) {
    const active = this.active.get(runId);
    if (!active) throw new ConflictException("RUNTIME_RUN_NOT_EXECUTING");
    this.stop(runId, active, "USER_CANCELLED", ["用户已请求取消；等待当前执行器确认停止。"]);
    return this.runs.get(runId);
  }

  reportTerminalProtection(event: TerminalProtectionEvent) {
    const age = Date.now() - Date.parse(event.observedAt);
    if (!Number.isFinite(age) || age < -1000 || age > 10000 || event.workerStopped !== true ||
        !["TERMINAL_THERMAL_REDLINE", "TERMINAL_MEMORY_REDLINE", "TERMINAL_EXECUTOR_LOST"].includes(event.reason)) {
      throw new BadRequestException("TERMINAL_PROTECTION_EVENT_INVALID");
    }
    const active = this.active.get(event.runId);
    if (!active || active.current?.executorId !== event.executorId || active.checkpoint?.executionId !== event.executionId) {
      throw new ConflictException("TERMINAL_PROTECTION_EXECUTION_MISMATCH");
    }
    this.stop(event.runId, active, event.reason, adviceFor([event.reason]));
    return { accepted: true, executionId: event.executionId };
  }

  async execute(runId: string): Promise<RuntimeRun> {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundException("RUNTIME_RUN_NOT_FOUND");
    if (run.status !== "ready" || !run.taskGraph || !run.executionPlan || this.active.size > 0 || this.starting.size > 0) {
      throw new ConflictException("RUNTIME_RUN_NOT_READY_OR_EXECUTOR_BUSY");
    }
    this.starting.add(runId);
    let plan: RuntimeRun;
    try {
      // Re-admit against the latest state and performance data before any side effect.
      plan = await this.runs.attachGraph(runId, run.taskGraph);
      if (plan.status !== "ready" || !plan.executionPlan) return plan;
      let serialMs = 0;
      for (const assignment of plan.executionPlan.assignments) {
        const task = plan.taskGraph!.nodes.find(node => node.taskId === assignment.taskId)!;
        if (task.checkpointPolicy?.enabled === false || !this.handlers.has(handlerKey(assignment))) {
          throw new ConflictException(`GUARDED_EXECUTOR_NOT_BOUND:${assignment.toolId}:${assignment.executorId}`);
        }
      }
      for (const taskId of plan.executionPlan.executionOrder) {
        const assignment = plan.executionPlan.assignments.find(item => item.taskId === taskId)!;
        serialMs += assignment.estimatedLatencyMs ?? 0;
        const task = plan.taskGraph!.nodes.find(item => item.taskId === taskId)!;
        if (serialMs > Math.min(task.constraints?.deadlineMs ?? Infinity, plan.taskGraph!.demand?.deadlineMs ?? Infinity)) {
          throw new ConflictException("GUARDED_SERIAL_DEADLINE_EXCEEDED");
        }
      }
      const active: Active = { controller: new AbortController(), advice: [], startedAt: Date.now() };
      this.active.set(runId, active);
      this.runs.setExecutionState(runId, "running");
    } finally {
      this.starting.delete(runId);
    }
    const graph = plan.taskGraph!;
    const active = this.active.get(runId)!;
    const outputs: Record<string, unknown> = {};
    let monitorBusy = false;
    const monitor = setInterval(async () => {
      if (monitorBusy || active.controller.signal.aborted) return;
      monitorBusy = true;
      try {
        await this.checkRuntime(runId, graph, active);
      } catch {
        this.stop(runId, active, "MONITOR_UNAVAILABLE", ["运行中无法取得设备状态；当前任务停止后再重新探测。"]);
      } finally { monitorBusy = false; }
    }, 500);
    try {
      for (const taskId of plan.executionPlan.executionOrder) {
        if (active.controller.signal.aborted) break;
        const task = graph.nodes.find(node => node.taskId === taskId)!;
        const assignment = plan.executionPlan.assignments.find(item => item.taskId === taskId)!;
        active.current = assignment;
        const handler = this.handlers.get(handlerKey(assignment))!;
        await this.checkRuntime(runId, graph, active, assignment);
        if (active.controller.signal.aborted) break;
        const checkpoint = await handler.capture();
        const capturedAt = new Date().toISOString();
        active.checkpoint = { checkpointId: createId("checkpoint"), executionId: createId("execution"),
          taskId, executorId: assignment.executorId, status: "captured", capturedAt, updatedAt: capturedAt };
        this.runs.recordCheckpoint(runId, active.checkpoint);
        this.events.emit({ type: "checkpoint_captured", runId, taskId, executorId: assignment.executorId,
          payload: { checkpointId: active.checkpoint.checkpointId, executionId: active.checkpoint.executionId }, message: `checkpoint ${taskId} captured` });
        if (active.controller.signal.aborted) { await this.restore(runId, taskId, handler, checkpoint, active); break; }
        const startedAt = new Date().toISOString();
        const start = Date.now();
        try {
          const result = await handler.execute({ task, assignment, goal: graph.goal, outputs: { ...outputs }, signal: active.controller.signal,
            runId, executionId: active.checkpoint.executionId, checkpointId: active.checkpoint.checkpointId });
          await this.checkRuntime(runId, graph, active);
          if (active.controller.signal.aborted) { await this.restore(runId, taskId, handler, checkpoint, active); break; }
          if (!Number.isFinite(result.memoryPeakMb) || result.memoryPeakMb < 0 ||
              (result.energyMah !== undefined && (!Number.isFinite(result.energyMah) || result.energyMah < 0)) ||
              (result.quality !== undefined && (!Number.isFinite(result.quality) || result.quality < 0))) {
            throw new Error("EXECUTOR_MEASUREMENT_INVALID");
          }
          const record: TelemetryRecord = {
            executionId: active.checkpoint.executionId, taskId, toolId: task.toolId,
            executorId: assignment.executorId, modelId: assignment.modelId,
            startedAt, finishedAt: new Date().toISOString(), latencyMs: Date.now() - start,
            memoryPeakMb: result.memoryPeakMb, energyMah: result.energyMah,
            quality: result.quality, fallbackOccurred: false, success: true,
            metadata: { runId, checkpointId: active.checkpoint.checkpointId },
          };
          const verification = this.telemetry.verify(
            assignment,
            this.tools.require(task.toolId),
            record,
            task.constraints,
          );
          const storedRecord = verification.passed
            ? record
            : { ...record, success: false, errorCode: "RESULT_VERIFICATION_FAILED" };
          this.telemetry.record(storedRecord);
          this.runs.recordTelemetry(runId, storedRecord);
          this.runs.recordVerification(runId, { taskId, toolId: task.toolId }, verification);
          if (!verification.passed) {
            this.stop(runId, active, "RESULT_VERIFICATION_FAILED", verification.recommendedActions);
            await this.restore(runId, taskId, handler, checkpoint, active);
            break;
          }
          outputs[taskId] = result.output;
          this.runs.setOutputs(runId, outputs);
          active.checkpoint.status = "committed";
          active.checkpoint.updatedAt = new Date().toISOString();
          this.runs.recordCheckpoint(runId, active.checkpoint);
          this.events.emit({ type: "checkpoint_committed", runId, taskId, toolId: task.toolId,
            payload: { checkpointId: active.checkpoint.checkpointId, executionId: active.checkpoint.executionId }, message: `checkpoint ${taskId} committed` });
          active.checkpoint = undefined;
        } catch (error) {
          this.stop(runId, active, error instanceof Error ? error.message : "EXECUTOR_FAILED", ["检查执行器故障与资源状态后重试。"]);
          await this.restore(runId, taskId, handler, checkpoint, active);
          break;
        }
      }
      const current = this.runs.get(runId)!;
      if (current.status === "rollback_failed") return this.runs.finishProtected(runId, active.reason ?? "ROLLBACK_FAILED", active.advice);
      if (active.reason) return this.runs.finishProtected(runId, active.reason, active.advice);
      return this.runs.complete(runId, "guarded_execution_completed");
    } catch (error) {
      this.stop(runId, active, error instanceof Error ? error.message : "EXECUTION_PROTECTION_FAILED", ["检查调度状态和执行器后重试。"]);
      return this.runs.finishProtected(runId, active.reason!, active.advice);
    } finally {
      active.closed = true;
      clearInterval(monitor);
      this.active.delete(runId);
    }
  }

  private async checkRuntime(runId: string, graph: TaskGraph, active: Active, assignment?: ExecutionAssignment) {
    if (active.controller.signal.aborted || active.closed) return;
    const selected = assignment ?? active.current;
    const task = graph.nodes.find(node => node.taskId === selected?.taskId);
    const deadline = Math.min(graph.demand?.deadlineMs ?? Infinity, task?.constraints?.deadlineMs ?? Infinity);
    if (Date.now() - active.startedAt > deadline) {
      this.stop(runId, active, "RUNTIME_DEADLINE_EXCEEDED", adviceFor(["DEADLINE"]));
      return;
    }
    if (!selected) return;
    const snapshots = await this.platforms.discover();
    if (active.closed || active.controller.signal.aborted || active.current !== selected) return;
    if (Date.now() - active.startedAt > deadline) {
      this.stop(runId, active, "RUNTIME_DEADLINE_EXCEEDED", adviceFor(["DEADLINE"]));
      return;
    }
    const matches = snapshots.flatMap(snapshot =>
      snapshot.executors
        .filter(executor => executor.executorId === selected.executorId)
        .map(executor => ({ snapshot, executor })),
    );
    if (matches.length > 1) {
      this.stop(runId, active, "EXECUTOR_ID_AMBIGUOUS", ["修复跨平台重复执行器 ID 后重新规划。"]);
      return;
    }
    const match = matches[0];
    if (!match?.executor.available) {
      this.stop(runId, active, "EXECUTOR_DISCONNECTED", ["设备或执行器已离线；等待恢复后重试。"]);
      return;
    }
    const { snapshot, executor } = match;
    if (selected.placement === "local") {
      const forecast = this.predictor.assess(snapshot.state, {
        memoryMb: selected.estimatedMemoryMb ?? 0,
        durationMs: selected.estimatedLatencyMs ?? 5000,
        cpu: selected.backend === "cpu", phase: "running",
        backend: selected.backend, interruptible: task?.checkpointPolicy?.enabled === true,
        energyMah: selected.estimatedEnergyMah,
      });
      if (forecast.action === "stop_and_rollback") this.stop(runId, active, forecast.reasons.join(","), forecast.advice);
    }
  }

  private stop(runId: string, active: Active, reason: string, advice: string[]) {
    if (active.reason || active.closed) return;
    active.reason = reason;
    active.advice = advice;
    active.controller.abort();
    this.runs.markStopping(runId, reason, advice);
    this.events.emit({ type: "protection_triggered", runId, message: reason, payload: { advice } });
  }

  private async restore(runId: string, taskId: string, handler: GuardedToolHandler, checkpoint: unknown, active: Active) {
    try {
      // execute() must have settled before this call; the handler owns any child work it spawned.
      await handler.restore(checkpoint);
      if (active.checkpoint) {
        active.checkpoint.status = "restored";
        active.checkpoint.updatedAt = new Date().toISOString();
        this.runs.recordCheckpoint(runId, active.checkpoint);
      }
      this.runs.markRollback(runId, taskId, "succeeded");
      this.events.emit({ type: "checkpoint_restored", runId, taskId, payload: { checkpointId: active.checkpoint?.checkpointId,
        executionId: active.checkpoint?.executionId }, message: `checkpoint ${taskId} restored` });
    } catch {
      if (active.checkpoint) {
        active.checkpoint.status = "restore_failed";
        active.checkpoint.updatedAt = new Date().toISOString();
        this.runs.recordCheckpoint(runId, active.checkpoint);
      }
      this.runs.markRollback(runId, taskId, "failed");
      active.advice.push("回退未成功；请检查执行器实际状态，避免直接重试。");
      this.events.emit({ type: "rollback_failed", runId, taskId, payload: { checkpointId: active.checkpoint?.checkpointId,
        executionId: active.checkpoint?.executionId }, message: `checkpoint ${taskId} restore failed` });
    }
  }
}

function handlerKey(value: { toolId: string; executorId: string; modelId?: string }) {
  return `${value.toolId}|${value.executorId}|${value.modelId ?? ""}`;
}
