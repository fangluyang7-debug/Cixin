import { ToolDescriptor } from '../contracts/cixin';
import { FleetConstraints, ToolImplementation, ToolInfo } from '../contracts/fleet';
import { ModelTier, TaskContext } from '../scheduler/api/SchedulerTypes';
import { validateManifest } from '../scheduler/policy/ProfileContract';
import { digest, finite, identifier, invariant } from './util';

const privacyRank = { public: 0, internal: 1, sensitive: 2, high: 3 };
export class ToolRegistry {
  private readonly tools = new Map<string, ToolImplementation>();
  register(tool: ToolImplementation): void {
    invariant(identifier(tool.descriptor.toolId) && !this.tools.has(tool.descriptor.toolId), 'DUPLICATE_OR_INVALID_TOOL');
    invariant(tool.template.capability === tool.descriptor.toolId && tool.executor.capability === tool.descriptor.toolId,
      'TOOL_CAPABILITY_MISMATCH');
    invariant(tool.template.manifest && !tool.template.workflow, 'LEAF_MANIFEST_REQUIRED');
    validateManifest(tool.template);
    this.tools.set(tool.descriptor.toolId, tool);
  }
  get(id: string): ToolImplementation { const tool = this.tools.get(id); invariant(tool, `TOOL_NOT_REGISTERED:${id}`); return tool; }
  values(): ToolImplementation[] { return [...this.tools.values()]; }
  info(id: string): ToolInfo {
    const tool = this.get(id);
    return { descriptor: tool.descriptor, contractDigest: digest(tool.descriptor), modelDigest: tool.modelDigest,
      runtimeVersion: tool.runtimeVersion };
  }
}
export function validateConstraints(value: FleetConstraints): void {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_CONSTRAINTS');
  if (value.privacy !== undefined) invariant(Object.hasOwn(privacyRank, value.privacy), 'INVALID_PRIVACY');
  if (value.locality !== undefined) invariant(['auto','local_only','local_preferred','cloud_only','cloud_preferred'].includes(value.locality), 'INVALID_LOCALITY');
  for (const field of ['deadlineMs', 'maxLatencyMs'] as const) if (value[field] !== undefined)
    invariant(finite(value[field], 1, 3_600_000), `INVALID_${field}`);
  if (value.minimumQuality !== undefined) invariant(finite(value.minimumQuality, 0, 1), 'INVALID_QUALITY');
  if (value.allowRemote !== undefined) invariant(typeof value.allowRemote === 'boolean', 'INVALID_ALLOW_REMOTE');
  if (value.inputSanitized !== undefined) invariant(typeof value.inputSanitized === 'boolean', 'INVALID_SANITIZATION');
  if (value.allowedDeviceIds !== undefined) invariant(Array.isArray(value.allowedDeviceIds) &&
    value.allowedDeviceIds.length <= 64 && value.allowedDeviceIds.every(identifier), 'INVALID_DEVICE_ALLOWLIST');
  // Constraints that cannot currently be measured must fail closed.
  invariant(value.energyBudgetMah === undefined && value.costBudgetMinorUnits === undefined, 'UNMEASURED_BUDGET');
}
export function remoteAllowed(tool: ToolDescriptor, constraints: FleetConstraints, deviceId: string): boolean {
  const privacy = Math.max(privacyRank[tool.constraints.privacy], privacyRank[constraints.privacy ?? 'public']);
  return constraints.allowRemote === true && privacy < 2 && tool.constraints.allowLocal &&
    tool.constraints.locality !== 'local_only' && constraints.locality !== 'local_only' &&
    (!constraints.allowedDeviceIds || constraints.allowedDeviceIds.includes(deviceId));
}
export function contextFor(constraints: FleetConstraints, remainingMs: number): TaskContext {
  validateConstraints(constraints);
  invariant(finite(remainingMs, 1, 3_600_000), 'DEADLINE_EXPIRED');
  // Numeric quality is verified by a business postcondition; the scheduler never silently degrades it.
  return { userVisible: true, userWaiting: true, accuracyFloor: ModelTier.HIGH_ACCURACY,
    highQuality: true, deadlineMs: remainingMs, targetLatencyMs: constraints.maxLatencyMs ?? remainingMs,
    networkAllowed: false, inputSanitized: constraints.inputSanitized };
}
