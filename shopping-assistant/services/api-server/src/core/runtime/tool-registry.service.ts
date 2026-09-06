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
    if (!descriptor.toolId.trim() || !descriptor.version.trim()) {
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
