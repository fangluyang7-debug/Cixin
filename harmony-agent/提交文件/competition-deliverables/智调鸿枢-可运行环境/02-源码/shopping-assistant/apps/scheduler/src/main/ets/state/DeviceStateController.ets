import {
  AppVisibility,
  Backend,
  DebugStatePatch,
  DeviceState,
  DeviceStateSource,
  MemoryPressure,
  RealDeviceStatePatch,
  ThermalLevel
} from '../api/SchedulerTypes';
import { SchedulerError, SchedulerErrorCode } from '../api/SchedulerError';

export class DeviceStateController {
  private realState: DeviceState;
  private debugPatch: DebugStatePatch | null = null;
  private effectiveState: DeviceState;

  constructor() {
    this.realState = this.createDefaultState();
    this.effectiveState = this.cloneState(this.realState);
  }

  public getSnapshot(): DeviceState {
    return this.cloneState(this.effectiveState);
  }

  public applyRealState(patch: RealDeviceStatePatch, capturedAt: number = Date.now()): boolean {
    this.validatePatch(patch);
    const previous: DeviceState = this.effectiveState;
    this.realState = this.mergeRealState(this.realState, patch, capturedAt);
    this.effectiveState = this.composeEffectiveState(capturedAt);
    return !this.hasSameValues(previous, this.effectiveState);
  }

  public applyDebugState(patch: DebugStatePatch, capturedAt: number = Date.now()): boolean {
    this.validatePatch(patch);
    const previous: DeviceState = this.effectiveState;
    this.debugPatch = this.mergeDebugPatch(this.debugPatch, patch);
    this.effectiveState = this.composeEffectiveState(capturedAt);
    return !this.hasSameValues(previous, this.effectiveState);
  }

  public clearDebugState(capturedAt: number = Date.now()): boolean {
    if (this.debugPatch === null) {
      return false;
    }
    const previous: DeviceState = this.effectiveState;
    this.debugPatch = null;
    this.effectiveState = this.composeEffectiveState(capturedAt);
    return !this.hasSameValues(previous, this.effectiveState);
  }

  private mergeRealState(current: DeviceState, patch: RealDeviceStatePatch, capturedAt: number): DeviceState {
    return {
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
    if (this.debugPatch === null) {
      const realSnapshot: DeviceState = this.cloneState(this.realState);
      realSnapshot.capturedAt = capturedAt;
      return realSnapshot;
    }

    const patch: DebugStatePatch = this.debugPatch;
    return {
      batteryPercent: patch.batteryPercent === undefined ? this.realState.batteryPercent : patch.batteryPercent,
      isCharging: patch.isCharging === undefined ? this.realState.isCharging : patch.isCharging,
      thermalLevel: patch.thermalLevel === undefined ? this.realState.thermalLevel : patch.thermalLevel,
      appVisibility: patch.appVisibility === undefined ? this.realState.appVisibility : patch.appVisibility,
      recentLatencyMs: patch.recentLatencyMs === undefined ? this.realState.recentLatencyMs : patch.recentLatencyMs,
      queueDepth: patch.queueDepth === undefined ? this.realState.queueDepth : patch.queueDepth,
      systemCpuUsage: patch.systemCpuUsage === undefined ? this.realState.systemCpuUsage : patch.systemCpuUsage,
      appCpuUsage: patch.appCpuUsage === undefined ? this.realState.appCpuUsage : patch.appCpuUsage,
      memoryPressure: patch.memoryPressure === undefined ? this.realState.memoryPressure : patch.memoryPressure,
      totalMemoryMb: patch.totalMemoryMb === undefined ? this.realState.totalMemoryMb : patch.totalMemoryMb,
      freeMemoryMb: patch.freeMemoryMb === undefined ? this.realState.freeMemoryMb : patch.freeMemoryMb,
      availableMemoryMb: patch.availableMemoryMb === undefined ? this.realState.availableMemoryMb : patch.availableMemoryMb,
      availableBackends: patch.availableBackends === undefined ?
        this.realState.availableBackends.slice() : patch.availableBackends.slice(),
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
      source: state.source,
      capturedAt: state.capturedAt
    };
  }

  private createDefaultState(): DeviceState {
    return {
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
}
