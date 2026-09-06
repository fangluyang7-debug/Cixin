import { Injectable } from "@nestjs/common";
import {
  ExecutorDescriptor,
  MetricObservation,
  ModelProbeRequest,
  ModelProbeResult,
  PlatformProfile,
  RuntimeState,
} from "./runtime.contracts";
import { PlatformAdapter } from "./platform-adapter.interface";

abstract class UnavailablePlatformAdapter implements PlatformAdapter {
  abstract readonly platformId: "harmonyos" | "cix_p1";
  abstract readonly unavailableReason: string;

  async getStaticProfile(): Promise<PlatformProfile> {
    return {
      platformId: this.platformId,
      available: false,
      os: null,
      arch: null,
      runtimeVersion: null,
      cpuLogicalCores: null,
      totalMemoryMb: null,
      backends: [],
      missingCapabilities: [this.unavailableReason],
      source: "adapter-placeholder-without-device",
      observedAt: new Date().toISOString(),
    };
  }

  async getRuntimeState(): Promise<RuntimeState> {
    const unavailable = <T>(): MetricObservation<T> => ({
      value: null,
      available: false,
      source: this.platformId,
      reason: this.unavailableReason,
      observedAt: new Date().toISOString(),
    });
    return {
      platformId: this.platformId,
      cpuUtilizationPercent: unavailable(),
      gpuUtilizationPercent: unavailable(),
      npuUtilizationPercent: unavailable(),
      temperatureCelsius: unavailable(),
      freeMemoryMb: unavailable(),
      networkLatencyMs: unavailable(),
      networkThroughputMbps: unavailable(),
      batteryPercent: unavailable(),
      diskFreeMb: unavailable(),
      activeTaskCount: unavailable(),
      observedAt: new Date().toISOString(),
    };
  }

  async discoverExecutors(): Promise<ExecutorDescriptor[]> {
    return [];
  }

  async probeModel(
    executor: ExecutorDescriptor,
    request: ModelProbeRequest,
  ): Promise<ModelProbeResult> {
    return {
      supported: false,
      executorId: executor.executorId,
      modelId: request.modelId,
      evidence: "no platform device attached",
      reason: this.unavailableReason,
      checkedAt: new Date().toISOString(),
    };
  }
}

@Injectable()
export class HarmonyPlatformAdapterService extends UnavailablePlatformAdapter {
  readonly platformId = "harmonyos" as const;
  readonly unavailableReason = "HARMONYOS_DEVICE_ADAPTER_NOT_CONNECTED";
}

@Injectable()
export class CixP1PlatformAdapterService extends UnavailablePlatformAdapter {
  readonly platformId = "cix_p1" as const;
  readonly unavailableReason = "CIX_P1_DEVICE_ADAPTER_NOT_CONNECTED";
}
