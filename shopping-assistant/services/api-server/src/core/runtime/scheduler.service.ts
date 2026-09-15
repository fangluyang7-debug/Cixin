import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CandidateEvaluation,
  ExecutionAssignment,
  ExecutionLocation,
  ExecutionPlan,
  ExecutorDescriptor,
  ObjectiveWeights,
  PrivacyLevel,
  TaskConstraints,
  TaskGraph,
  TaskIntent,
  ToolConstraints,
  ToolDescriptor,
} from "./runtime.contracts";
import { PerformanceRegistryService } from "./performance-registry.service";
import { PlatformDiscoveryService, PlatformSnapshot } from "./platform-discovery.service";
import { ToolRegistryService } from "./tool-registry.service";
import { RuntimeEventBusService } from "./runtime-event-bus.service";
import { ResourcePredictorService, adviceFor } from "./resource-predictor.service";

@Injectable()
export class ResourceAwareSchedulerService {
  private readonly lastSelections = new Map<string, string>();
  private readonly predictor: ResourcePredictorService;

  constructor(
    private readonly tools: ToolRegistryService,
    private readonly platforms: PlatformDiscoveryService,
    private readonly performance: PerformanceRegistryService,
    private readonly config: ConfigService,
    @Optional() private readonly events?: RuntimeEventBusService,
    @Optional() predictor?: ResourcePredictorService,
  ) { this.predictor = predictor ?? new ResourcePredictorService(config); }

  async plan(graph: TaskGraph, context: { runId?: string } = {}): Promise<ExecutionPlan> {
    const generatedAt = new Date().toISOString();
    this.events?.emit({
      type: "task_graph_received",
      runId: context.runId,
      graphId: graph.graphId,
      message: graph.goal,
      payload: { nodeCount: graph.nodes.length, planner: graph.planner ?? null },
    });
    const topology = buildTopology(graph);
    const snapshots = await this.platforms.discover();
    const evaluations: Record<string, CandidateEvaluation[]> = {};
    const assignments: ExecutionAssignment[] = [];
    const missingRequirements = [...topology.missingRequirements];
    const executorCounts = new Map<string, number>();
    for (const snapshot of snapshots) {
      for (const executor of snapshot.executors) {
        executorCounts.set(executor.executorId, (executorCounts.get(executor.executorId) ?? 0) + 1);
      }
    }
    const ambiguousExecutorIds = new Set(
      [...executorCounts.entries()].filter(([, count]) => count > 1).map(([executorId]) => executorId),
    );
    for (const executorId of ambiguousExecutorIds) {
      missingRequirements.push({
        code: "EXECUTOR_ID_AMBIGUOUS",
        message: `执行器 ID ${executorId} 在多个平台重复，无法安全绑定执行目标。`,
        evidence: { executorId },
      });
    }
    for (const snapshot of snapshots) this.predictor.observe(snapshot.state);

    for (const taskId of topology.executionOrder) {
      const task = graph.nodes.find(node => node.taskId === taskId)!;
      if (topology.invalidTaskIds.has(taskId)) {
        evaluations[task.taskId] = [];
        continue;
      }
      const tool = this.tools.get(task.toolId);
      if (!tool) {
        evaluations[task.taskId] = [];
        missingRequirements.push({
          taskId: task.taskId,
          code: "TOOL_NOT_REGISTERED",
          message: `工具 ${task.toolId} 尚未注册，无法规划任务。`,
        });
        continue;
      }

      const taskEvaluations = await this.evaluateTask(
        task,
        tool,
        snapshots,
        graph.demand?.deadlineMs,
        ambiguousExecutorIds,
      );
      evaluations[task.taskId] = taskEvaluations;
      const emitEvaluations = () => {
        for (const evaluation of taskEvaluations) {
          this.events?.emit({
            type: "candidate_evaluated", runId: context.runId, graphId: graph.graphId,
            taskId: task.taskId, toolId: task.toolId, executorId: evaluation.executorId,
            message: `${evaluation.executorId} ${evaluation.accepted ? "accepted" : "rejected"}`,
            payload: { accepted: evaluation.accepted, backend: evaluation.backend,
              placement: evaluation.placement, modelId: evaluation.modelId,
              modelTier: evaluation.modelTier, reasons: evaluation.reasons,
              score: evaluation.score, forecast: evaluation.forecast },
          });
        }
      };
      const accepted = taskEvaluations.filter((evaluation) => evaluation.accepted);
      if (accepted.length === 0) {
        emitEvaluations();
        missingRequirements.push(...this.collectMissingRequirements(task, taskEvaluations));
        continue;
      }

      const weights = this.resolveWeights(task, tool, accepted, snapshots);
      this.applyScores(accepted, weights);
      emitEvaluations();
      const selectionKey = `${graph.graphId}:${task.taskId}`;
      const preferredPlacement = preferredPlacementFor(task, tool);
      const selected = this.selectCandidate(selectionKey, accepted, preferredPlacement);
      if (!selected || !selected.score) {
        missingRequirements.push({
          taskId: task.taskId,
          code: "EXECUTOR_SELECTION_FAILED",
          message: "可行候选存在，但没有生成有效评分。",
        });
        continue;
      }
      const modelId = selected.modelId;
      assignments.push({
        taskId: task.taskId,
        toolId: task.toolId,
        executorId: selected.executorId,
        placement: selected.placement,
        backend: selected.backend,
        modelId,
        modelTier: selected.modelTier,
        estimatedLatencyMs: selected.estimatedLatencyMs,
        estimatedMemoryMb: selected.estimatedMemoryMb,
        estimatedEnergyMah: selected.sample?.energyMah,
        forecast: selected.forecast,
        score: selected.score,
        weights,
        reasons: [
          "通过硬约束过滤",
          ...selected.reasons,
          ...(preferredPlacement === selected.placement
            ? [`满足 ${preferredPlacement === "local" ? "本地" : "云端"}软偏好`]
            : []),
          ...(this.lastSelections.get(selectionKey) === candidateKey(selected)
            ? ["保持当前执行器，避免低收益切换"]
            : []),
        ],
        plannedAt: generatedAt,
        status: "planned",
      });
      this.lastSelections.set(selectionKey, candidateKey(selected));
      if (this.lastSelections.size > 1000) this.lastSelections.delete(this.lastSelections.keys().next().value!);
      this.events?.emit({
        type: "executor_selected",
        runId: context.runId,
        graphId: graph.graphId,
        taskId: task.taskId,
        toolId: task.toolId,
        executorId: selected.executorId,
        message: `${task.taskId} -> ${selected.executorId}`,
        payload: {
          backend: selected.backend,
          placement: selected.placement,
          score: selected.score,
        },
      });
    }

    let conservative = assignments.some(item => item.forecast?.risk === "warning");
    // Each assignment already passed admission. A combined memory peak may only need serialization.
    for (const group of topology.parallelGroups) {
      for (const snapshot of snapshots) {
        const concurrent = assignments.filter(a => group.includes(a.taskId) && a.placement === "local" && snapshot.executors.some(e => e.executorId === a.executorId));
        if (concurrent.length < 2) continue;
        const forecast = this.predictor.assess(snapshot.state, {
          memoryMb: concurrent.reduce((sum, a) => sum + (a.estimatedMemoryMb ?? 0), 0),
          durationMs: Math.max(...concurrent.map(a => a.estimatedLatencyMs ?? 0)), cpu: concurrent.some(a => a.backend === "cpu"),
        });
        if (forecast.action === "reject") {
          if (forecast.reasons.includes("PREDICTED_MEMORY_REDLINE")) conservative = true;
          else missingRequirements.push({ code: "PARALLEL_RESOURCE_REDLINE", message: "并行组资源风险无法通过降低并发消除。", evidence: { group, reasons: forecast.reasons } });
        }
      }
    }
    const parallelGroups = conservative ? topology.executionOrder.map(id => [id]) : topology.parallelGroups;
    const finishes = new Map<string, number>();
    let serialFinish = 0;
    for (const taskId of topology.executionOrder) {
      const task = graph.nodes.find(node => node.taskId === taskId)!;
      const selected = assignments.find(item => item.taskId === taskId);
      if (selected?.estimatedLatencyMs == null) continue;
      const finish = Math.max(conservative ? serialFinish : 0, ...(task.dependencies ?? []).map(id => finishes.get(id) ?? Infinity)) + selected.estimatedLatencyMs;
      serialFinish = finish;
      finishes.set(taskId, finish);
      if (task.constraints?.deadlineMs !== undefined && finish > task.constraints.deadlineMs) {
        missingRequirements.push({ taskId, code: "TASK_DEADLINE_EXCEEDED", message: "依赖链预计完成时间超出任务截止预算。" });
      }
    }
    const criticalPath = finishes.size === graph.nodes.length ? Math.max(0, ...finishes.values()) : null;
    if (graph.demand && criticalPath !== null && criticalPath > graph.demand.deadlineMs) {
      missingRequirements.push({ code: "GRAPH_DEADLINE_EXCEEDED", message: "任务图端到端预计耗时超出业务预算。" });
    }
    const plan: ExecutionPlan = {
      graphId: graph.graphId,
      status: missingRequirements.length === 0 ? "ready" : "blocked",
      executionOrder: topology.executionOrder,
      parallelGroups,
      recommendedMaxConcurrency: conservative ? 1 : undefined,
      assignments,
      missingRequirements,
      evaluations,
      generatedAt,
      estimatedCriticalPathMs: criticalPath,
      advice: [...new Set([
        ...(conservative ? ["资源压力或并行峰值过高，计划已限制为串行；时限按串行完成时间重新校验。"] : []),
        ...Object.values(evaluations).flatMap(items => items.flatMap(item => item.forecast?.advice ?? [])),
        ...adviceFor(missingRequirements.map(item => item.code)),
        ...(missingRequirements.some(item => item.code === "PARALLEL_RESOURCE_REDLINE") ? ["将并行任务改为有依赖的串行阶段后重试。"] : []),
      ])],
    };
    if (plan.status === "blocked") {
      this.events?.emit({
        type: "plan_blocked",
        runId: context.runId,
        graphId: graph.graphId,
        taskId: missingRequirements[0]?.taskId,
        message: missingRequirements[0]?.message ?? "计划被阻断",
        payload: {
          codes: missingRequirements.map((item) => item.code),
          count: missingRequirements.length,
        },
      });
    }
    return plan;
  }

  private async evaluateTask(
    task: TaskIntent,
    tool: ToolDescriptor,
    snapshots: PlatformSnapshot[],
    graphDeadlineMs: number | undefined,
    ambiguousExecutorIds: ReadonlySet<string>,
  ) {
    const effective = mergeConstraints(tool.constraints, task.constraints);
    const evaluations: CandidateEvaluation[] = [];
    for (const snapshot of snapshots) {
      for (const executor of snapshot.executors) {
        const variants = [
          { modelId: tool.resourceHints.modelId, tier: "full" as const, estimatedMemoryMb: tool.resourceHints.estimatedMemoryMb },
          ...(tool.resourceHints.modelVariants ?? []).filter(variant => variant.tier !== "light" || task.constraints?.allowDegrade === true),
        ];
        for (const variant of variants) {
        evaluations.push(
          await this.evaluateCandidate(
            task,
            { ...tool, resourceHints: { ...tool.resourceHints, modelId: variant.modelId, estimatedMemoryMb: variant.estimatedMemoryMb } },
            effective,
            executor,
            snapshot,
            variant.tier,
            graphDeadlineMs,
            ambiguousExecutorIds,
          ),
        );
        }
      }
    }
    return evaluations;
  }

  private async evaluateCandidate(
    task: TaskIntent,
    tool: ToolDescriptor,
    constraints: ToolConstraints,
    executor: ExecutorDescriptor,
    snapshot: PlatformSnapshot,
    modelTier: "light" | "full",
    graphDeadlineMs: number | undefined,
    ambiguousExecutorIds: ReadonlySet<string>,
  ): Promise<CandidateEvaluation> {
    const reasons: string[] = [];
    const sample = this.performance.get(
      task.toolId,
      executor.executorId,
      tool.resourceHints.modelId,
    );
    if (!executor.available) {
      reasons.push(`EXECUTOR_UNAVAILABLE:${executor.availabilityReason ?? "UNKNOWN"}`);
    }
    if (ambiguousExecutorIds.has(executor.executorId)) {
      reasons.push("EXECUTOR_ID_AMBIGUOUS");
    }
    if (!executor.supportedComputeClasses.includes(tool.resourceHints.computeClass)) {
      reasons.push("COMPUTE_CLASS_UNSUPPORTED");
    }
    if (!placementAllowed(executor.placement, constraints.locality)) {
      reasons.push("LOCALITY_CONSTRAINT_FAILED");
    }
    if (snapshot.profile.platformId !== "cloud" && snapshot.heartbeat && !snapshot.heartbeat.fresh && snapshot.profile.platformId !== "host") {
      reasons.push("PLATFORM_HEARTBEAT_STALE");
    }
    if (!placementAllowed(executor.placement, tool.constraints.locality)) reasons.push("TOOL_LOCALITY_CONSTRAINT_FAILED");
    if (executor.placement === "local" && !constraints.allowLocal) {
      reasons.push("LOCAL_EXECUTION_DISABLED_BY_TOOL");
    }
    if (executor.placement === "cloud" && !constraints.allowCloud) {
      reasons.push("CLOUD_EXECUTION_DISABLED_BY_TOOL");
    }
    if (executor.placement === "cloud" && constraints.privacy === "high") {
      reasons.push("HIGH_PRIVACY_REQUIRES_LOCAL_EXECUTION");
    }
    if (executor.placement === "local") {
      const freeMemoryMb = this.predictor.read(snapshot.state.freeMemoryMb);
      if (freeMemoryMb === null) {
        reasons.push("LOCAL_FREE_MEMORY_UNAVAILABLE");
      } else if (freeMemoryMb < tool.resourceHints.estimatedMemoryMb) {
        reasons.push("LOCAL_MEMORY_INSUFFICIENT");
      }
    } else if (["cpu", "gpu", "npu"].includes(executor.backend) && executor.totalMemoryMb === null) {
      reasons.push("REMOTE_MEMORY_CAPACITY_UNAVAILABLE");
    }

    if (
      tool.resourceHints.modelId ||
      tool.resourceHints.computeClass === "neural_inference"
    ) {
      const heartbeatProvesExecutor =
        snapshot.heartbeat?.fresh === true &&
        snapshot.heartbeat.executorIds.includes(executor.executorId);
      const heartbeatSupportsModel =
        !tool.resourceHints.modelId ||
        executor.supportedModels.includes(tool.resourceHints.modelId);
      const probe = heartbeatProvesExecutor
        ? {
            supported: heartbeatSupportsModel,
            reason: heartbeatSupportsModel
              ? undefined
              : "MODEL_NOT_DECLARED_BY_PLATFORM_HEARTBEAT",
          }
        : await snapshot.adapter.probeModel(executor, {
            modelId: tool.resourceHints.modelId,
            computeClass: tool.resourceHints.computeClass,
            inputType: tool.inputType,
          });
      if (!probe.supported) {
        reasons.push(`MODEL_UNSUPPORTED:${probe.reason ?? "UNKNOWN"}`);
      }
    }

    const weights = normalizeWeights({ ...tool.defaultWeights, ...task.constraints?.weights });
    const networkMs = executor.placement === "cloud" ? this.predictor.read(snapshot.state.networkLatencyMs) : 0;
    const queueMs = snapshot.state.queueWaitMs === undefined ? 0 : this.predictor.read(snapshot.state.queueWaitMs);
    const payloadBytes = constraints.estimatedDataBytes ?? 0;
    const throughput = executor.placement === "cloud" && payloadBytes > 0 ? this.predictor.read(snapshot.state.networkThroughputMbps) : null;
    if (networkMs === null || (executor.placement === "cloud" && payloadBytes > 0 && (throughput === null || throughput <= 0))) reasons.push("CLOUD_NETWORK_METRIC_UNAVAILABLE");
    if (queueMs === null) reasons.push("QUEUE_WAIT_METRIC_UNAVAILABLE");
    const transferMs = executor.placement === "cloud" && payloadBytes > 0 && throughput && throughput > 0 ? payloadBytes * 8 / (throughput * 1000) : 0;
    const estimatedLatencyMs = sample?.p95LatencyMs == null || networkMs === null || queueMs === null ? null : sample.p95LatencyMs + networkMs + queueMs + transferMs;
    const estimatedMemoryMb = Math.max(tool.resourceHints.estimatedMemoryMb, sample?.memoryPeakMb ?? 0);
    if (executor.totalMemoryMb !== null && executor.totalMemoryMb < estimatedMemoryMb) reasons.push("EXECUTOR_MEMORY_CAPACITY_INSUFFICIENT");
    const forecast = this.predictor.assess(snapshot.state, {
      memoryMb: estimatedMemoryMb, durationMs: sample?.p95LatencyMs ?? constraints.maxLatencyMs ?? 5000,
      cpu: executor.backend === "cpu", backend: executor.backend, local: executor.placement === "local",
      energyMah: sample?.energyMah, interruptible: task.checkpointPolicy?.enabled === true,
      latencyBudgetMs: Math.min(constraints.maxLatencyMs ?? Infinity, task.constraints?.deadlineMs ?? Infinity, graphDeadlineMs ?? Infinity),
    });
    if (forecast?.action === "reject") reasons.push(...forecast.reasons);
    if (!sample) {
      reasons.push("REAL_PERFORMANCE_PROFILE_MISSING");
    } else {
      if (sample.sampleCount < this.performance.getMinimumSamples()) {
        reasons.push("REAL_PERFORMANCE_SAMPLE_COUNT_TOO_LOW");
      }
      const latencyEvidenceRequired =
        weights.latency > 0 ||
        constraints.maxLatencyMs !== undefined ||
        task.constraints?.deadlineMs !== undefined ||
        graphDeadlineMs !== undefined;
      if (sample.p95LatencyMs === null && latencyEvidenceRequired) {
        reasons.push("P95_LATENCY_METRIC_MISSING");
      }
      if (sample.memoryPeakMb === null) {
        reasons.push("PEAK_MEMORY_METRIC_MISSING");
      }
      if (sample.energyMah === null && (weights.energy > 0 || constraints.energyBudgetMah !== undefined)) {
        reasons.push("ENERGY_METRIC_MISSING");
      }
      if (sample.quality === null && weights.quality > 0) {
        reasons.push("QUALITY_METRIC_MISSING");
      }
      if (
        constraints.maxLatencyMs !== undefined &&
        sample.p95LatencyMs !== null &&
        estimatedLatencyMs !== null && estimatedLatencyMs > constraints.maxLatencyMs
      ) {
        reasons.push("P95_LATENCY_BUDGET_EXCEEDED");
      }
      const minimumQuality = minimumQualityFor(tool, task.constraints?.minimumQuality);
      if (minimumQuality !== undefined && sample.quality === null) reasons.push("QUALITY_METRIC_MISSING");
      if (
        minimumQuality !== undefined &&
        sample.quality !== null &&
        sample.quality < minimumQuality
      ) {
        reasons.push("QUALITY_THRESHOLD_NOT_MET");
      }
      if (
        constraints.energyBudgetMah !== undefined &&
        sample.energyMah !== null &&
        sample.energyMah > constraints.energyBudgetMah
      ) {
        reasons.push("ENERGY_BUDGET_EXCEEDED");
      }
      if (executor.placement === "cloud" && constraints.costBudgetMinorUnits !== undefined) {
        reasons.push("CLOUD_COST_METRIC_UNAVAILABLE");
      }
    }

    return {
      executorId: executor.executorId,
      placement: executor.placement,
      backend: executor.backend,
      accepted: reasons.length === 0,
      reasons: [...new Set(reasons)],
      sample,
      score: null,
      modelId: tool.resourceHints.modelId,
      modelTier,
      estimatedLatencyMs,
      estimatedMemoryMb,
      forecast,
    };
  }

  private resolveWeights(
    task: TaskIntent,
    tool: ToolDescriptor,
    accepted: CandidateEvaluation[],
    snapshots: PlatformSnapshot[],
  ) {
    const requested = task.constraints?.weights ?? {};
    const raw = {
      latency: requested.latency ?? tool.defaultWeights.latency,
      quality: requested.quality ?? tool.defaultWeights.quality,
      energy: requested.energy ?? tool.defaultWeights.energy,
      reliability: requested.reliability ?? tool.defaultWeights.reliability,
    };
    if (task.constraints?.preference === "speed") raw.latency *= 1.5;
    if (task.constraints?.preference === "quality") raw.quality *= 1.5;
    if (task.constraints?.preference === "energy") raw.energy *= 1.5;

    const pressure = snapshots.some((snapshot) => {
      const battery = this.predictor.read(snapshot.state.batteryPercent);
      const temperature = this.predictor.read(snapshot.state.temperatureCelsius);
      return (battery !== null && battery <=
          (this.config.get<number>("runtime.lowBatteryPercent") ?? 20)) ||
        (temperature !== null && temperature >=
          (this.config.get<number>("runtime.highTemperatureCelsius") ?? 75));
    });
    if (pressure) raw.energy *= 1.5;

    const queuePressure = snapshots.some((snapshot) => {
      const queueDepth = this.predictor.read(snapshot.state.queueDepth);
      const activeTasks = this.predictor.read(snapshot.state.activeTaskCount);
      return (queueDepth ?? 0) >= 8 || (activeTasks ?? 0) >= 8;
    });
    if (queuePressure) raw.reliability *= 1.2;
    const networkPressure = snapshots.some((snapshot) => {
      const packetLoss = this.predictor.read(snapshot.state.packetLossPercent);
      const jitter = this.predictor.read(snapshot.state.networkJitterMs);
      return (packetLoss ?? 0) > 1 || (jitter ?? 0) > 20;
    });
    if (networkPressure) raw.latency *= 1.25;

    const bestLatency = accepted
      .map((candidate) => candidate.estimatedLatencyMs)
      .filter((value): value is number => value !== null && value !== undefined)
      .sort((left, right) => left - right)[0];
    const budget = task.constraints?.maxLatencyMs ?? tool.constraints.maxLatencyMs;
    if (bestLatency !== undefined && budget !== undefined) {
      const latencyPressure = Math.max(0, bestLatency / budget - 1);
      raw.latency *= 1 + latencyPressure * 0.8;
    }
    return normalizeWeights(raw);
  }

  private applyScores(candidates: CandidateEvaluation[], weights: ObjectiveWeights) {
    const latencies = candidates.map(candidate => candidate.estimatedLatencyMs ?? Infinity);
    const qualities = candidates
      .map((candidate) => candidate.sample?.quality)
      .filter((value): value is number => value !== null && value !== undefined);
    const energies = candidates
      .map((candidate) => candidate.sample?.energyMah)
      .filter((value): value is number => value !== null && value !== undefined);
    for (const candidate of candidates) {
      const sample = candidate.sample;
      if (!sample) continue;
      const latencyScore = metricScore(
        candidate.estimatedLatencyMs,
        latencies.filter(Number.isFinite),
        weights.latency,
        true,
      );
      const qualityScore = metricScore(sample.quality, qualities, weights.quality, false);
      const energyScore = metricScore(sample.energyMah, energies, weights.energy, true);
      const reliabilityScore =
        0.6 * (1 - (sample.failureRate ?? 1)) +
        0.4 * (sample.noFallbackRate ?? 0);
      candidate.score = {
        latencyScore,
        qualityScore,
        energyScore,
        reliabilityScore,
        totalScore:
          weights.latency * latencyScore +
          weights.quality * qualityScore +
          weights.energy * energyScore +
          weights.reliability * reliabilityScore,
      };
      if (candidate.forecast?.risk === "warning") {
        candidate.score.totalScore *= candidate.modelTier === "light" ? 0.95 : 0.9;
        candidate.reasons.push(candidate.modelTier === "light" ? "WARNING_LIGHT_SCORE_FACTOR_0.95" : "WARNING_SCORE_FACTOR_0.9");
      }
    }
  }

  private selectCandidate(
    taskId: string,
    candidates: CandidateEvaluation[],
    preferredPlacement?: "local" | "cloud",
  ) {
    const configuredBoost = this.config.get<number>("runtime.placementPreferenceBoost") ?? 0.05;
    const preferenceBoost = Number.isFinite(configuredBoost)
      ? Math.max(0, Math.min(0.5, configuredBoost))
      : 0.05;
    const rankedScore = (candidate: CandidateEvaluation) =>
      (candidate.score?.totalScore ?? -1) *
      (candidate.placement === preferredPlacement ? 1 + preferenceBoost : 1);
    const sorted = [...candidates].sort((left, right) => {
      const scoreDifference = rankedScore(right) - rankedScore(left);
      if (Math.abs(scoreDifference) > 0.000001) return scoreDifference;
      return left.executorId.localeCompare(right.executorId);
    });
    const best = sorted[0];
    if (!best?.score) return null;
    const currentId = this.lastSelections.get(taskId);
    const current = sorted.find((candidate) => candidateKey(candidate) === currentId);
    const threshold = this.config.get<number>("runtime.switchThreshold") ?? 0.05;
    if (
      current &&
      current !== best &&
      current.score &&
      rankedScore(best) <= rankedScore(current) * (1 + threshold)
    ) {
      current.reasons.push("HYSTERESIS_KEEP_CURRENT_EXECUTOR");
      return current;
    }
    return best;
  }

  private collectMissingRequirements(
    task: TaskIntent,
    evaluations: CandidateEvaluation[],
  ) {
    const reasons = [...new Set(evaluations.flatMap((evaluation) => evaluation.reasons))];
    return [
      {
        taskId: task.taskId,
        code: "NO_FEASIBLE_EXECUTOR",
        message: `任务 ${task.taskId} 没有通过硬约束的执行器。`,
        evidence: { reasons },
      },
    ];
  }
}

function candidateKey(candidate: CandidateEvaluation) { return `${candidate.executorId}:${candidate.modelId ?? ""}`; }

function preferredPlacementFor(task: TaskIntent, tool: ToolDescriptor): "local" | "cloud" | undefined {
  if (task.constraints?.preference === "privacy") return "local";
  const locality = task.constraints?.locality ?? tool.constraints.locality;
  if (locality === "local_preferred") return "local";
  if (locality === "cloud_preferred") return "cloud";
  return undefined;
}

function mergeConstraints(
  tool: ToolConstraints,
  task: TaskConstraints | undefined,
): ToolConstraints {
  const maxLatencyCandidates = [tool.maxLatencyMs, task?.maxLatencyMs].filter(
    (value): value is number => value !== undefined,
  );
  const energyBudgetCandidates = [tool.energyBudgetMah, task?.energyBudgetMah].filter(
    (value): value is number => value !== undefined,
  );
  return {
    privacy: stricterPrivacy(tool.privacy, task?.privacy),
    locality: task?.locality ?? tool.locality,
    allowLocal: tool.allowLocal,
    allowCloud: tool.allowCloud,
    maxLatencyMs:
      maxLatencyCandidates.length > 0 ? Math.min(...maxLatencyCandidates) : undefined,
    estimatedDataBytes: tool.estimatedDataBytes,
    energyBudgetMah:
      energyBudgetCandidates.length > 0
        ? Math.min(...energyBudgetCandidates)
        : undefined,
    costBudgetMinorUnits: task?.costBudgetMinorUnits ?? tool.costBudgetMinorUnits,
  };
}

function stricterPrivacy(left: PrivacyLevel, right: PrivacyLevel | undefined): PrivacyLevel {
  if (!right) return left;
  const order: PrivacyLevel[] = ["public", "internal", "sensitive", "high"];
  return order.indexOf(left) >= order.indexOf(right) ? left : right;
}

function placementAllowed(
  placement: "local" | "cloud",
  locality: ExecutionLocation,
) {
  if (locality === "local_only") return placement === "local";
  if (locality === "cloud_only") return placement === "cloud";
  return true;
}

function minimumQualityFor(tool: ToolDescriptor, requested: number | undefined) {
  const qualityValues = [
    tool.quality.minimumConfidence,
    tool.quality.minimumScore,
    requested,
  ].filter((value): value is number => value !== undefined);
  return qualityValues.length > 0 ? Math.max(...qualityValues) : undefined;
}

function normalizeWeights(input: ObjectiveWeights): ObjectiveWeights {
  const values = {
    latency: Math.max(0, input.latency),
    quality: Math.max(0, input.quality),
    energy: Math.max(0, input.energy),
    reliability: Math.max(0, input.reliability),
  };
  const sum = values.latency + values.quality + values.energy + values.reliability;
  if (sum === 0) {
    return { latency: 0, quality: 0, energy: 0, reliability: 1 };
  }
  return {
    latency: values.latency / sum,
    quality: values.quality / sum,
    energy: values.energy / sum,
    reliability: values.reliability / sum,
  };
}

function lowerIsBetter(value: number, values: number[]) {
  const minimum = Math.min(...values);
  const scale = Math.max(1, Math.max(...values)) * 0.01;
  return Math.max(0, Math.min(1, (minimum + scale) / (value + scale)));
}

function higherIsBetter(value: number, values: number[]) {
  const maximum = Math.max(...values);
  const scale = Math.max(1, maximum) * 0.01;
  return Math.max(0, Math.min(1, (value + scale) / (maximum + scale)));
}

function metricScore(
  value: number | null | undefined,
  values: number[],
  weight: number,
  lowerIsPreferred: boolean,
) {
  if (weight === 0) return 1;
  if (value === null || value === undefined || values.length === 0) return 0;
  return lowerIsPreferred ? lowerIsBetter(value, values) : higherIsBetter(value, values);
}

function buildTopology(graph: TaskGraph) {
  const missingRequirements: ExecutionPlan["missingRequirements"] = [];
  const invalidTaskIds = new Set<string>();
  if (!graph.graphId?.trim() || !graph.goal?.trim()) {
    missingRequirements.push({ code: "TASK_GRAPH_IDENTITY_INVALID", message: "任务图必须提供非空 graphId 和 goal。" });
  }
  if (graph.nodes.length === 0) missingRequirements.push({ code: "TASK_GRAPH_EMPTY", message: "任务图至少需要一个任务。" });
  if (graph.nodes.length > 256) {
    missingRequirements.push({ code: "TASK_GRAPH_TOO_LARGE", message: "单个任务图最多包含 256 个任务。" });
    return { executionOrder: [], parallelGroups: [], missingRequirements, invalidTaskIds };
  }
  const demand = graph.demand;
  if (demand &&
      (typeof demand.operation !== "string" || !demand.operation.trim() || demand.operation.length > 128 ||
       !["interactive", "deferred"].includes(demand.realtime) ||
       !["simple", "complex"].includes(demand.complexity) ||
       !Number.isFinite(demand.deadlineMs) || demand.deadlineMs <= 0 || demand.deadlineMs > 300000 ||
       !["background", "normal", "interactive", "urgent"].includes(demand.priority) ||
       !["explicit_operation", "local_template_rules", "local_provider", "external_planner"].includes(demand.source) ||
       !Array.isArray(demand.reasons) || demand.reasons.some(reason => typeof reason !== "string" || !reason.trim()) ||
       typeof demand.plannerVersion !== "string" || !demand.plannerVersion.trim() ||
       typeof demand.trainedModel !== "boolean" ||
       (demand.decisionConfidence !== undefined &&
        (!Number.isFinite(demand.decisionConfidence) || demand.decisionConfidence < 0 || demand.decisionConfidence > 1)))) {
    missingRequirements.push({ code: "TASK_DEMAND_INVALID", message: "任务图的业务需求声明无效。" });
  }
  const taskIds = new Set<string>();
  for (const task of graph.nodes) {
    if (!task.taskId?.trim() || !task.toolId?.trim() || !task.inputRef?.trim()) {
      missingRequirements.push({ taskId: task.taskId, code: "TASK_INTENT_INVALID", message: "任务必须提供非空 ID、工具和输入引用。" });
      invalidTaskIds.add(task.taskId);
    }
    const c = task.constraints;
    const positive = [c?.deadlineMs, c?.maxLatencyMs, c?.energyBudgetMah, c?.costBudgetMinorUnits]
      .filter((value): value is number => value !== undefined);
    const weights = c?.weights ? Object.values(c.weights) : [];
    if (positive.some(value => !Number.isFinite(value) || value <= 0) ||
        weights.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0) ||
        (c?.minimumQuality !== undefined && (!Number.isFinite(c.minimumQuality) || c.minimumQuality < 0 || c.minimumQuality > 1)) ||
        (c?.priority !== undefined && !["background", "normal", "interactive", "urgent"].includes(c.priority)) ||
        (c?.privacy !== undefined && !["public", "internal", "sensitive", "high"].includes(c.privacy)) ||
        (c?.locality !== undefined && !["auto", "local_only", "cloud_only", "local_preferred", "cloud_preferred"].includes(c.locality)) ||
        (c?.preference !== undefined && !["speed", "quality", "energy", "privacy"].includes(c.preference)) ||
        (c?.allowDegrade !== undefined && typeof c.allowDegrade !== "boolean")) {
      missingRequirements.push({ taskId: task.taskId, code: "TASK_CONSTRAINT_INVALID", message: "任务约束无效。" });
      invalidTaskIds.add(task.taskId);
    }
    const checkpoint = task.checkpointPolicy;
    if (checkpoint &&
        (typeof checkpoint.enabled !== "boolean" ||
         typeof checkpoint.stopOnResourcePressure !== "boolean" ||
         (checkpoint.intervalItems !== undefined &&
          (!Number.isInteger(checkpoint.intervalItems) || checkpoint.intervalItems <= 0)))) {
      missingRequirements.push({
        taskId: task.taskId,
        code: "CHECKPOINT_POLICY_INVALID",
        message: "检查点策略无效。",
      });
      invalidTaskIds.add(task.taskId);
    }
    const fallback = task.fallbackPolicy;
    if (fallback &&
        (typeof fallback.enabled !== "boolean" ||
         !Array.isArray(fallback.actions) ||
         fallback.actions.some(action => typeof action !== "string" || !action.trim()) ||
         !Number.isInteger(fallback.maxAttempts) || fallback.maxAttempts < 1 ||
         typeof fallback.replanAtStageBoundary !== "boolean")) {
      missingRequirements.push({
        taskId: task.taskId,
        code: "FALLBACK_POLICY_INVALID",
        message: "降级策略无效。",
      });
      invalidTaskIds.add(task.taskId);
    }
    if (taskIds.has(task.taskId)) {
      missingRequirements.push({
        taskId: task.taskId,
        code: "DUPLICATE_TASK_ID",
        message: `任务 ID ${task.taskId} 重复。`,
      });
      invalidTaskIds.add(task.taskId);
    }
    taskIds.add(task.taskId);
  }
  const dependencies = new Map<string, Set<string>>();
  for (const task of graph.nodes) {
    const taskDependencies = new Set(task.dependencies ?? []);
    for (const dependency of taskDependencies) {
      if (!taskIds.has(dependency)) {
        missingRequirements.push({
          taskId: task.taskId,
          code: "TASK_DEPENDENCY_MISSING",
          message: `任务 ${task.taskId} 依赖的任务 ${dependency} 不存在。`,
        });
        invalidTaskIds.add(task.taskId);
      }
    }
    dependencies.set(task.taskId, taskDependencies);
  }

  const remaining = new Map(
    [...dependencies.entries()].map(([taskId, taskDependencies]) => [
      taskId,
      new Set([...taskDependencies].filter((dependency) => taskIds.has(dependency))),
    ]),
  );
  const executionOrder: string[] = [];
  const parallelGroups: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, taskDependencies]) => taskDependencies.size === 0)
      .map(([taskId]) => taskId)
      .sort((left, right) => {
        const priority = { background: 0, normal: 1, interactive: 2, urgent: 3 };
        const a = graph.nodes.find(node => node.taskId === left)!;
        const b = graph.nodes.find(node => node.taskId === right)!;
        return priority[b.constraints?.priority ?? "normal"] - priority[a.constraints?.priority ?? "normal"] ||
          (a.constraints?.deadlineMs ?? Infinity) - (b.constraints?.deadlineMs ?? Infinity) || left.localeCompare(right);
      });
    if (ready.length === 0) {
      missingRequirements.push({
        code: "TASK_GRAPH_CYCLE",
        message: "任务图存在循环依赖，无法生成执行顺序。",
      });
      for (const taskId of remaining.keys()) invalidTaskIds.add(taskId);
      break;
    }
    parallelGroups.push(ready);
    executionOrder.push(...ready);
    for (const taskId of ready) remaining.delete(taskId);
    for (const taskDependencies of remaining.values()) {
      for (const taskId of ready) taskDependencies.delete(taskId);
    }
  }
  return { executionOrder, parallelGroups, missingRequirements, invalidTaskIds };
}
