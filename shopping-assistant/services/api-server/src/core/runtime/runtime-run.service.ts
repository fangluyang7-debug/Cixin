import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createId } from "../../common/utils/id";
import {
  ExecutionPlan,
  RuntimeReplanEvent,
  RuntimeOperationStep,
  RuntimeRun,
  RuntimeVerificationEvent,
  TaskGraph,
  TelemetryRecord,
  VerificationResult,
} from "./runtime.contracts";
import { ResourceAwareSchedulerService } from "./scheduler.service";
import { RuntimeEventBusService } from "./runtime-event-bus.service";

@Injectable()
export class RuntimeRunService {
  private readonly runs = new Map<string, RuntimeRun>();
  private readonly planUpdates = new Set<string>();
  private readonly maxRecentRuns = 20;

  constructor(
    private readonly scheduler: ResourceAwareSchedulerService,
    private readonly events: RuntimeEventBusService,
  ) {}

  async start(taskGraph: TaskGraph): Promise<RuntimeRun> {
    const now = new Date().toISOString();
    const run: RuntimeRun = {
      runId: createId("run"),
      goal: taskGraph.goal,
      taskGraph,
      executionPlan: null,
      telemetry: [],
      operationTimeline: [],
      verifications: [],
      replanEvents: [],
      status: "planning",
      startedAt: now,
      updatedAt: now,
    };
    this.store(run);
    try {
      const plan = await this.scheduler.plan(taskGraph, { runId: run.runId });
      return this.updatePlan(run.runId, plan);
    } catch (error) {
      this.fail(run.runId, error instanceof Error ? error.message : "RUNTIME_PLAN_FAILED");
      throw error;
    }
  }

  startPlanningGoal(goal: string): RuntimeRun {
    const now = new Date().toISOString();
    const run: RuntimeRun = {
      runId: createId("run"),
      goal,
      taskGraph: null,
      executionPlan: null,
      telemetry: [],
      operationTimeline: [],
      verifications: [],
      replanEvents: [],
      status: "planning",
      startedAt: now,
      updatedAt: now,
    };
    this.store(run);
    return run;
  }

  async attachGraph(runId: string | undefined, taskGraph: TaskGraph): Promise<RuntimeRun> {
    if (!runId) return this.start(taskGraph);
    this.assertPlanMutable(runId);
    this.planUpdates.add(runId);
    try {
      const plan = await this.scheduler.plan(taskGraph, { runId });
      const run = this.requireMutableStatus(runId);
      return this.applyPlan(run, plan, taskGraph);
    } finally {
      this.planUpdates.delete(runId);
    }
  }

  assertPlanMutable(runId: string): RuntimeRun {
    if (this.planUpdates.has(runId)) throw new ConflictException("RUNTIME_RUN_PLAN_LOCKED");
    return this.requireMutableStatus(runId);
  }

  createPlanned(taskGraph: TaskGraph, plan: ExecutionPlan): RuntimeRun {
    const now = new Date().toISOString();
    const run: RuntimeRun = {
      runId: createId("run"),
      goal: taskGraph.goal,
      taskGraph,
      executionPlan: plan,
      telemetry: [],
      operationTimeline: [],
      verifications: [],
      replanEvents: [],
      status: plan.status,
      startedAt: now,
      updatedAt: now,
    };
    this.store(run);
    return run;
  }

  startBlockedGoal(goal: string, code: string, message: string): RuntimeRun {
    const run = this.startPlanningGoal(goal);
    return this.blockPlanningGoal(run.runId, code, message);
  }

  blockPlanningGoal(runId: string, code: string, message: string): RuntimeRun {
    const run = this.require(runId);
    if (run.status !== "planning") {
      throw new ConflictException("RUNTIME_RUN_PLAN_LOCKED");
    }
    const now = new Date().toISOString();
    run.executionPlan = {
      graphId: "unplanned",
      status: "blocked",
      executionOrder: [],
      parallelGroups: [],
      assignments: [],
      missingRequirements: [{ code, message }],
      evaluations: {},
      generatedAt: now,
    };
    run.status = "blocked";
    run.updatedAt = now;
    this.store(run);
    this.events.emit({
      type: "plan_blocked",
      runId,
      message,
      payload: { codes: [code], count: 1 },
    });
    return run;
  }

  updatePlan(runId: string, plan: ExecutionPlan, taskGraph?: TaskGraph): RuntimeRun {
    const run = this.assertPlanMutable(runId);
    return this.applyPlan(run, plan, taskGraph);
  }

  private applyPlan(run: RuntimeRun, plan: ExecutionPlan, taskGraph?: TaskGraph): RuntimeRun {
    if (taskGraph) {
      run.taskGraph = taskGraph;
      run.goal = taskGraph.goal;
    }
    run.executionPlan = plan;
    run.status = plan.status;
    run.updatedAt = new Date().toISOString();
    this.store(run);
    return run;
  }

  recordTelemetry(runId: string, record: TelemetryRecord) {
    const run = this.require(runId);
    const existing = run.telemetry.find(item => item.executionId === record.executionId);
    if (existing) {
      if (!sameTelemetry(existing, record)) throw new ConflictException("TELEMETRY_EXECUTION_ID_CONFLICT");
      return run;
    }
    run.telemetry = [...run.telemetry, record].slice(-100);
    run.updatedAt = new Date().toISOString();
    this.store(run);
    this.events.emit({
      type: "telemetry_recorded",
      runId,
      taskId: record.taskId,
      toolId: record.toolId,
      executorId: record.executorId,
      message: `${record.toolId} ${record.success ? "success" : "failed"} · ${record.latencyMs}ms`,
      payload: {
        latencyMs: record.latencyMs,
        memoryPeakMb: record.memoryPeakMb,
        quality: record.quality ?? null,
        fallbackOccurred: record.fallbackOccurred,
        success: record.success,
      },
    });
    return run;
  }

  recordOperationTimeline(runId: string, steps: RuntimeOperationStep[]) {
    const run = this.require(runId);
    run.operationTimeline = steps.slice(0, 200);
    run.updatedAt = new Date().toISOString();
    this.store(run);
    return run;
  }

  recordVerification(
    runId: string,
    record: { taskId: string; toolId: string },
    result: VerificationResult,
  ) {
    const run = this.require(runId);
    const event: RuntimeVerificationEvent = {
      ...record,
      ...result,
      recordedAt: new Date().toISOString(),
    };
    run.verifications = [...run.verifications, event].slice(-100);
    run.updatedAt = event.recordedAt;
    this.store(run);
    if (!result.passed) {
      this.events.emit({
        type: "verification_failed",
        runId,
        taskId: record.taskId,
        toolId: record.toolId,
        message: result.reasons.join(" · ") || `${record.toolId} verification failed`,
        payload: {
          reasons: result.reasons,
          recommendedActions: result.recommendedActions,
        },
      });
    }
    return run;
  }

  recordReplan(runId: string, reason: string, telemetryCount: number, plan: ExecutionPlan) {
    const run = this.assertPlanMutable(runId);
    const event: RuntimeReplanEvent = {
      reason,
      telemetryCount,
      recordedAt: new Date().toISOString(),
    };
    run.replanEvents = [...run.replanEvents, event].slice(-50);
    run.executionPlan = plan;
    run.status = plan.status;
    run.updatedAt = event.recordedAt;
    this.store(run);
    return run;
  }

  setExecutionState(runId: string, status: "running") {
    const run = this.require(runId);
    run.status = status;
    run.updatedAt = new Date().toISOString();
    this.store(run);
    return run;
  }

  setOutputs(runId: string, outputs: Record<string, unknown>) {
    const run = this.require(runId);
    run.outputs = { ...outputs };
    run.updatedAt = new Date().toISOString();
    this.store(run);
  }

  recordCheckpoint(runId: string, checkpoint: import("./runtime.contracts").RuntimeCheckpoint) {
    const run = this.require(runId);
    run.checkpoints = [...(run.checkpoints ?? []).filter(item => item.checkpointId !== checkpoint.checkpointId), { ...checkpoint }];
    run.operationTimeline = [...run.operationTimeline, {
      key: `${checkpoint.checkpointId}:${checkpoint.status}`, label: `${checkpoint.taskId}:${checkpoint.status}`,
      startedAtMs: Date.parse(checkpoint.capturedAt), endedAtMs: Date.parse(checkpoint.updatedAt),
      durationMs: Math.max(0, Date.parse(checkpoint.updatedAt) - Date.parse(checkpoint.capturedAt)),
      status: checkpoint.status === "restore_failed" ? "error" as const : "ok" as const,
    }].slice(-200);
    run.updatedAt = checkpoint.updatedAt;
    this.store(run);
  }

  markStopping(runId: string, reason: string, advice: string[]) {
    const run = this.require(runId);
    run.status = "stopping";
    run.protection = { reason, advice: [...advice], rollback: "pending" };
    run.updatedAt = new Date().toISOString();
    this.store(run);
  }

  markRollback(runId: string, taskId: string, status: "succeeded" | "failed") {
    const run = this.require(runId);
    if (!run.protection) run.protection = { reason: "EXECUTOR_FAILED", advice: [], rollback: "pending" };
    run.protection.checkpointTaskId = taskId;
    run.protection.rollback = status;
    if (status === "failed") run.status = "rollback_failed";
    run.updatedAt = new Date().toISOString();
    this.store(run);
  }

  finishProtected(runId: string, reason: string, advice: string[]) {
    const run = this.require(runId);
    const rollback = run.protection?.rollback === "pending" ? "not_needed" : run.protection?.rollback ?? "not_needed";
    run.protection = { reason, advice: [...advice], checkpointTaskId: run.protection?.checkpointTaskId, rollback };
    run.status = rollback === "failed" ? "rollback_failed" : rollback === "succeeded" ? "rolled_back" : "cancelled";
    run.outcome = reason;
    run.completedAt = new Date().toISOString();
    run.updatedAt = run.completedAt;
    this.store(run);
    return run;
  }

  complete(runId: string, outcome: string) {
    const run = this.require(runId);
    run.outcome = outcome;
    run.completedAt = new Date().toISOString();
    run.updatedAt = run.completedAt;
    run.status = run.executionPlan?.status === "blocked" ? "blocked" : "completed";
    this.store(run);
    return run;
  }

  fail(runId: string, outcome: string) {
    const run = this.require(runId);
    run.outcome = outcome;
    run.status = "failed";
    run.completedAt = new Date().toISOString();
    run.updatedAt = run.completedAt;
    this.store(run);
    return run;
  }

  get(runId: string) {
    return this.runs.get(runId) ?? null;
  }

  latest() {
    return [...this.runs.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0] ?? null;
  }

  list() {
    return [...this.runs.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, this.maxRecentRuns);
  }

  private require(runId: string) {
    const run = this.get(runId);
    if (!run) throw new NotFoundException("RUNTIME_RUN_NOT_FOUND");
    return run;
  }

  private store(run: RuntimeRun) {
    this.runs.set(run.runId, run);
    if (this.runs.size <= this.maxRecentRuns) return;
    const removable = [...this.runs.values()]
      .filter(item => !["planning", "running", "stopping"].includes(item.status))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0];
    if (removable) this.runs.delete(removable.runId);
  }

  private requireMutableStatus(runId: string) {
    const run = this.require(runId);
    if (!["planning", "ready", "blocked"].includes(run.status)) {
      throw new ConflictException("RUNTIME_RUN_PLAN_LOCKED");
    }
    return run;
  }
}

function sameTelemetry(left: TelemetryRecord, right: TelemetryRecord) {
  return left.executionId === right.executionId && left.taskId === right.taskId &&
    left.toolId === right.toolId && left.executorId === right.executorId &&
    (left.modelId ?? "") === (right.modelId ?? "") && left.startedAt === right.startedAt &&
    left.finishedAt === right.finishedAt && left.latencyMs === right.latencyMs &&
    left.memoryPeakMb === right.memoryPeakMb && (left.energyMah ?? null) === (right.energyMah ?? null) &&
    (left.quality ?? null) === (right.quality ?? null) &&
    left.fallbackOccurred === right.fallbackOccurred && left.success === right.success &&
    (left.errorCode ?? "") === (right.errorCode ?? "") &&
    JSON.stringify(left.metadata ?? null) === JSON.stringify(right.metadata ?? null);
}
