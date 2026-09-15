import { Injectable } from "@nestjs/common";
import {
  ExecutionAssignment,
  TaskConstraints,
  ToolDescriptor,
  TelemetryRecord,
  VerificationResult,
} from "./runtime.contracts";
import { PerformanceRegistryService } from "./performance-registry.service";

@Injectable()
export class TelemetryService {
  constructor(private readonly performance: PerformanceRegistryService) {}

  record(record: TelemetryRecord) {
    return this.performance.record(record);
  }

  verify(
    assignment: ExecutionAssignment,
    tool: ToolDescriptor,
    record: TelemetryRecord,
    taskConstraints?: TaskConstraints,
  ): VerificationResult {
    const reasons: string[] = [];
    const recommendedActions: string[] = [];
    const latencyBudgets = [tool.constraints.maxLatencyMs, taskConstraints?.maxLatencyMs]
      .filter((value): value is number => value !== undefined);
    const maxLatencyMs = latencyBudgets.length > 0 ? Math.min(...latencyBudgets) : undefined;
    const minimumQuality = Math.max(
      tool.quality.minimumConfidence ?? 0,
      tool.quality.minimumScore ?? 0,
      taskConstraints?.minimumQuality ?? 0,
    );
    const energyBudgets = [tool.constraints.energyBudgetMah, taskConstraints?.energyBudgetMah]
      .filter((value): value is number => value !== undefined);
    const energyBudgetMah = energyBudgets.length > 0 ? Math.min(...energyBudgets) : undefined;

    if (record.taskId !== assignment.taskId || record.toolId !== assignment.toolId ||
        record.executorId !== assignment.executorId || (record.modelId ?? "") !== (assignment.modelId ?? "")) {
      reasons.push("TELEMETRY_ASSIGNMENT_MISMATCH");
      recommendedActions.push("discard_mismatched_telemetry");
    }

    if (!record.success) {
      reasons.push(`EXECUTION_FAILED:${record.errorCode ?? "UNKNOWN"}`);
      recommendedActions.push(...tool.execution.compensationActions);
    }
    if (maxLatencyMs !== undefined && record.latencyMs > maxLatencyMs) {
      reasons.push("LATENCY_BUDGET_EXCEEDED");
      recommendedActions.push("replan_within_latency_budget");
    }
    if (
      minimumQuality > 0 &&
      (record.quality === null || record.quality === undefined)
    ) {
      reasons.push("QUALITY_METRIC_MISSING");
      recommendedActions.push("collect_quality_metric_before_accepting_result");
    } else if (
      minimumQuality > 0 &&
      record.quality !== null &&
      record.quality !== undefined &&
      record.quality < minimumQuality
    ) {
      reasons.push("QUALITY_REQUIREMENT_NOT_MET");
      recommendedActions.push(...tool.execution.compensationActions);
    }
    if (energyBudgetMah !== undefined && (record.energyMah === null || record.energyMah === undefined)) {
      reasons.push("ENERGY_METRIC_MISSING");
      recommendedActions.push("collect_energy_metric_before_accepting_result");
    } else if (energyBudgetMah !== undefined && record.energyMah !== null &&
        record.energyMah !== undefined && record.energyMah > energyBudgetMah) {
      reasons.push("ENERGY_BUDGET_EXCEEDED");
      recommendedActions.push(...tool.execution.compensationActions);
    }
    if (record.fallbackOccurred) {
      reasons.push("FALLBACK_OCCURRED");
      recommendedActions.push("replan_at_stage_boundary");
    }

    return {
      passed: reasons.length === 0,
      reasons,
      recommendedActions: [...new Set(recommendedActions)],
    };
  }
}
