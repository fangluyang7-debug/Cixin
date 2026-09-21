import {
  AppVisibility,
  Backend,
  DebugStatePatch,
  DeviceState,
  DeviceStateSource,
  MemoryPressure,
  RealDeviceStatePatch,
  StateObservation,
  ThermalLevel
} from '../api/SchedulerTypes';
import { SchedulerError, SchedulerErrorCode } from '../api/SchedulerError';

export class DeviceStateController {
  private realState: DeviceState;
  private sampledAt: Record<string, number> = {};
  private debugPatch: DebugStatePatch | null = null;
  private debugObservations: StateObservation[] = [];
  private effectiveState: DeviceState;

  constructor() {
    this.realState = this.createDefaultState();
    this.effectiveState = this.cloneState(this.realState);
  }

  public getSnapshot(now: number = Date.now()): DeviceState {
    return this.composeEffectiveState(now);
  }

  public applyRealState(patch: RealDeviceStatePatch, capturedAt: number = Date.now()): boolean {
    this.validatePatch(patch);
    const previous: DeviceState = this.effectiveState;
    if (patch.batteryPercent !== undefined) { this.sampledAt['batteryPercent'] = capturedAt; }
    if (patch.isCharging !== undefined) { this.sampledAt['isCharging'] = capturedAt; }
    if (patch.thermalLevel !== undefined) { this.sampledAt['thermalLevel'] = capturedAt; }
    if (patch.systemCpuUsage !== undefined) { this.sampledAt['systemCpuUsage'] = capturedAt; }
    if (patch.appCpuUsage !== undefined) { this.sampledAt['appCpuUsage'] = capturedAt; }
    if (patch.memoryPressure !== undefined) { this.sampledAt['memoryPressure'] = capturedAt; }
    if (patch.totalMemoryMb !== undefined) { this.sampledAt['totalMemoryMb'] = capturedAt; }
    if (patch.freeMemoryMb !== undefined) { this.sampledAt['freeMemoryMb'] = capturedAt; }
    if (patch.availableMemoryMb !== undefined) { this.sampledAt['availableMemoryMb'] = capturedAt; }
    this.realState = this.mergeRealState(this.realState, patch, capturedAt);
    this.effectiveState = this.composeEffectiveState(capturedAt);
    return !this.hasSameValues(previous, this.effectiveState);
  }

  public applyDebugState(patch: DebugStatePatch, capturedAt: number = Date.now()): boolean {
    this.validatePatch(patch);
    const previous: DeviceState = this.effectiveState;
    this.debugPatch = this.mergeDebugPatch(this.debugPatch, patch);
    this.debugObservations = this.observations(this.debugObservations, patch, capturedAt, 'DEBUG_INJECTION');
    this.effectiveState = this.composeEffectiveState(capturedAt);
    return !this.hasSameValues(previous, this.effectiveState);
  }

  public clearDebugState(capturedAt: number = Date.now()): boolean {
    if (this.debugPatch === null) {
      return false;
    }
    const previous: DeviceState = this.effectiveState;
    this.debugPatch = null;
    this.debugObservations = [];
    this.effectiveState = this.composeEffectiveState(capturedAt);
    return !this.hasSameValues(previous, this.effectiveState);
  }

  private mergeRealState(current: DeviceState, patch: RealDeviceStatePatch, capturedAt: number): DeviceState {
    return {
      observations: this.observations(current.observations ?? [], patch, capturedAt, 'HOST_ADAPTER'),
      batteryPercent: patch.batteryPercent === undefined ? current.batteryPercent : patch.batteryPercent,
      isCharging: patch.isCharging === undefined ? current.isCharging : patch.isCharging,
      thermalLevel: patch.thermalLevel === undefined ? current.thermalLevel : patch.thermalLevel,
      appVisibility: patch.appVisibility === undefined ? current.appVisibility : patch.appVisibility,
      recentLatencyMs: patch.recentLatencyMs === undefined ? current.recentLatencyMs : patch.recentLatencyMs,
      queueDepth: patch.queueDepth === undefined ? current.queueDepth : patch.queueDepth,
      systemCpuUsage: patch.systemCpuUsage === undefined ? current.systemCpuUsage : patch.systemCpuUsage,
      appCpuUsage: patch.appCpuUsage === undefined ? current.appCpuUsage : patch.appCpuUsage,
      memoryPressure: patch.memoryPressure === undefined ? current.memoryPressure : patch.memoryPressure,
      totalMemoryMb: patch.totalMemoryMb === undefined ? current.totalMemoryMb : patch.totalMemoryMb,
      freeMemoryMb: patch.freeMemoryMb === undefined ? current.freeMemoryMb : patch.freeMemoryMb,
      availableMemoryMb: patch.availableMemoryMb === undefined ? current.availableMemoryMb : patch.availableMemoryMb,
      availableBackends: patch.availableBackends === undefined ?
        current.availableBackends.slice() : patch.availableBackends.slice(),
      source: DeviceStateSource.REAL,
      capturedAt: capturedAt
    };
  }

  private mergeDebugPatch(current: DebugStatePatch | null, patch: DebugStatePatch): DebugStatePatch {
    const base: DebugStatePatch = current === null ? {} : current;
    return {
      batteryPercent: patch.batteryPercent === undefined ? base.batteryPercent : patch.batteryPercent,
      isCharging: patch.isCharging === undefined ? base.isCharging : patch.isCharging,
      thermalLevel: patch.thermalLevel === undefined ? base.thermalLevel : patch.thermalLevel,
      appVisibility: patch.appVisibility === undefined ? base.appVisibility : patch.appVisibility,
      recentLatencyMs: patch.recentLatencyMs === undefined ? base.recentLatencyMs : patch.recentLatencyMs,
      queueDepth: patch.queueDepth === undefined ? base.queueDepth : patch.queueDepth,
      systemCpuUsage: patch.systemCpuUsage === undefined ? base.systemCpuUsage : patch.systemCpuUsage,
      appCpuUsage: patch.appCpuUsage === undefined ? base.appCpuUsage : patch.appCpuUsage,
      memoryPressure: patch.memoryPressure === undefined ? base.memoryPressure : patch.memoryPressure,
      totalMemoryMb: patch.totalMemoryMb === undefined ? base.totalMemoryMb : patch.totalMemoryMb,
      freeMemoryMb: patch.freeMemoryMb === undefined ? base.freeMemoryMb : patch.freeMemoryMb,
      availableMemoryMb: patch.availableMemoryMb === undefined ? base.availableMemoryMb : patch.availableMemoryMb,
      availableBackends: patch.availableBackends === undefined ?
        (base.availableBackends === undefined ? undefined : base.availableBackends.slice()) :
        patch.availableBackends.slice()
    };
  }

  private composeEffectiveState(capturedAt: number): DeviceState {
    const realSnapshot: DeviceState = this.cloneState(this.realState);
    realSnapshot.sampledAt = JSON.parse(JSON.stringify(this.sampledAt)) as Record<string, number>;
    if (this.sampledAt['batteryPercent'] === undefined || capturedAt - this.sampledAt['batteryPercent'] > 30000) { realSnapshot.batteryPercent = null; }
    if (this.sampledAt['isCharging'] === undefined || capturedAt - this.sampledAt['isCharging'] > 30000) { realSnapshot.isCharging = null; }
    if (this.sampledAt['thermalLevel'] === undefined || capturedAt - this.sampledAt['thermalLevel'] > 30000) { realSnapshot.thermalLevel = ThermalLevel.UNKNOWN; }
    if (this.sampledAt['systemCpuUsage'] === undefined || capturedAt - this.sampledAt['systemCpuUsage'] > 3000) { realSnapshot.systemCpuUsage = null; }
    if (this.sampledAt['appCpuUsage'] === undefined || capturedAt - this.sampledAt['appCpuUsage'] > 3000) { realSnapshot.appCpuUsage = null; }
    if (this.sampledAt['memoryPressure'] === undefined || capturedAt - this.sampledAt['memoryPressure'] > 3000) { realSnapshot.memoryPressure = MemoryPressure.UNKNOWN; }
    if (this.sampledAt['totalMemoryMb'] === undefined || capturedAt - this.sampledAt['totalMemoryMb'] > 3000) { realSnapshot.totalMemoryMb = null; }
    if (this.sampledAt['freeMemoryMb'] === undefined || capturedAt - this.sampledAt['freeMemoryMb'] > 3000) { realSnapshot.freeMemoryMb = null; }
    if (this.sampledAt['availableMemoryMb'] === undefined || capturedAt - this.sampledAt['availableMemoryMb'] > 3000) { realSnapshot.availableMemoryMb = null; }
    if (this.debugPatch === null) {
      realSnapshot.capturedAt = capturedAt;
      return realSnapshot;
    }

    const patch: DebugStatePatch = this.debugPatch;
    return {
      observations: (realSnapshot.observations ?? []).filter((item: StateObservation) =>
        !this.debugObservations.some((debug: StateObservation) => debug.field === item.field))
        .concat(JSON.parse(JSON.stringify(this.debugObservations)) as StateObservation[]),
      batteryPercent: patch.batteryPercent === undefined ? realSnapshot.batteryPercent : patch.batteryPercent,
      isCharging: patch.isCharging === undefined ? realSnapshot.isCharging : patch.isCharging,
      thermalLevel: patch.thermalLevel === undefined ? realSnapshot.thermalLevel : patch.thermalLevel,
      appVisibility: patch.appVisibility === undefined ? realSnapshot.appVisibility : patch.appVisibility,
      recentLatencyMs: patch.recentLatencyMs === undefined ? realSnapshot.recentLatencyMs : patch.recentLatencyMs,
      queueDepth: patch.queueDepth === undefined ? realSnapshot.queueDepth : patch.queueDepth,
      systemCpuUsage: patch.systemCpuUsage === undefined ? realSnapshot.systemCpuUsage : patch.systemCpuUsage,
      appCpuUsage: patch.appCpuUsage === undefined ? realSnapshot.appCpuUsage : patch.appCpuUsage,
      memoryPressure: patch.memoryPressure === undefined ? realSnapshot.memoryPressure : patch.memoryPressure,
      totalMemoryMb: patch.totalMemoryMb === undefined ? realSnapshot.totalMemoryMb : patch.totalMemoryMb,
      freeMemoryMb: patch.freeMemoryMb === undefined ? realSnapshot.freeMemoryMb : patch.freeMemoryMb,
      availableMemoryMb: patch.availableMemoryMb === undefined ? realSnapshot.availableMemoryMb : patch.availableMemoryMb,
      availableBackends: patch.availableBackends === undefined ?
        realSnapshot.availableBackends.slice() : patch.availableBackends.slice(),
      sampledAt: realSnapshot.sampledAt,
      source: this.isCompleteDebugPatch(patch) ? DeviceStateSource.INJECTED : DeviceStateSource.MIXED,
      capturedAt: capturedAt
    };
  }

  private isCompleteDebugPatch(patch: DebugStatePatch): boolean {
    return patch.batteryPercent !== undefined &&
      patch.isCharging !== undefined &&
      patch.thermalLevel !== undefined &&
      patch.appVisibility !== undefined &&
      patch.recentLatencyMs !== undefined &&
      patch.queueDepth !== undefined &&
      patch.systemCpuUsage !== undefined &&
      patch.appCpuUsage !== undefined &&
      patch.memoryPressure !== undefined &&
      patch.totalMemoryMb !== undefined &&
      patch.freeMemoryMb !== undefined &&
      patch.availableMemoryMb !== undefined &&
      patch.availableBackends !== undefined;
  }

  private validatePatch(patch: RealDeviceStatePatch | DebugStatePatch): void {
    if (patch.batteryPercent !== undefined && patch.batteryPercent !== null &&
      (!Number.isFinite(patch.batteryPercent) || patch.batteryPercent < 0 || patch.batteryPercent > 100)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, 'batteryPercent must be null or between 0 and 100.');
    }
    if (patch.recentLatencyMs !== undefined && patch.recentLatencyMs !== null &&
      (!Number.isFinite(patch.recentLatencyMs) || patch.recentLatencyMs < 0)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, 'recentLatencyMs must be null or non-negative.');
    }
    this.validatePercent('systemCpuUsage', patch.systemCpuUsage);
    this.validatePercent('appCpuUsage', patch.appCpuUsage);
    if (patch.totalMemoryMb !== undefined && patch.totalMemoryMb !== null &&
      (!Number.isFinite(patch.totalMemoryMb) || patch.totalMemoryMb < 0)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, 'totalMemoryMb must be null or non-negative.');
    }
    if (patch.freeMemoryMb !== undefined && patch.freeMemoryMb !== null &&
      (!Number.isFinite(patch.freeMemoryMb) || patch.freeMemoryMb < 0)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, 'freeMemoryMb must be null or non-negative.');
    }
    if (patch.availableMemoryMb !== undefined && patch.availableMemoryMb !== null &&
      (!Number.isFinite(patch.availableMemoryMb) || patch.availableMemoryMb < 0)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, 'availableMemoryMb must be null or non-negative.');
    }

    const realPatch: RealDeviceStatePatch = patch as RealDeviceStatePatch;
    if (realPatch.queueDepth !== undefined &&
      (!Number.isInteger(realPatch.queueDepth) || realPatch.queueDepth < 0)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, 'queueDepth must be a non-negative integer.');
    }
    if (realPatch.availableBackends !== undefined && realPatch.availableBackends.length === 0) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, 'availableBackends must not be empty.');
    }
  }

  private validatePercent(name: string, value?: number | null): void {
    if (value !== undefined && value !== null &&
      (!Number.isFinite(value) || value < 0 || value > 100)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, `${name} must be null or between 0 and 100.`);
    }
  }

  private hasSameValues(left: DeviceState, right: DeviceState): boolean {
    return left.batteryPercent === right.batteryPercent &&
      left.isCharging === right.isCharging &&
      left.thermalLevel === right.thermalLevel &&
      left.appVisibility === right.appVisibility &&
      left.recentLatencyMs === right.recentLatencyMs &&
      left.queueDepth === right.queueDepth &&
      left.systemCpuUsage === right.systemCpuUsage &&
      left.appCpuUsage === right.appCpuUsage &&
      left.memoryPressure === right.memoryPressure &&
      left.totalMemoryMb === right.totalMemoryMb &&
      left.freeMemoryMb === right.freeMemoryMb &&
      left.availableMemoryMb === right.availableMemoryMb &&
      left.source === right.source &&
      this.hasSameBackends(left.availableBackends, right.availableBackends);
  }

  private hasSameBackends(left: Backend[], right: Backend[]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    for (let index: number = 0; index < left.length; index++) {
      if (left[index] !== right[index]) {
        return false;
      }
    }
    return true;
  }

  private cloneState(state: DeviceState): DeviceState {
    return {
      observations: JSON.parse(JSON.stringify(state.observations ?? [])) as StateObservation[],
      batteryPercent: state.batteryPercent,
      isCharging: state.isCharging,
      thermalLevel: state.thermalLevel,
      appVisibility: state.appVisibility,
      recentLatencyMs: state.recentLatencyMs,
      queueDepth: state.queueDepth,
      systemCpuUsage: state.systemCpuUsage,
      appCpuUsage: state.appCpuUsage,
      memoryPressure: state.memoryPressure,
      totalMemoryMb: state.totalMemoryMb,
      freeMemoryMb: state.freeMemoryMb,
      availableMemoryMb: state.availableMemoryMb,
      availableBackends: state.availableBackends.slice(),
      sampledAt: state.sampledAt === undefined ? undefined : JSON.parse(JSON.stringify(state.sampledAt)) as Record<string, number>,
      source: state.source,
      capturedAt: state.capturedAt
    };
  }

  private createDefaultState(): DeviceState {
    return {
      observations: [],
      batteryPercent: null,
      isCharging: null,
      thermalLevel: ThermalLevel.UNKNOWN,
      appVisibility: AppVisibility.FOREGROUND,
      recentLatencyMs: null,
      queueDepth: 0,
      systemCpuUsage: null,
      appCpuUsage: null,
      memoryPressure: MemoryPressure.UNKNOWN,
      totalMemoryMb: null,
      freeMemoryMb: null,
      availableMemoryMb: null,
      availableBackends: [Backend.CPU],
      source: DeviceStateSource.REAL,
      capturedAt: Date.now()
    };
  }

  private observations(previous: StateObservation[], patch: RealDeviceStatePatch | DebugStatePatch,
    now: number, source: string): StateObservation[] {
    const changes: StateObservation[] = [];
    if (patch.batteryPercent !== undefined || patch.isCharging !== undefined) {
      changes.push({ field: 'battery', source: source, observedAtMs: now, known: patch.batteryPercent !== null && patch.isCharging !== null });
    }
    if (patch.thermalLevel !== undefined) {
      changes.push({ field: 'thermal', source: source, observedAtMs: now, known: patch.thermalLevel !== ThermalLevel.UNKNOWN });
    }
    if (patch.memoryPressure !== undefined || patch.availableMemoryMb !== undefined) {
      changes.push({ field: 'memory', source: source, observedAtMs: now,
        known: patch.memoryPressure !== MemoryPressure.UNKNOWN && patch.availableMemoryMb !== null });
    }
    if (patch.systemCpuUsage !== undefined) { changes.push({ field: 'cpu', source: source, observedAtMs: now, known: patch.systemCpuUsage !== null }); }
    if (patch.appVisibility !== undefined) { changes.push({ field: 'visibility', source: source, observedAtMs: now, known: true }); }
    if (patch.availableBackends !== undefined) { changes.push({ field: 'backends', source: source, observedAtMs: now, known: true }); }
    const supplied = (patch as RealDeviceStatePatch).observations ?? [];
    const merged = changes.filter((item: StateObservation) => !supplied.some((other: StateObservation) => other.field === item.field)).concat(supplied);
    return previous.filter((item: StateObservation) => !merged.some((other: StateObservation) => other.field === item.field)).concat(merged);
  }
}
