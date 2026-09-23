import {
  Backend, DeviceState, DeviceStateSource, MemoryPressure, ModelTier, PrivacyPolicy, TaskContext, TaskTemplate, ThermalLevel
} from '../api/SchedulerTypes';

export enum PlacementSource { REAL = 'REAL', MOCK = 'MOCK', REPLAY = 'REPLAY' }
export enum PlacementMode { LOCAL_ONLY = 'LOCAL_ONLY', SHADOW = 'SHADOW' }

// Task requirements, device observations, and estimates deliberately have different owners.
export interface ResolvedTaskProfile {
  capability: string;
  modelVersion: string;
  taskSignature: string;
  deadlineMs: number | null;
  userWaiting: boolean;
  qualityFloor: ModelTier;
  privacyPolicy: PrivacyPolicy;
  networkAllowed: boolean;
  inputSanitized: boolean;
  allowedDeviceIds?: string[];
  requiredBackend: Backend;
  minimumMemoryMb: number | null;
  inputBytes: number | null;
  outputBytes: number | null;
}

export interface PlacementDeviceProfile {
  deviceId: string;
  local: boolean;
  source: PlacementSource;
  trusted: boolean;
  online: boolean;
  receivedAtMs: number;
  heartbeatAgeMs: number | null;
  thermalAgeMs: number | null;
  memoryAgeMs: number | null;
  cpuAgeMs: number | null;
  thermalLevel: ThermalLevel;
  memoryPressure: MemoryPressure;
  availableMemoryMb: number | null;
  cpuUsage: number | null;
  availableBackends: Backend[];
  modelVersions: string[];
  loadedModelVersions: string[];
  queueWaitMs: number | null;
  computeMs: number | null;
  coldLoadMs: number | null;
}

export interface PlacementLinkProfile {
  fromDeviceId: string;
  toDeviceId: string;
  receivedAtMs: number;
  sampleAgeMs: number;
  rttMs: number;
  bytesPerSecond: number;
  protocolMs: number;
}

export interface PlacementEstimate {
  deviceId: string;
  transferMs: number;
  queueMs: number;
  modelLoadMs: number;
  computeMs: number;
  totalMs: number;
  uncertaintyMs: number;
}

export interface PlacementDecision {
  mode: PlacementMode;
  actualDeviceId: string;
  suggestedDeviceId: string;
  reasonCodes: string[];
  estimates: PlacementEstimate[];
  rejectedDeviceIds: string[];
  // Shadow never authorizes network dispatch.
  dispatchAllowed: boolean;
}

const BATTERY_THERMAL_TTL_MS: number = 30000;
const RESOURCE_TTL_MS: number = 3000;
const LINK_TTL_MS: number = 3000;
const MAX_DEVICES: number = 4;

function age(sampledAt: number | undefined, now: number): number | null {
  return sampledAt === undefined || sampledAt > now ? null : now - sampledAt;
}

export function resolveTaskProfile(template: TaskTemplate, context: TaskContext,
  requiredBackend: Backend = Backend.CPU, inputBytes: number | null = null,
  outputBytes: number | null = null): ResolvedTaskProfile {
  const sizeBucket: number = Math.floor(Math.log2(Math.max(1, context.inputTokens ?? context.candidateCount ?? 1)));
  const quality: ModelTier = context.highQuality ? ModelTier.HIGH_ACCURACY : context.accuracyFloor;
  const qualityLevel = template.qualityLevels.find((item) => item.modelTier === quality);
  return {
    capability: template.capability, modelVersion: template.resourceHints.modelVersion,
    taskSignature: `${template.capability}:${template.resourceHints.modelVersion}:${sizeBucket}`,
    deadlineMs: context.deadlineMs ?? null, userWaiting: context.userWaiting, qualityFloor: quality,
    privacyPolicy: template.privacyPolicy, networkAllowed: context.networkAllowed === true,
    inputSanitized: context.inputSanitized === true, requiredBackend: requiredBackend,
    minimumMemoryMb: template.resourceHints.expectedMemoryMb ?? qualityLevel?.estimatedMemoryMb ?? null,
    inputBytes: inputBytes, outputBytes: outputBytes
  };
}

export function localDeviceProfile(deviceId: string, state: DeviceState, modelVersions: string[],
  loadedModelVersions: string[], computeMs: number | null, coldLoadMs: number | null,
  now: number): PlacementDeviceProfile {
  const sampled: Record<string, number> = state.sampledAt ?? {};
  return {
    deviceId: deviceId, local: true,
    source: state.source === DeviceStateSource.REAL ? PlacementSource.REAL : PlacementSource.MOCK,
    trusted: true, online: true,
    receivedAtMs: now, heartbeatAgeMs: 0, thermalAgeMs: age(sampled['thermalLevel'], now),
    memoryAgeMs: age(sampled['availableMemoryMb'], now), cpuAgeMs: age(sampled['systemCpuUsage'], now),
    thermalLevel: state.thermalLevel, memoryPressure: state.memoryPressure,
    availableMemoryMb: state.availableMemoryMb, cpuUsage: state.systemCpuUsage,
    availableBackends: state.availableBackends.slice(), modelVersions: modelVersions.slice(),
    loadedModelVersions: loadedModelVersions.slice(), queueWaitMs: null, computeMs: computeMs,
    coldLoadMs: coldLoadMs
  };
}

function validAge(sampleAge: number | null, receivedAt: number, now: number, ttl: number): boolean {
  return sampleAge !== null && sampleAge >= 0 && receivedAt <= now &&
    sampleAge + now - receivedAt <= ttl;
}

function isRemoteAllowed(task: ResolvedTaskProfile, device: PlacementDeviceProfile): boolean {
  return task.networkAllowed && task.privacyPolicy !== PrivacyPolicy.LOCAL_ONLY &&
    (task.privacyPolicy !== PrivacyPolicy.SANITIZED_REMOTE || task.inputSanitized) &&
    (task.allowedDeviceIds === undefined || task.allowedDeviceIds.indexOf(device.deviceId) >= 0);
}

function eligible(task: ResolvedTaskProfile, device: PlacementDeviceProfile, now: number): boolean {
  if (!device.online || !device.trusted || (device.source !== PlacementSource.REAL && device.local) ||
    device.availableBackends.indexOf(task.requiredBackend) < 0 ||
    device.modelVersions.indexOf(task.modelVersion) < 0 ||
    device.thermalLevel === ThermalLevel.CRITICAL || device.memoryPressure === MemoryPressure.CRITICAL ||
    (task.minimumMemoryMb !== null && (device.availableMemoryMb === null ||
      device.availableMemoryMb < task.minimumMemoryMb * 2))) { return false; }
  if (!device.local && (!isRemoteAllowed(task, device) ||
    !validAge(device.heartbeatAgeMs, device.receivedAtMs, now, RESOURCE_TTL_MS) ||
    !validAge(device.thermalAgeMs, device.receivedAtMs, now, BATTERY_THERMAL_TTL_MS) ||
    !validAge(device.memoryAgeMs, device.receivedAtMs, now, RESOURCE_TTL_MS) ||
    !validAge(device.cpuAgeMs, device.receivedAtMs, now, RESOURCE_TTL_MS) ||
    device.thermalLevel === ThermalLevel.UNKNOWN || device.memoryPressure === MemoryPressure.UNKNOWN ||
    device.availableMemoryMb === null || device.cpuUsage === null)) { return false; }
  return true;
}

function linkFor(source: string, target: string, links: PlacementLinkProfile[], now: number): PlacementLinkProfile | null {
  const link: PlacementLinkProfile | undefined = links.find((item: PlacementLinkProfile) =>
    item.fromDeviceId === source && item.toDeviceId === target);
  if (link === undefined || !validAge(link.sampleAgeMs, link.receivedAtMs, now, LINK_TTL_MS) ||
    !Number.isFinite(link.rttMs) || link.rttMs < 0 || !Number.isFinite(link.protocolMs) || link.protocolMs < 0 ||
    !Number.isFinite(link.bytesPerSecond) || link.bytesPerSecond <= 0) { return null; }
  return link;
}

export class GlobalPlacementPolicy {
  public evaluate(task: ResolvedTaskProfile, localId: string, devices: PlacementDeviceProfile[],
    links: PlacementLinkProfile[], mode: PlacementMode, now: number = Date.now()): PlacementDecision {
    const estimates: PlacementEstimate[] = [];
    const rejected: string[] = [];
    const local: PlacementDeviceProfile | undefined = devices.find((item: PlacementDeviceProfile) =>
      item.deviceId === localId && item.local && item.source === PlacementSource.REAL);
    const candidates: PlacementDeviceProfile[] = local === undefined ? [] : [local];
    if (mode === PlacementMode.SHADOW) {
      devices.filter((item: PlacementDeviceProfile) => item.deviceId !== localId).slice(0, MAX_DEVICES - 1)
        .forEach((item: PlacementDeviceProfile) => candidates.push(item));
    }
    candidates.forEach((device: PlacementDeviceProfile) => {
      if (!eligible(task, device, now) || device.computeMs === null || device.computeMs < 0 ||
        !Number.isFinite(device.computeMs) ||
        (device.queueWaitMs !== null && (!Number.isFinite(device.queueWaitMs) || device.queueWaitMs < 0)) ||
        (device.coldLoadMs !== null && (!Number.isFinite(device.coldLoadMs) || device.coldLoadMs < 0))) {
        rejected.push(device.deviceId); return;
      }
      let transfer: number = 0;
      if (!device.local) {
        const link: PlacementLinkProfile | null = linkFor(localId, device.deviceId, links, now);
        if (link === null || task.inputBytes === null || task.outputBytes === null ||
          task.inputBytes < 0 || task.outputBytes < 0) { rejected.push(device.deviceId); return; }
        transfer = link.rttMs + link.protocolMs +
          (task.inputBytes + task.outputBytes) / link.bytesPerSecond * 1000;
      }
      const cold: number = device.loadedModelVersions.indexOf(task.modelVersion) >= 0 ? 0 : device.coldLoadMs ?? Infinity;
      const queue: number = device.queueWaitMs ?? (device.local ? 0 : Infinity);
      const total: number = transfer + queue + cold + device.computeMs;
      if (!Number.isFinite(total)) { rejected.push(device.deviceId); return; }
      estimates.push({ deviceId: device.deviceId, transferMs: transfer, queueMs: queue,
        modelLoadMs: cold, computeMs: device.computeMs, totalMs: total,
        uncertaintyMs: device.local ? 0 : Math.max(5, total * 0.2) });
    });
    const localEstimate: PlacementEstimate | undefined = estimates.find((item: PlacementEstimate) => item.deviceId === localId);
    let suggested: string = localId;
    if (mode === PlacementMode.SHADOW && localEstimate !== undefined) {
      estimates.filter((item: PlacementEstimate) => item.deviceId !== localId &&
        item.totalMs + item.uncertaintyMs + 10 < localEstimate.totalMs &&
        (task.deadlineMs === null || item.totalMs + item.uncertaintyMs <= task.deadlineMs))
        .sort((a: PlacementEstimate, b: PlacementEstimate) => a.totalMs + a.uncertaintyMs - b.totalMs - b.uncertaintyMs)
        .slice(0, 1).forEach((item: PlacementEstimate) => { suggested = item.deviceId; });
    }
    return { mode: mode, actualDeviceId: localId, suggestedDeviceId: suggested,
      reasonCodes: localEstimate === undefined ? ['LOCAL_REQUIRES_RECHECK'] :
        suggested === localId ? ['LOCAL_PREFERRED'] : ['SHADOW_REMOTE_BETTER'],
      estimates: estimates, rejectedDeviceIds: rejected, dispatchAllowed: false };
  }
}
