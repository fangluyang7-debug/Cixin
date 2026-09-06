import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BackendType,
  CandidateEvaluation,
  ExecutionAssignment,
  ExecutionLocation,
  ExecutionPlan,
  ExecutorDescriptor,
  ObjectiveWeights,
  PerformanceSample,
  PrivacyLevel,
  ScoreBreakdown,
  TaskConstraints,
  TaskGraph,
  TaskIntent,
  ToolConstraints,
  ToolDescriptor,
} from "./runtime.contracts";
import { PerformanceRegistryService } from "./performance-registry.service";
import { PlatformDiscoveryService, PlatformSnapshot } from "./platform-discovery.service";
import { ToolRegistryService } from "./tool-registry.service";

@Injectable()
export class ResourceAwareSchedulerService {
  private readonly lastSelections = new Map<string, string>();

  constructor(
    private readonly tools: ToolRegistryService,
    private readonly platforms: PlatformDiscoveryService,
    private readonly performance: PerformanceRegistryService,
    private readonly config: ConfigService,
  ) {}

  async plan(graph: TaskGraph): Promise<ExecutionPlan> {
    const generatedAt = new Date().toISOString();
    const topology = buildTopology(graph);
    const snapshots = await this.platforms.discover();
    const evaluations: Record<string, CandidateEvaluation[]> = {};
    const assignments: ExecutionAssignment[] = [];
    const missingRequirements = [...topology.missingRequirements];

    for (const task of graph.nodes) {
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

      const taskEvaluations = await this.evaluateTask(task, tool, snapshots);
      evaluations[task.taskId] = taskEvaluations;
      const accepted = taskEvaluations.filter((evaluation) => evaluation.accepted);
      if (accepted.length === 0) {
        missingRequirements.push(...this.collectMissingRequirements(task, taskEvaluations));
        continue;
      }

      const weights = this.resolveWeights(task, tool, accepted, snapshots);
      this.applyScores(accepted, weights);
      const selected = this.selectCandidate(task.taskId, accepted);
      if (!selected || !selected.score) {
        missingRequirements.push({
          taskId: task.taskId,
          code: "EXECUTOR_SELECTION_FAILED",
          message: "可行候选存在，但没有生成有效评分。",
        });
        continue;
      }
      const modelId = tool.resourceHints.modelId;
      assignments.push({
        taskId: task.taskId,
        toolId: task.toolId,
        executorId: selected.executorId,
        placement: selected.placement,
        backend: selected.backend,
        modelId,
        score: selected.score,
        weights,
        reasons: [
          "通过硬约束过滤",
          ...selected.reasons,
          ...(this.lastSelections.get(task.taskId) === selected.executorId
            ? ["保持当前执行器，避免低收益切换"]
            : []),
        ],
        plannedAt: generatedAt,
        status: "planned",
      });
      this.lastSelections.set(task.taskId, selected.executorId);
    }

    return {
      graphId: graph.graphId,
      status: missingRequirements.length === 0 ? "ready" : "blocked",
      executionOrder: topology.executionOrder,
      parallelGroups: topology.parallelGroups,
      assignments,
      missingRequirements,
      evaluations,
      generatedAt,
    };
  }

  private async evaluateTask(
    task: TaskIntent,
    tool: ToolDescriptor,
    snapshots: PlatformSnapshot[],
  ) {
    const effective = mergeConstraints(tool.constraints, task.constraints);
    const evaluations: CandidateEvaluation[] = [];
    for (const snapshot of snapshots) {
      for (const executor of snapshot.executors) {
        evaluations.push(
          await this.evaluateCandidate(task, tool, effective, executor, snapshot),
        );
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
    if (!executor.supportedComputeClasses.includes(tool.resourceHints.computeClass)) {
      reasons.push("COMPUTE_CLASS_UNSUPPORTED");
    }
    if (!placementAllowed(executor.placement, constraints.locality)) {
      reasons.push("LOCALITY_CONSTRAINT_FAILED");
    }
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
      const freeMemoryMb = snapshot.state.freeMemoryMb.value;
      if (freeMemoryMb === null) {
        reasons.push("LOCAL_FREE_MEMORY_UNAVAILABLE");
      } else if (freeMemoryMb < tool.resourceHints.estimatedMemoryMb) {
        reasons.push("LOCAL_MEMORY_INSUFFICIENT");
      }
    } else if (executor.totalMemoryMb === null) {
      reasons.push("REMOTE_MEMORY_CAPACITY_UNAVAILABLE");
    }

    if (
      tool.resourceHints.modelId ||
      tool.resourceHints.computeClass === "neural_inference"
    ) {
      const probe = await snapshot.adapter.probeModel(executor, {
        modelId: tool.resourceHints.modelId,
        computeClass: tool.resourceHints.computeClass,
        inputType: tool.inputType,
      });
      if (!probe.supported) {
        reasons.push(`MODEL_UNSUPPORTED:${probe.reason ?? "UNKNOWN"}`);
      }
    }

    const weights = normalizeWeights(tool.defaultWeights);
    if (!sample) {
      reasons.push("REAL_PERFORMANCE_PROFILE_MISSING");
    } else {
      if (sample.sampleCount < this.performance.getMinimumSamples()) {
        reasons.push("REAL_PERFORMANCE_SAMPLE_COUNT_TOO_LOW");
      }
      if (sample.p95LatencyMs === null && weights.latency > 0) {
        reasons.push("P95_LATENCY_METRIC_MISSING");
      }
      if (sample.memoryPeakMb === null) {
        reasons.push("PEAK_MEMORY_METRIC_MISSING");
      }
      if (sample.energyMah === null && weights.energy > 0) {
        reasons.push("ENERGY_METRIC_MISSING");
      }
      if (sample.quality === null && weights.quality > 0) {
        reasons.push("QUALITY_METRIC_MISSING");
      }
      if (
        constraints.maxLatencyMs !== undefined &&
        sample.p95LatencyMs !== null &&
        sample.p95LatencyMs > constraints.maxLatencyMs
      ) {
        reasons.push("P95_LATENCY_BUDGET_EXCEEDED");
      }
      const minimumQuality = minimumQualityFor(tool, constraints);
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
    }

    return {
      executorId: executor.executorId,
      placement: executor.placement,
      backend: executor.backend,
      accepted: reasons.length === 0,
      reasons,
      sample,
      score: null,
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

    const pressure = snapshots.some(
      (snapshot) =>
        (snapshot.state.batteryPercent.value !== null &&
          snapshot.state.batteryPercent.value <=
            (this.config.get<number>("runtime.lowBatteryPercent") ?? 20)) ||
        (snapshot.state.temperatureCelsius.value !== null &&
          snapshot.state.temperatureCelsius.value >=
            (this.config.get<number>("runtime.highTemperatureCelsius") ?? 75)),
    );
    if (pressure) raw.energy *= 1.5;

    const bestLatency = accepted
      .map((candidate) => candidate.sample?.p95LatencyMs)
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
    const samples = candidates
      .map((candidate) => candidate.sample)
      .filter((sample): sample is PerformanceSample => sample !== null);
    const latencies = samples.map((sample) => sample.p95LatencyMs as number);
    const qualities = samples.map((sample) => sample.quality as number);
    const energies = samples.map((sample) => sample.energyMah as number);
    for (const candidate of candidates) {
      const sample = candidate.sample;
      if (!sample) continue;
      const latencyScore = lowerIsBetter(sample.p95LatencyMs as number, latencies);
      const qualityScore = higherIsBetter(sample.quality as number, qualities);
      const energyScore = lowerIsBetter(sample.energyMah as number, energies);
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
    }
  }

  private selectCandidate(taskId: string, candidates: CandidateEvaluation[]) {
    const sorted = [...candidates].sort((left, right) => {
      const scoreDifference =
        (right.score?.totalScore ?? -1) - (left.score?.totalScore ?? -1);
      if (Math.abs(scoreDifference) > 0.000001) return scoreDifference;
      return left.executorId.localeCompare(right.executorId);
    });
    const best = sorted[0];
    if (!best?.score) return null;
    const currentId = this.lastSelections.get(taskId);
    const current = sorted.find((candidate) => candidate.executorId === currentId);
    const threshold = this.config.get<number>("runtime.switchThreshold") ?? 0.05;
    if (
      current &&
      current !== best &&
      current.score &&
      best.score.totalScore <= current.score.totalScore * (1 + threshold)
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

function minimumQualityFor(tool: ToolDescriptor, constraints: ToolConstraints) {
  const qualityValues = [
    tool.quality.minimumConfidence,
    tool.quality.minimumScore,
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
  return normalize(value, Math.min(...values), Math.max(...values), true);
}

function higherIsBetter(value: number, values: number[]) {
  return normalize(value, Math.min(...values), Math.max(...values), false);
}

function normalize(value: number, min: number, max: number, invert: boolean) {
  if (max === min) return 1;
  const score = invert ? (max - value) / (max - min) : (value - min) / (max - min);
  return Math.max(0, Math.min(1, score));
}

function buildTopology(graph: TaskGraph) {
  const missingRequirements: ExecutionPlan["missingRequirements"] = [];
  const taskIds = new Set<string>();
  for (const task of graph.nodes) {
    if (taskIds.has(task.taskId)) {
      missingRequirements.push({
        taskId: task.taskId,
        code: "DUPLICATE_TASK_ID",
        message: `任务 ID ${task.taskId} 重复。`,
      });
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
      .sort();
    if (ready.length === 0) {
      missingRequirements.push({
        code: "TASK_GRAPH_CYCLE",
        message: "任务图存在循环依赖，无法生成执行顺序。",
      });
      break;
    }
    parallelGroups.push(ready);
    executionOrder.push(...ready);
    for (const taskId of ready) remaining.delete(taskId);
    for (const taskDependencies of remaining.values()) {
      for (const taskId of ready) taskDependencies.delete(taskId);
    }
  }
  return { executionOrder, parallelGroups, missingRequirements };
}
