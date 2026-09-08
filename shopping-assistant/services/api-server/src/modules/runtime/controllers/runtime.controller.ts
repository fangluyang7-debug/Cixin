import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Sse,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ok } from "../../../common/dto/api-response.dto";
import {
  CheckpointPolicy,
  ExecutionAssignment,
  FallbackPolicy,
  TaskConstraints,
  TaskGraph,
  TelemetryRecord,
  PlatformHeartbeat,
  ExecutorDescriptor,
  PlatformProfile,
  RuntimePlatformId,
  RuntimeState,
} from "../../../core/runtime/runtime.contracts";
import { AgentRuntimeService } from "../../../core/runtime/agent-runtime.service";
import { PerformanceRegistryService } from "../../../core/runtime/performance-registry.service";
import { ResourceAwareSchedulerService } from "../../../core/runtime/scheduler.service";
import { RuntimeSnapshotService } from "../../../core/runtime/runtime-snapshot.service";
import { TelemetryService } from "../../../core/runtime/telemetry.service";
import { ToolRegistryService } from "../../../core/runtime/tool-registry.service";
import { RuntimeRunService } from "../../../core/runtime/runtime-run.service";
import { RuntimeEventBusService } from "../../../core/runtime/runtime-event-bus.service";
import { PlatformStateRegistryService } from "../../../core/runtime/platform-state-registry.service";

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
    private readonly platformStates: PlatformStateRegistryService,
    private readonly config: ConfigService,
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

  /** Board/edge agents use this heartbeat to publish live hardware state. */
  @Post("platforms/:platformId/heartbeat")
  heartbeat(
    @Param("platformId") platformId: string,
    @Body() body: unknown,
    @Headers("x-runtime-agent-token") agentToken?: string,
  ) {
    const expectedToken = this.config.get<string>("runtime.platformHeartbeatToken");
    if (expectedToken && agentToken !== expectedToken) {
      throw new UnauthorizedException("RUNTIME_PLATFORM_HEARTBEAT_UNAUTHORIZED");
    }
    const report = parsePlatformHeartbeat(platformId, body);
    const stored = this.platformStates.upsert(report);
    this.events.emit({
      type: "platform_state_updated",
      message: `${platformId} runtime state updated`,
      payload: {
        platformId,
        observedAt: report.state.observedAt,
        source: report.source,
      },
    });
    return ok({
      accepted: true,
      platformId,
      observedAt: report.state.observedAt,
      receivedAt: stored.receivedAt,
      expiresInMs: this.config.get<number>("runtime.platformReportTtlMs") ?? 10000,
    });
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
  return {
    executionId: input.executionId as string,
    taskId: input.taskId as string,
    toolId: input.toolId as string,
    executorId: input.executorId as string,
    modelId: asNonEmptyString(input.modelId),
    startedAt: input.startedAt as string,
    finishedAt: input.finishedAt as string,
    latencyMs: input.latencyMs,
    memoryPeakMb: input.memoryPeakMb,
    energyMah: optionalNumber(input.energyMah),
    quality: optionalNumber(input.quality),
    fallbackOccurred: input.fallbackOccurred,
    success: input.success,
    errorCode: asNonEmptyString(input.errorCode),
    metadata: isRecord(input.metadata) ? input.metadata : undefined,
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

function parsePlatformHeartbeat(platformIdValue: string, value: unknown): PlatformHeartbeat {
  const platformId = platformIdValue.trim() as RuntimePlatformId;
  if (!["host", "harmonyos", "cix_p1", "cloud"].includes(platformId)) {
    throw new BadRequestException("RUNTIME_PLATFORM_INVALID");
  }
  if (!isRecord(value)) throw new BadRequestException("RUNTIME_PLATFORM_HEARTBEAT_INVALID");
  const input = value;
  const stateInput = isRecord(input.state) ? input.state : input;
  const reportedAt = parseTimestamp(input.reportedAt, new Date().toISOString());
  const state: RuntimeState = {
    platformId,
    cpuUtilizationPercent: parseMetric(stateInput.cpuUtilizationPercent, "cpu-utilization", reportedAt),
    gpuUtilizationPercent: parseMetric(stateInput.gpuUtilizationPercent, "gpu-utilization", reportedAt),
    npuUtilizationPercent: parseMetric(stateInput.npuUtilizationPercent, "npu-utilization", reportedAt),
    temperatureCelsius: parseMetric(stateInput.temperatureCelsius, "temperature", reportedAt),
    freeMemoryMb: parseMetric(stateInput.freeMemoryMb, "free-memory", reportedAt),
    networkLatencyMs: parseMetric(stateInput.networkLatencyMs, "network-latency", reportedAt),
    networkThroughputMbps: parseMetric(stateInput.networkThroughputMbps, "network-throughput", reportedAt),
    batteryPercent: parseMetric(stateInput.batteryPercent, "battery", reportedAt),
    diskFreeMb: parseMetric(stateInput.diskFreeMb, "disk-free", reportedAt),
    activeTaskCount: parseMetric(stateInput.activeTaskCount, "active-tasks", reportedAt),
    cpuFrequencyMhz: optionalMetric(stateInput.cpuFrequencyMhz, "cpu-frequency", reportedAt),
    cpuCoreUtilizationPercent: optionalNumberArrayMetric(stateInput.cpuCoreUtilizationPercent, "cpu-core-utilization", reportedAt),
    cpuClusterFrequencyMhz: optionalNumberArrayMetric(stateInput.cpuClusterFrequencyMhz, "cpu-cluster-frequency", reportedAt),
    cpuClusterUtilizationPercent: optionalNumberArrayMetric(stateInput.cpuClusterUtilizationPercent, "cpu-cluster-utilization", reportedAt),
    gpuMemoryUsedMb: optionalMetric(stateInput.gpuMemoryUsedMb, "gpu-memory", reportedAt),
    npuMemoryUsedMb: optionalMetric(stateInput.npuMemoryUsedMb, "npu-memory", reportedAt),
    gpuFrequencyMhz: optionalMetric(stateInput.gpuFrequencyMhz, "gpu-frequency", reportedAt),
    npuFrequencyMhz: optionalMetric(stateInput.npuFrequencyMhz, "npu-frequency", reportedAt),
    networkJitterMs: optionalMetric(stateInput.networkJitterMs, "network-jitter", reportedAt),
    packetLossPercent: optionalMetric(stateInput.packetLossPercent, "packet-loss", reportedAt),
    powerWatts: optionalMetric(stateInput.powerWatts, "power", reportedAt),
    fanRpm: optionalMetric(stateInput.fanRpm, "fan", reportedAt),
    ioReadMbps: optionalMetric(stateInput.ioReadMbps, "io-read", reportedAt),
    ioWriteMbps: optionalMetric(stateInput.ioWriteMbps, "io-write", reportedAt),
    networkTxMbps: optionalMetric(stateInput.networkTxMbps, "network-tx", reportedAt),
    networkRxMbps: optionalMetric(stateInput.networkRxMbps, "network-rx", reportedAt),
    iops: optionalMetric(stateInput.iops, "iops", reportedAt),
    queueDepth: optionalMetric(stateInput.queueDepth, "queue-depth", reportedAt),
    queueWaitMs: optionalMetric(stateInput.queueWaitMs, "queue-wait", reportedAt),
    memoryBandwidthMbps: optionalMetric(stateInput.memoryBandwidthMbps, "memory-bandwidth", reportedAt),
    dmaPoolUsedMb: optionalMetric(stateInput.dmaPoolUsedMb, "dma-pool", reportedAt),
    uptimeSeconds: optionalMetric(stateInput.uptimeSeconds, "uptime", reportedAt),
    npuLatencyMs: optionalMetric(stateInput.npuLatencyMs, "npu-latency", reportedAt),
    databaseLatencyMs: optionalMetric(stateInput.databaseLatencyMs, "database-latency", reportedAt),
    pipelineFps: optionalMetric(stateInput.pipelineFps, "pipeline-fps", reportedAt),
    droppedFrames: optionalMetric(stateInput.droppedFrames, "dropped-frames", reportedAt),
    thermalThrottle: optionalBooleanMetric(stateInput.thermalThrottle, "thermal-throttle", reportedAt),
    currentModel: optionalStringMetric(stateInput.currentModel, "current-model", reportedAt),
    observedAt: parseTimestamp(stateInput.observedAt, reportedAt),
  };
  const profileInput = isRecord(input.profile) ? input.profile : undefined;
  const executors = parseExecutors(input.executors ?? profileInput?.backends);
  return {
    platformId,
    state,
    profile: profileInput
      ? parsePlatformProfile(profileInput, platformId, executors ?? [], reportedAt)
      : undefined,
    executors,
    reportedAt,
    source: asNonEmptyString(input.source) ?? "platform-heartbeat",
  };
}

function parseTimestamp(value: unknown, fallback: string) {
  const candidate = asNonEmptyString(value) ?? fallback;
  if (!Number.isFinite(Date.parse(candidate))) {
    throw new BadRequestException("RUNTIME_PLATFORM_TIMESTAMP_INVALID");
  }
  return new Date(candidate).toISOString();
}

function parsePlatformProfile(
  input: Record<string, any>,
  platformId: RuntimePlatformId,
  executors: ExecutorDescriptor[],
  observedAt: string,
): PlatformProfile {
  return {
    platformId,
    available: input.available === true,
    os: nullableString(input.os),
    arch: nullableString(input.arch),
    runtimeVersion: nullableString(input.runtimeVersion),
    cpuLogicalCores: nullableFiniteNumber(input.cpuLogicalCores),
    totalMemoryMb: nullableFiniteNumber(input.totalMemoryMb),
    backends: executors,
    missingCapabilities: stringArray(input.missingCapabilities) ?? [],
    source: asNonEmptyString(input.source) ?? "platform-heartbeat",
    observedAt: parseTimestamp(input.observedAt, observedAt),
  };
}

function parseExecutors(value: unknown): ExecutorDescriptor[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new BadRequestException("RUNTIME_EXECUTORS_INVALID");
  return value.map((item) => {
    if (!isRecord(item)) throw new BadRequestException("RUNTIME_EXECUTOR_INVALID");
    const input = item;
    const executorId = asNonEmptyString(input.executorId);
    const backend = asNonEmptyString(input.backend);
    const placement = asNonEmptyString(input.placement);
    if (
      !executorId ||
      !["cpu", "gpu", "npu", "cloud_api", "network", "storage"].includes(backend ?? "") ||
      !["local", "cloud"].includes(placement ?? "")
    ) {
      throw new BadRequestException("RUNTIME_EXECUTOR_INVALID");
    }
    return {
      executorId,
      backend: backend as ExecutorDescriptor["backend"],
      placement: placement as ExecutorDescriptor["placement"],
      available: input.available === true,
      availabilityReason: asNonEmptyString(input.availabilityReason),
      supportedComputeClasses: (stringArray(input.supportedComputeClasses) ?? []).filter(
        (item): item is ExecutorDescriptor["supportedComputeClasses"][number] =>
          ["general_cpu", "neural_inference", "network", "storage"].includes(item),
      ),
      supportedModels: stringArray(input.supportedModels) ?? [],
      totalMemoryMb: nullableFiniteNumber(input.totalMemoryMb),
      source: asNonEmptyString(input.source) ?? "platform-heartbeat",
      capabilities: stringArray(input.capabilities) ?? [],
    };
  });
}

function nullableString(value: unknown) {
  return value === null ? null : asNonEmptyString(value) ?? null;
}

function nullableFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMetric(value: unknown, source: string, observedAt: string) {
  return optionalMetric(value, source, observedAt) ?? {
    value: null,
    available: false,
    source,
    reason: "BOARD_HEARTBEAT_METRIC_NOT_REPORTED",
    observedAt,
  };
}

function optionalMetric(value: unknown, source: string, observedAt: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value, available: true, source: `board:${source}`, observedAt };
  }
  if (isRecord(value) && (typeof value.value === "number" || value.value === null)) {
    return {
      value: value.value as number | null,
      available: value.available !== false && value.value !== null,
      source: asNonEmptyString(value.source) ?? `board:${source}`,
      reason: asNonEmptyString(value.reason),
      observedAt: parseTimestamp(value.observedAt, observedAt),
    };
  }
  return undefined;
}

function optionalNumberArrayMetric(value: unknown, source: string, observedAt: string) {
  const rawValue = Array.isArray(value) ? value : isRecord(value) ? value.value : undefined;
  if (!Array.isArray(rawValue) || !rawValue.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return undefined;
  }
  const input = isRecord(value) ? value : undefined;
  return {
    value: rawValue as number[],
    available: input?.available !== false,
    source: asNonEmptyString(input?.source) ?? `board:${source}`,
    reason: asNonEmptyString(input?.reason),
    observedAt: parseTimestamp(input?.observedAt, observedAt),
  };
}

function optionalBooleanMetric(value: unknown, source: string, observedAt: string) {
  if (typeof value === "boolean") return { value, available: true, source: `board:${source}`, observedAt };
  if (isRecord(value) && typeof value.value === "boolean") {
    return {
      value: value.value,
      available: value.available !== false,
      source: asNonEmptyString(value.source) ?? `board:${source}`,
      reason: asNonEmptyString(value.reason),
      observedAt: parseTimestamp(value.observedAt, observedAt),
    };
  }
  return undefined;
}

function optionalStringMetric(value: unknown, source: string, observedAt: string) {
  if (typeof value === "string" && value.trim()) return { value: value.trim(), available: true, source: `board:${source}`, observedAt };
  if (isRecord(value) && typeof value.value === "string") {
    return {
      value: value.value,
      available: value.available !== false,
      source: asNonEmptyString(value.source) ?? `board:${source}`,
      reason: asNonEmptyString(value.reason),
      observedAt: parseTimestamp(value.observedAt, observedAt),
    };
  }
  return undefined;
}
