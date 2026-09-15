import { Injectable } from "@nestjs/common";
import {
  ObjectiveWeights,
  ToolDescriptor,
  ToolPlugin,
} from "./runtime.contracts";

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, ToolDescriptor>();

  registerPlugin(plugin: ToolPlugin) {
    if (!plugin.pluginId.trim()) {
      throw new Error("TOOL_PLUGIN_ID_REQUIRED");
    }
    for (const descriptor of plugin.tools) {
      this.register(descriptor);
    }
  }

  register(descriptor: ToolDescriptor) {
    this.validateDescriptor(descriptor);
    if (this.tools.has(descriptor.toolId)) {
      throw new Error(`TOOL_ALREADY_REGISTERED:${descriptor.toolId}`);
    }
    this.tools.set(descriptor.toolId, descriptor);
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()].sort((left, right) =>
      left.toolId.localeCompare(right.toolId),
    );
  }

  get(toolId: string): ToolDescriptor | undefined {
    return this.tools.get(toolId);
  }

  require(toolId: string): ToolDescriptor {
    const descriptor = this.get(toolId);
    if (!descriptor) throw new Error(`TOOL_NOT_REGISTERED:${toolId}`);
    return descriptor;
  }

  private validateDescriptor(descriptor: ToolDescriptor) {
    if (!descriptor.toolId.trim() || !descriptor.version.trim() || !descriptor.description.trim()) {
      throw new Error("TOOL_ID_AND_VERSION_REQUIRED");
    }
    if (!descriptor.inputType.trim() || !descriptor.outputType.trim()) {
      throw new Error(`TOOL_TYPES_REQUIRED:${descriptor.toolId}`);
    }
    if (
      !Number.isFinite(descriptor.resourceHints.estimatedMemoryMb) ||
      descriptor.resourceHints.estimatedMemoryMb < 0
    ) {
      throw new Error(`TOOL_MEMORY_ESTIMATE_INVALID:${descriptor.toolId}`);
    }
    const variants = descriptor.resourceHints.modelVariants ?? [];
    const modelIds = [descriptor.resourceHints.modelId, ...variants.map(v => v.modelId)].filter(Boolean);
    if ((variants.length > 0 && !descriptor.resourceHints.modelId) ||
        variants.some(v => !v.modelId?.trim() || !["light", "full"].includes(v.tier) ||
        !Number.isFinite(v.estimatedMemoryMb) || v.estimatedMemoryMb < 0) ||
        new Set(modelIds).size !== modelIds.length ||
        descriptor.resourceHints.supportedInputSizes?.some(value => !value.trim())) {
      throw new Error(`TOOL_MODEL_VARIANTS_INVALID:${descriptor.toolId}`);
    }
    const constraints = descriptor.constraints;
    const positiveConstraints = [
      constraints.maxLatencyMs,
      constraints.estimatedDataBytes,
      constraints.energyBudgetMah,
      constraints.costBudgetMinorUnits,
    ].filter((value): value is number => value !== undefined);
    if (!["public", "internal", "sensitive", "high"].includes(constraints.privacy) ||
        !["auto", "local_only", "cloud_only", "local_preferred", "cloud_preferred"].includes(constraints.locality) ||
        typeof constraints.allowLocal !== "boolean" || typeof constraints.allowCloud !== "boolean" ||
        (!constraints.allowLocal && !constraints.allowCloud) ||
        (constraints.locality === "local_only" && !constraints.allowLocal) ||
        (constraints.locality === "cloud_only" && !constraints.allowCloud) ||
        positiveConstraints.some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`TOOL_CONSTRAINTS_INVALID:${descriptor.toolId}`);
    }
    const qualityValues = [descriptor.quality.minimumConfidence, descriptor.quality.minimumScore]
      .filter((value): value is number => value !== undefined);
    if ((descriptor.quality.requiresConfidence !== undefined && typeof descriptor.quality.requiresConfidence !== "boolean") ||
        qualityValues.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
        descriptor.quality.metrics?.some(value => !value.trim())) {
      throw new Error(`TOOL_QUALITY_INVALID:${descriptor.toolId}`);
    }
    if (typeof descriptor.execution.supportsPause !== "boolean" ||
        typeof descriptor.execution.supportsRetry !== "boolean" ||
        !Number.isInteger(descriptor.execution.maxAttempts) || descriptor.execution.maxAttempts < 1 ||
        !Array.isArray(descriptor.execution.compensationActions) ||
        descriptor.execution.compensationActions.some(value => !value.trim()) ||
        !Array.isArray(descriptor.preconditions) || descriptor.preconditions.some(value => !value.trim()) ||
        !Array.isArray(descriptor.postconditions) || descriptor.postconditions.some(value => !value.trim())) {
      throw new Error(`TOOL_EXECUTION_POLICY_INVALID:${descriptor.toolId}`);
    }
    this.assertWeights(descriptor.defaultWeights, descriptor.toolId);
    this.assertNoPlacementSelection(descriptor);
  }

  private assertWeights(weights: ObjectiveWeights, toolId: string) {
    const values = [
      weights.latency,
      weights.quality,
      weights.energy,
      weights.reliability,
    ];
    if (
      values.some((value) => !Number.isFinite(value) || value < 0) ||
      Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.000001
    ) {
      throw new Error(`TOOL_WEIGHTS_MUST_SUM_TO_ONE:${toolId}`);
    }
  }

  private assertNoPlacementSelection(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "backend" || key === "executorId") {
        throw new Error("TOOL_DESCRIPTOR_CANNOT_SELECT_BACKEND");
      }
      this.assertNoPlacementSelection(child);
    }
  }
}
