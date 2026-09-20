import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ExecutorDescriptor,
  MetricObservation,
  ModelProbeRequest,
  ModelProbeResult,
  PlatformProfile,
  RuntimeState,
} from "./runtime.contracts";
import { PlatformAdapter } from "./platform-adapter.interface";

@Injectable()
export class CloudPlatformAdapterService implements PlatformAdapter {
  readonly platformId = "cloud" as const;

  constructor(private readonly config: ConfigService) {}

  async getStaticProfile(): Promise<PlatformProfile> {
    const backends = await this.discoverExecutors();
    return {
      platformId: this.platformId,
      available: backends.some((backend) => backend.available),
      os: null,
      arch: null,
      runtimeVersion: null,
      cpuLogicalCores: null,
      totalMemoryMb: null,
      backends,
      missingCapabilities: [
        "REMOTE_HARDWARE_PROFILE_NOT_EXPOSED",
        ...backends
          .filter((backend) => !backend.available && backend.availabilityReason)
          .map((backend) => backend.availabilityReason as string),
      ],
      source: "configured-remote-endpoints",
      observedAt: new Date().toISOString(),
    };
  }

  async getRuntimeState(): Promise<RuntimeState> {
    const unavailable = <T>(source: string, reason: string): MetricObservation<T> => ({
      value: null,
      available: false,
      source,
      reason,
      observedAt: new Date().toISOString(),
    });
    return {
      platformId: this.platformId,
      cpuUtilizationPercent: unavailable("cloud", "REMOTE_CPU_METRICS_NOT_EXPOSED"),
      gpuUtilizationPercent: unavailable("cloud", "REMOTE_GPU_METRICS_NOT_EXPOSED"),
      npuUtilizationPercent: unavailable("cloud", "REMOTE_NPU_METRICS_NOT_EXPOSED"),
      temperatureCelsius: unavailable("cloud", "REMOTE_TEMPERATURE_NOT_EXPOSED"),
      freeMemoryMb: unavailable("cloud", "REMOTE_MEMORY_NOT_EXPOSED"),
      networkLatencyMs: unavailable("cloud", "REMOTE_NETWORK_METRICS_NOT_EXPOSED"),
      networkThroughputMbps: unavailable("cloud", "REMOTE_NETWORK_METRICS_NOT_EXPOSED"),
      batteryPercent: unavailable("cloud", "REMOTE_BATTERY_NOT_APPLICABLE"),
      diskFreeMb: unavailable("cloud", "REMOTE_DISK_METRICS_NOT_EXPOSED"),
      activeTaskCount: unavailable("cloud", "REMOTE_TASK_QUEUE_NOT_EXPOSED"),
      observedAt: new Date().toISOString(),
    };
  }

  async discoverExecutors(): Promise<ExecutorDescriptor[]> {
    const endpoints = [
      this.endpoint("cloud-vision", "modelProviders.vision", "neural_inference"),
      this.endpoint("cloud-chat", "modelProviders.chat", "neural_inference"),
      this.endpoint("cloud-embedding", "embedding", "neural_inference"),
    ];
    const marketplace = this.marketplaceExecutor();
    return [...endpoints, marketplace];
  }

  async probeModel(
    executor: ExecutorDescriptor,
    request: ModelProbeRequest,
  ): Promise<ModelProbeResult> {
    return {
      supported: false,
      executorId: executor.executorId,
      modelId: request.modelId,
      evidence: "provider-specific health and model probe is not implemented",
      reason:
        executor.availabilityReason ??
        "REMOTE_MODEL_PROBE_REQUIRES_PROVIDER_SPECIFIC_HEALTH_CHECK",
      checkedAt: new Date().toISOString(),
    };
  }

  private endpoint(
    executorId: string,
    prefix: string,
    computeClass: "neural_inference",
  ): ExecutorDescriptor {
    const baseUrl = this.config.get<string>(`${prefix}.baseUrl`)?.trim();
    const apiKey = this.config.get<string>(`${prefix}.apiKey`)?.trim();
    const modelName = this.config.get<string>(`${prefix}.modelName`)?.trim();
    const missing = [
      !baseUrl ? "BASE_URL" : null,
      !apiKey ? "API_KEY" : null,
      !modelName ? "MODEL_NAME" : null,
    ].filter((value): value is string => value !== null);
    const availabilityReason =
      missing.length > 0
        ? `CLOUD_ENDPOINT_NOT_CONFIGURED:${prefix}:${missing.join(",")}`
        : "CLOUD_PROVIDER_SPECIFIC_PROBE_NOT_IMPLEMENTED";
    return {
      executorId,
      backend: "cloud_api",
      placement: "cloud",
      available: false,
      availabilityReason,
      supportedComputeClasses: [],
      supportedModels: [],
      totalMemoryMb: null,
      source: "environment-configuration",
      capabilities: [],
    };
  }

  private marketplaceExecutor(): ExecutorDescriptor {
    const platforms = ["taobao", "douyin", "pdd", "dewu", "jd"];
    const configured = platforms.filter((platform) => {
      const baseUrl = this.config
        .get<string>(`marketplace.${platform}.apiBaseUrl`)
        ?.trim();
      const apiKey = this.config
        .get<string>(`marketplace.${platform}.apiKey`)
        ?.trim();
      return Boolean(baseUrl && apiKey);
    });
    return {
      executorId: "cloud-marketplace-api",
      backend: "network",
      placement: "cloud",
      available: false,
      availabilityReason:
        configured.length > 0
          ? "CLOUD_MARKETPLACE_PROVIDER_SPECIFIC_PROBE_NOT_IMPLEMENTED"
          : "AUTHORIZED_MARKETPLACE_API_NOT_CONFIGURED",
      supportedComputeClasses: [],
      supportedModels: [],
      totalMemoryMb: null,
      source: "marketplace-environment-configuration",
      capabilities: [],
    };
  }
}
