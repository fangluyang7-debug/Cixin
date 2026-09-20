import { batteryInfo, BusinessError, commonEventManager, thermal } from '@kit.BasicServicesKit';
import { Backend, RealDeviceStatePatch, ThermalLevel } from '../api/SchedulerTypes';

export type RealDeviceStateCallback = (patch: RealDeviceStatePatch) => void;

export class HarmonyDeviceStateAdapter {
  private readonly callback: RealDeviceStateCallback;
  private batterySubscriber: commonEventManager.CommonEventSubscriber | null = null;
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
    await this.startBatteryMonitoring();
  }

  public refresh(): void {
    const patch: RealDeviceStatePatch = {
      availableBackends: [Backend.CPU]
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
