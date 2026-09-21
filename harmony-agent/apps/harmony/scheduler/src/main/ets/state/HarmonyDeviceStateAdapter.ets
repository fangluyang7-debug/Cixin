import { batteryInfo, BusinessError, commonEventManager, thermal } from '@kit.BasicServicesKit';
import { hidebug } from '@kit.PerformanceAnalysisKit';
import { Backend, MemoryPressure, RealDeviceStatePatch, ThermalLevel } from '../api/SchedulerTypes';

export type RealDeviceStateCallback = (patch: RealDeviceStatePatch) => void;

export class HarmonyDeviceStateAdapter {
  private readonly callback: RealDeviceStateCallback;
  private batterySubscriber: commonEventManager.CommonEventSubscriber | null = null;
  private resourceRefreshTimerId: number = -1;
  private started: boolean = false;

  private readonly thermalCallback = (level: thermal.ThermalLevel): void => {
    if (!this.started) {
      return;
    }
    this.callback({ thermalLevel: this.mapThermalLevel(level) });
  };

  constructor(callback: RealDeviceStateCallback) {
    this.callback = callback;
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.refresh();
    this.startThermalMonitoring();
    this.startResourceMonitoring();
    await this.startBatteryMonitoring();
  }

  public refresh(): void {
    const patch: RealDeviceStatePatch = {
      availableBackends: [Backend.CPU],
      memoryPressure: MemoryPressure.UNKNOWN,
      systemCpuUsage: null,
      appCpuUsage: null,
      totalMemoryMb: null,
      freeMemoryMb: null,
      availableMemoryMb: null
    };

    try {
      patch.batteryPercent = this.normalizeBatteryPercent(batteryInfo.batterySOC);
      patch.isCharging = this.mapChargingState(batteryInfo.chargingStatus);
    } catch (error) {
      patch.batteryPercent = null;
      patch.isCharging = null;
    }

    try {
      patch.thermalLevel = this.mapThermalLevel(thermal.getLevel());
    } catch (error) {
      patch.thermalLevel = ThermalLevel.UNKNOWN;
    }

    this.refreshResourceState(patch);
    const now: number = Date.now();
    patch.observations = [
      { field: 'battery', source: 'batteryInfo', observedAtMs: now, known: patch.batteryPercent !== null && patch.isCharging !== null },
      { field: 'thermal', source: 'thermal.getLevel', observedAtMs: now, known: patch.thermalLevel !== ThermalLevel.UNKNOWN },
      { field: 'memory', source: 'hidebug.getSystemMemInfo(KB)', observedAtMs: now, known: patch.availableMemoryMb !== null },
      { field: 'cpu', source: 'hidebug.getSystemCpuUsage', observedAtMs: now, known: patch.systemCpuUsage !== null },
      { field: 'backends', source: 'APP_VERIFIED_CPU_ONLY', observedAtMs: now, known: true }
    ];
    this.callback(patch);
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;

    try {
      thermal.unregisterThermalLevelCallback();
    } catch (error) {
      // Some devices do not expose the thermal capability to ordinary applications.
    }

    this.stopResourceMonitoring();

    if (this.batterySubscriber !== null) {
      try {
        commonEventManager.unsubscribe(this.batterySubscriber);
      } catch (error) {
        // The subscriber may already have been released by the system.
      }
      this.batterySubscriber = null;
    }
  }

  private startThermalMonitoring(): void {
    try {
      thermal.registerThermalLevelCallback(this.thermalCallback);
    } catch (error) {
      this.callback({ thermalLevel: ThermalLevel.UNKNOWN });
    }
  }

  private async startBatteryMonitoring(): Promise<void> {
    try {
      this.batterySubscriber = await commonEventManager.createSubscriber({
        events: [
          commonEventManager.Support.COMMON_EVENT_BATTERY_CHANGED,
          commonEventManager.Support.COMMON_EVENT_CHARGING,
          commonEventManager.Support.COMMON_EVENT_DISCHARGING
        ]
      });
      commonEventManager.subscribe(
        this.batterySubscriber,
        (error: BusinessError, data: commonEventManager.CommonEventData): void => {
          if (error || !this.started) {
            return;
          }
          if (data.event.length > 0) {
            this.refreshBatteryState();
          }
        }
      );
    } catch (error) {
      this.batterySubscriber = null;
    }
  }

  private startResourceMonitoring(): void {
    this.stopResourceMonitoring();
    this.resourceRefreshTimerId = setInterval(() => {
      if (!this.started) {
        return;
      }
      this.refresh();
    }, 1000);
  }

  private stopResourceMonitoring(): void {
    if (this.resourceRefreshTimerId >= 0) {
      clearInterval(this.resourceRefreshTimerId);
      this.resourceRefreshTimerId = -1;
    }
  }

  private refreshResourceState(patch: RealDeviceStatePatch): void {
    try {
      patch.systemCpuUsage = this.normalizeCpuUsage(hidebug.getSystemCpuUsage());
    } catch (error) {
      patch.systemCpuUsage = null;
    }

    try {
      patch.appCpuUsage = this.normalizeCpuUsage(hidebug.getCpuUsage());
    } catch (error) {
      patch.appCpuUsage = null;
    }

    try {
      const memInfo = hidebug.getSystemMemInfo();
      patch.totalMemoryMb = this.normalizeMemoryMb(memInfo.totalMem);
      patch.freeMemoryMb = this.normalizeMemoryMb(memInfo.freeMem);
      patch.availableMemoryMb = this.normalizeMemoryMb(memInfo.availableMem);
      patch.memoryPressure = this.resolveMemoryPressure(patch.availableMemoryMb, patch.totalMemoryMb);
    } catch (error) {
      patch.totalMemoryMb = null;
      patch.freeMemoryMb = null;
      patch.availableMemoryMb = null;
      patch.memoryPressure = MemoryPressure.UNKNOWN;
    }
  }

  private refreshBatteryState(): void {
    if (!this.started) {
      return;
    }
    try {
      this.callback({
        batteryPercent: this.normalizeBatteryPercent(batteryInfo.batterySOC),
        isCharging: this.mapChargingState(batteryInfo.chargingStatus)
      });
    } catch (error) {
      this.callback({ batteryPercent: null, isCharging: null });
    }
  }

  private normalizeBatteryPercent(value: number): number | null {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return null;
    }
    return Math.round(value);
  }

  private normalizeCpuUsage(value: number): number | null {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    const normalized: number = value <= 1 ? value * 100 : value;
    return Math.min(100, Math.round(normalized * 10) / 10);
  }

  private normalizeMemoryMb(value: number | bigint): number | null {
    const numericValue: number = typeof value === 'bigint' ? Number(value) : value;
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      return null;
    }
    // The installed HarmonyOS SDK declares SystemMemInfo fields in KB.
    return Math.floor(numericValue / 1024);
  }

  private resolveMemoryPressure(availableMemoryMb: number | null, totalMemoryMb: number | null): MemoryPressure {
    if (availableMemoryMb === null) {
      return MemoryPressure.UNKNOWN;
    }
    const availableRatio: number = totalMemoryMb === null || totalMemoryMb <= 0 ?
      1.0 : availableMemoryMb / totalMemoryMb;
    if (availableMemoryMb < 192 || availableRatio < 0.05) {
      return MemoryPressure.CRITICAL;
    }
    if (availableMemoryMb < 512 || availableRatio < 0.12) {
      return MemoryPressure.HIGH;
    }
    if (availableMemoryMb < 1024 || availableRatio < 0.25) {
      return MemoryPressure.MODERATE;
    }
    return MemoryPressure.NORMAL;
  }

  private mapChargingState(state: batteryInfo.BatteryChargeState): boolean | null {
    if (state === batteryInfo.BatteryChargeState.ENABLE || state === batteryInfo.BatteryChargeState.FULL) {
      return true;
    }
    if (state === batteryInfo.BatteryChargeState.DISABLE) {
      return false;
    }
    return null;
  }

  private mapThermalLevel(level: thermal.ThermalLevel): ThermalLevel {
    if (level === thermal.ThermalLevel.COOL || level === thermal.ThermalLevel.NORMAL) {
      return ThermalLevel.NORMAL;
    }
    if (level === thermal.ThermalLevel.WARM) {
      return ThermalLevel.WARM;
    }
    if (level === thermal.ThermalLevel.HOT) {
      return ThermalLevel.HOT;
    }
    if (level >= thermal.ThermalLevel.OVERHEATED && level <= thermal.ThermalLevel.ESCAPE) {
      return ThermalLevel.CRITICAL;
    }
    return ThermalLevel.UNKNOWN;
  }
}
