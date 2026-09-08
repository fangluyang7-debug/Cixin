import { Injectable, NotFoundException } from "@nestjs/common";
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

@Injectable()
export class RuntimeRunService {
  private readonly runs = new Map<string, RuntimeRun>();
  private readonly maxRecentRuns = 20;

  constructor(private readonly scheduler: ResourceAwareSchedulerService) {}

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
    const plan = await this.scheduler.plan(taskGraph);
    return this.updatePlan(run.runId, plan);
  }

  async attachGraph(runId: string | undefined, taskGraph: TaskGraph): Promise<RuntimeRun> {
    if (!runId || !this.get(runId)) {
      return this.start(taskGraph);
    }
    const plan = await this.scheduler.plan(taskGraph);
    return this.updatePlan(runId, plan, taskGraph);
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
    const now = new Date().toISOString();
    const run: RuntimeRun = {
      runId: createId("run"),
      goal,
      taskGraph: null,
      executionPlan: {
        graphId: "unplanned",
        status: "blocked",
        executionOrder: [],
        parallelGroups: [],
        assignments: [],
        missingRequirements: [{ code, message }],
        evaluations: {},
        generatedAt: now,
      },
      telemetry: [],
      operationTimeline: [],
      verifications: [],
      replanEvents: [],
      status: "blocked",
      startedAt: now,
      updatedAt: now,
    };
    this.store(run);
    return run;
  }

  updatePlan(runId: string, plan: ExecutionPlan, taskGraph?: TaskGraph): RuntimeRun {
    const run = this.require(runId);
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
    run.telemetry = [...run.telemetry, record].slice(-100);
    run.updatedAt = new Date().toISOString();
    this.store(run);
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
    return run;
  }

  recordReplan(runId: string, reason: string, telemetryCount: number, plan: ExecutionPlan) {
    const run = this.require(runId);
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
    const oldest = [...this.runs.values()].sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt),
    )[0];
    if (oldest) this.runs.delete(oldest.runId);
  }
}
