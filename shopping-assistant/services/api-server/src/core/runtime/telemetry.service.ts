import { Injectable } from "@nestjs/common";
import {
  ExecutionAssignment,
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
  ): VerificationResult {
    const reasons: string[] = [];
    const recommendedActions: string[] = [];
    const maxLatencyMs = tool.constraints.maxLatencyMs;
    const minimumQuality = Math.max(
      tool.quality.minimumConfidence ?? 0,
      tool.quality.minimumScore ?? 0,
    );

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
