import {
  AppVisibility,
  Backend,
  DebugStatePatch,
  DeviceState,
  DeviceStateSource,
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
    if (patch.batteryPercent !== undefined || patch.thermalLevel !== undefined) {
      this.debugPatch = patch;
    } else {
      this.debugPatch = this.mergeDebugPatch(this.debugPatch, patch);
    }
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

    const realPatch: RealDeviceStatePatch = patch as RealDeviceStatePatch;
    if (realPatch.queueDepth !== undefined &&
      (!Number.isInteger(realPatch.queueDepth) || realPatch.queueDepth < 0)) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, 'queueDepth must be a non-negative integer.');
    }
    if (realPatch.availableBackends !== undefined && realPatch.availableBackends.length === 0) {
      throw new SchedulerError(SchedulerErrorCode.INVALID_STATE, 'availableBackends must not be empty.');
    }
  }

  private hasSameValues(left: DeviceState, right: DeviceState): boolean {
    return left.batteryPercent === right.batteryPercent &&
      left.isCharging === right.isCharging &&
      left.thermalLevel === right.thermalLevel &&
      left.appVisibility === right.appVisibility &&
      left.recentLatencyMs === right.recentLatencyMs &&
      left.queueDepth === right.queueDepth &&
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
      availableBackends: [Backend.CPU],
      source: DeviceStateSource.REAL,
      capturedAt: Date.now()
    };
  }
}
