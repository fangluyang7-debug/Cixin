import { Body, Controller, Get, NotFoundException, Param, Post, Sse } from "@nestjs/common";
import { ok } from "../../../common/dto/api-response.dto";
import {
  CheckpointPolicy,
  CloudExecutionFeedback,
  CloudRouteObservation,
  ExecutionAssignment,
  FallbackPolicy,
  TaskConstraints,
  TaskGraph,
  TelemetryRecord,
} from "../../../core/runtime/runtime.contracts";
import { AgentRuntimeService } from "../../../core/runtime/agent-runtime.service";
import { PerformanceRegistryService } from "../../../core/runtime/performance-registry.service";
import { ResourceAwareSchedulerService } from "../../../core/runtime/scheduler.service";
import { RuntimeSnapshotService } from "../../../core/runtime/runtime-snapshot.service";
import { TelemetryService } from "../../../core/runtime/telemetry.service";
import { ToolRegistryService } from "../../../core/runtime/tool-registry.service";
import { RuntimeRunService } from "../../../core/runtime/runtime-run.service";
import { RuntimeEventBusService } from "../../../core/runtime/runtime-event-bus.service";

@Controller("api/v1/runtime")
export class RuntimeController {
  constructor(
    private readonly tools: ToolRegistryService,
    private readonly snapshot: RuntimeSnapshotService,
    private readonly scheduler: ResourceAwareSchedulerService,
    private readonly agent: AgentRuntimeService,
    private readonly telemetry: TelemetryService,
    private readonly performance: PerformanceRegistryService,
    private readonly runs: RuntimeRunService,
    private readonly events: RuntimeEventBusService,
  ) {}

  @Get("tools")
  getTools() {
    return ok({ tools: this.tools.list() });
  }

  @Get("snapshot")
  async getSnapshot() {
    return ok(await this.snapshot.getSnapshot());
  }

  @Sse("events")
  streamEvents() {
    return this.events.sse();
  }

  @Get("runs")
  listRuns() {
    return ok({ runs: this.runs.list() });
  }

  @Get("runs/:runId")
  getRun(@Param("runId") runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundException("RUNTIME_RUN_NOT_FOUND");
    return ok(run);
  }

  @Post("plan")
  async plan(@Body() body: unknown) {
    const input = asRecord(body);
    const graph = parseTaskGraph(input.taskGraph ?? input);
    const runId = asNonEmptyString(input.runId);
    if (runId) {
      const plan = await this.scheduler.plan(graph, { runId });
      this.runs.updatePlan(runId, plan, graph);
      return ok({ ...plan, runId });
    }
    const run = await this.runs.start(graph);
    return ok({ ...run.executionPlan!, runId: run.runId });
  }

  @Post("agent/plan")
  async planAgent(@Body() body: unknown) {
    const input = asRecord(body);
    if (input.taskGraph) {
      const run = await this.runs.start(parseTaskGraph(input.taskGraph));
      return ok({
        status: run.status,
        taskGraph: run.taskGraph,
        executionPlan: run.executionPlan,
        missingRequirements: run.executionPlan?.missingRequirements ?? [],
        runId: run.runId,
      });
    }
    const goal = asNonEmptyString(input.goal);
    if (!goal) {
      const run = this.runs.startBlockedGoal(
        "未提供 Agent 目标",
        "AGENT_GOAL_OR_TASK_GRAPH_REQUIRED",
        "请求必须提供 goal 或 taskGraph。",
      );
      return ok({
        status: run.status,
        taskGraph: null,
        executionPlan: run.executionPlan,
        missingRequirements: run.executionPlan?.missingRequirements ?? [],
        runId: run.runId,
      });
    }
    const result = await this.agent.planGoal({
      goal,
      context: isRecord(input.context) ? input.context : undefined,
    });
    if (result.taskGraph && result.executionPlan) {
      const run = this.runs.createPlanned(result.taskGraph, result.executionPlan);
      return ok({ ...result, executionPlan: run.executionPlan, runId: run.runId });
    }
    const requirement = result.missingRequirements[0] ?? {
      code: "AGENT_PLAN_BLOCKED",
      message: "Agent 计划被阻断。",
    };
    const run = this.runs.startBlockedGoal(goal, requirement.code, requirement.message);
    return ok({ ...result, executionPlan: run.executionPlan, runId: run.runId });
  }

  @Post("replan")
  async replan(@Body() body: unknown) {
    const input = asRecord(body);
    const telemetry = parseTelemetryArray(input.telemetry);
    const runId = asNonEmptyString(input.runId);
    const reason = asNonEmptyString(input.reason) ?? "runtime_observation";
    if (runId) {
      this.events.emit({
        type: "replan_requested",
        runId,
        message: reason,
        payload: { telemetryCount: telemetry.length },
      });
    }
    const result = await this.agent.observeAndReplan({
      taskGraph: parseTaskGraph(input.taskGraph),
      telemetry,
      runId,
    });
    if (runId && result.executionPlan) {
      for (const record of telemetry) this.runs.recordTelemetry(runId, record);
      this.runs.recordReplan(
        runId,
        reason,
        telemetry.length,
        result.executionPlan,
      );
    }
    return ok({ ...result, runId: runId ?? null });
  }

  @Post("telemetry")
  recordTelemetry(@Body() body: unknown) {
    const input = asRecord(body);
    const record = parseTelemetry(input);
    const runId = asNonEmptyString(input.runId);
    if (runId) this.runs.recordTelemetry(runId, record);
    return ok({
      sample: this.telemetry.record(record),
      performanceSamples: this.performance.list(),
      runId: runId ?? null,
    });
  }

  @Post("verify")
  verify(@Body() body: unknown) {
    const input = asRecord(body);
    const assignment = parseAssignment(input.assignment);
    const tool = this.tools.require(assignment.toolId);
    const telemetry = parseTelemetry(input.telemetry);
    const verification = this.agent.verify(assignment, tool, telemetry);
    const runId = asNonEmptyString(input.runId);
    if (runId) {
      this.runs.recordTelemetry(runId, telemetry);
      this.runs.recordVerification(
        runId,
        { taskId: assignment.taskId, toolId: assignment.toolId },
        verification,
      );
    }
    return ok({
      verification,
      runId: runId ?? null,
    });
  }
}

function parseTaskGraph(value: unknown): TaskGraph {
  const input = asRecord(value);
  const graphId = asNonEmptyString(input.graphId);
  const goal = asNonEmptyString(input.goal);
  if (!graphId || !goal || !Array.isArray(input.nodes)) {
    throw new Error("TASK_GRAPH_INVALID");
  }
  return {
    graphId,
    goal,
    planner: asNonEmptyString(input.planner),
    createdAt: asNonEmptyString(input.createdAt),
    nodes: input.nodes.map((value) => {
      const node = asRecord(value);
      const taskId = asNonEmptyString(node.taskId);
      const toolId = asNonEmptyString(node.toolId);
      const inputRef = asNonEmptyString(node.inputRef);
      if (!taskId || !toolId || !inputRef) throw new Error("TASK_INTENT_INVALID");
      return {
        taskId,
        toolId,
        inputRef,
        outputType: asNonEmptyString(node.outputType),
        constraints: isRecord(node.constraints)
          ? (node.constraints as TaskConstraints)
          : undefined,
        dependencies: stringArray(node.dependencies),
        checkpointPolicy: isRecord(node.checkpointPolicy)
          ? (node.checkpointPolicy as CheckpointPolicy)
          : undefined,
        fallbackPolicy: isRecord(node.fallbackPolicy)
          ? (node.fallbackPolicy as FallbackPolicy)
          : undefined,
        cloudRoutes: parseCloudRoutes(node.cloudRoutes),
      };
    }),
  };
}

function parseTelemetryArray(value: unknown): TelemetryRecord[] {
  if (!Array.isArray(value)) throw new Error("TELEMETRY_ARRAY_REQUIRED");
  return value.map(parseTelemetry);
}

function parseTelemetry(value: unknown): TelemetryRecord {
  const input = asRecord(value);
  const requiredStrings = [
    input.executionId,
    input.taskId,
    input.toolId,
    input.executorId,
    input.startedAt,
    input.finishedAt,
  ];
  if (requiredStrings.some((value) => !asNonEmptyString(value))) {
    throw new Error("TELEMETRY_INVALID");
  }
  if (
    typeof input.latencyMs !== "number" ||
    typeof input.memoryPeakMb !== "number" ||
    typeof input.fallbackOccurred !== "boolean" ||
    typeof input.success !== "boolean"
  ) {
    throw new Error("TELEMETRY_INVALID");
  }
  if (input.latencyScope !== undefined && input.latencyScope !== "execution_only" &&
      input.latencyScope !== "end_to_end") {
    throw new Error("TELEMETRY_LATENCY_SCOPE_INVALID");
  }
  return {
    executionId: input.executionId as string,
    taskId: input.taskId as string,
    toolId: input.toolId as string,
    executorId: input.executorId as string,
    modelId: asNonEmptyString(input.modelId),
    startedAt: input.startedAt as string,
    finishedAt: input.finishedAt as string,
    latencyMs: input.latencyMs,
    latencyScope: input.latencyScope === "execution_only" || input.latencyScope === "end_to_end"
      ? input.latencyScope : undefined,
    cloud: input.cloud === undefined ? undefined : parseCloudFeedback(input.cloud),
    memoryPeakMb: input.memoryPeakMb,
    energyMah: optionalNumber(input.energyMah),
    quality: optionalNumber(input.quality),
    fallbackOccurred: input.fallbackOccurred,
    success: input.success,
    errorCode: asNonEmptyString(input.errorCode),
    metadata: isRecord(input.metadata) ? input.metadata : undefined,
  };
}

function parseCloudRoutes(value: unknown): CloudRouteObservation[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new Error("CLOUD_ROUTES_INVALID");
  const routes = value.map((item): CloudRouteObservation => {
    const route = asRecord(item);
    const location = route.inputResidence;
    const destination = route.outputDestination ?? "device";
    const access = route.accessMode;
    const source = route.source;
    const requiredNumbers = [route.inputBytes, route.outputBytes, route.roundTripMs,
      route.uploadMbps, route.downloadMbps, route.storageReadMs, route.queueMs];
    if (!asNonEmptyString(route.executorId) ||
        !["device", "zeabur_volume", "cos", "external_api"].includes(location) ||
        !["device", "zeabur_volume", "cos", "external_api"].includes(destination) ||
        !["inline_transfer", "signed_object_url", "co_located"].includes(access) ||
        !["measured", "declared"].includes(source) ||
        typeof route.transferAuthorized !== "boolean" ||
        requiredNumbers.some((number) => typeof number !== "number" || !Number.isFinite(number) || number < 0) ||
        (route.storageWriteMs !== undefined &&
          (typeof route.storageWriteMs !== "number" || !Number.isFinite(route.storageWriteMs) ||
            route.storageWriteMs < 0)) ||
        !asNonEmptyString(route.observedAt) ||
        (route.estimatedFeeMinorUnits !== undefined &&
          (typeof route.estimatedFeeMinorUnits !== "number" || !Number.isFinite(route.estimatedFeeMinorUnits) ||
            route.estimatedFeeMinorUnits < 0))) {
      throw new Error("CLOUD_ROUTE_INVALID");
    }
    return {
      executorId: route.executorId.trim(), inputResidence: location,
      outputDestination: destination, accessMode: access,
      transferAuthorized: route.transferAuthorized, inputBytes: route.inputBytes,
      outputBytes: route.outputBytes, roundTripMs: route.roundTripMs,
      uploadMbps: route.uploadMbps, downloadMbps: route.downloadMbps,
      storageReadMs: route.storageReadMs, storageWriteMs: route.storageWriteMs,
      queueMs: route.queueMs,
      estimatedFeeMinorUnits: route.estimatedFeeMinorUnits,
      accessExpiresAt: asNonEmptyString(route.accessExpiresAt),
      observedAt: route.observedAt.trim(), source,
    };
  });
  if (new Set(routes.map((route) => route.executorId)).size !== routes.length) {
    throw new Error("CLOUD_ROUTE_DUPLICATE_EXECUTOR");
  }
  return routes;
}

function parseCloudFeedback(value: unknown): CloudExecutionFeedback {
  const input = asRecord(value);
  const requiredNumbers = [input.inputBytes, input.outputBytes, input.uploadMs,
    input.storageReadMs, input.queueMs, input.executionMs, input.downloadMs];
  if (requiredNumbers.some((number) => typeof number !== "number" || !Number.isFinite(number) || number < 0) ||
      (input.storageWriteMs !== undefined &&
        (typeof input.storageWriteMs !== "number" || !Number.isFinite(input.storageWriteMs) ||
          input.storageWriteMs < 0)) ||
      (input.feeMinorUnits !== undefined &&
        (typeof input.feeMinorUnits !== "number" || !Number.isFinite(input.feeMinorUnits) ||
          input.feeMinorUnits < 0))) {
    throw new Error("CLOUD_FEEDBACK_INVALID");
  }
  return {
    inputBytes: input.inputBytes, outputBytes: input.outputBytes,
    uploadMs: input.uploadMs, storageReadMs: input.storageReadMs,
    storageWriteMs: input.storageWriteMs,
    queueMs: input.queueMs, executionMs: input.executionMs, downloadMs: input.downloadMs,
    feeMinorUnits: input.feeMinorUnits, providerStatus: asNonEmptyString(input.providerStatus),
  };
}

function parseAssignment(value: unknown): ExecutionAssignment {
  const input = asRecord(value);
  const taskId = asNonEmptyString(input.taskId);
  const toolId = asNonEmptyString(input.toolId);
  const executorId = asNonEmptyString(input.executorId);
  if (!taskId || !toolId || !executorId) throw new Error("EXECUTION_ASSIGNMENT_INVALID");
  return input as unknown as ExecutionAssignment;
}

function asRecord(value: unknown): Record<string, any> {
  if (!isRecord(value)) throw new Error("OBJECT_REQUIRED");
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown) {
  return value === null || value === undefined ? null : typeof value === "number" ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}
