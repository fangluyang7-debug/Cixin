import { Injectable } from "@nestjs/common";
import * as os from "node:os";
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
export class HostPlatformAdapterService implements PlatformAdapter {
  readonly platformId = "host" as const;

  constructor(private readonly config: ConfigService) {}

  async getStaticProfile(): Promise<PlatformProfile> {
    const cpus = os.cpus();
    const executors = await this.discoverExecutors();
    return {
      platformId: this.platformId,
      available: true,
      os: `${process.platform} ${os.release()}`,
      arch: process.arch,
      runtimeVersion: process.version,
      cpuLogicalCores: cpus.length,
      totalMemoryMb: toMb(os.totalmem()),
      backends: executors,
      missingCapabilities: [
        "GPU_EXECUTOR_NOT_DISCOVERED",
        "NPU_EXECUTOR_NOT_DISCOVERED",
        "HOST_TEMPERATURE_SOURCE_NOT_CONFIGURED",
        "HOST_BATTERY_SOURCE_NOT_CONFIGURED",
      ],
      source: "node:os",
      observedAt: new Date().toISOString(),
    };
  }

  async getRuntimeState(): Promise<RuntimeState> {
    const [cpuUtilizationPercent, networkLatencyMs] = await Promise.all([
      this.readCpuUtilization(),
      this.readNetworkLatency(),
    ]);
    return {
      platformId: this.platformId,
      cpuUtilizationPercent,
      gpuUtilizationPercent: unavailableMetric(
        "gpu-utilization",
        "GPU_UTILIZATION_SOURCE_NOT_CONFIGURED",
      ),
      npuUtilizationPercent: unavailableMetric(
        "npu-utilization",
        "NPU_UTILIZATION_SOURCE_NOT_CONFIGURED",
      ),
      temperatureCelsius: unavailableMetric(
        "temperature",
        "HOST_TEMPERATURE_SOURCE_NOT_CONFIGURED",
      ),
      freeMemoryMb: observedMetric("node:os.freemem", toMb(os.freemem())),
      networkLatencyMs,
      networkThroughputMbps: unavailableMetric(
        "network-throughput",
        "NETWORK_THROUGHPUT_PROBE_NOT_CONFIGURED",
      ),
      batteryPercent: unavailableMetric(
        "battery",
        "HOST_BATTERY_SOURCE_NOT_CONFIGURED",
      ),
      diskFreeMb: unavailableMetric(
        "disk-free",
        "HOST_DISK_SOURCE_NOT_CONFIGURED",
      ),
      activeTaskCount: unavailableMetric(
        "active-tasks",
        "SCHEDULER_ACTIVE_TASK_COUNTER_NOT_CONNECTED",
      ),
      observedAt: new Date().toISOString(),
    };
  }

  async discoverExecutors(): Promise<ExecutorDescriptor[]> {
    return [
      {
        executorId: "host-cpu",
        backend: "cpu",
        placement: "local",
        available: true,
        supportedComputeClasses: ["general_cpu", "storage"],
        supportedModels: [],
        totalMemoryMb: toMb(os.totalmem()),
        source: "node:os",
        capabilities: ["general_cpu", "storage"],
      },
    ];
  }

  async probeModel(
    executor: ExecutorDescriptor,
    request: ModelProbeRequest,
  ): Promise<ModelProbeResult> {
    const supportsClass = executor.supportedComputeClasses.includes(
      request.computeClass,
    );
    const supportsUnspecifiedSoftware = !request.modelId;
    return {
      supported: executor.available && supportsClass && supportsUnspecifiedSoftware,
      executorId: executor.executorId,
      modelId: request.modelId,
      evidence: "node:os executor discovery",
      reason:
        executor.available && supportsClass && supportsUnspecifiedSoftware
          ? undefined
          : request.computeClass === "neural_inference"
            ? "NO_LOCAL_NEURAL_MODEL_RUNTIME_DISCOVERED"
            : "HOST_EXECUTOR_DOES_NOT_SUPPORT_REQUEST",
      checkedAt: new Date().toISOString(),
    };
  }

  private async readCpuUtilization(): Promise<MetricObservation<number>> {
    const before = readCpuTimes();
    await delay(50);
    const after = readCpuTimes();
    if (before.length === 0 || before.length !== after.length) {
      return unavailableMetric("node:os.cpus", "CPU_UTILIZATION_READ_FAILED");
    }
    const totals = after.map((cpu, index) => {
      const previous = before[index];
      const idle = cpu.idle - previous.idle;
      const total = cpu.total - previous.total;
      return total > 0 ? 1 - idle / total : null;
    });
    const valid = totals.filter((value): value is number => value !== null);
    if (valid.length === 0) {
      return unavailableMetric("node:os.cpus", "CPU_UTILIZATION_READ_FAILED");
    }
    return observedMetric(
      "node:os.cpus",
      round(valid.reduce((sum, value) => sum + value, 0) / valid.length * 100),
    );
  }

  private async readNetworkLatency(): Promise<MetricObservation<number>> {
    const probeUrl = this.config.get<string>("runtime.networkProbeUrl")?.trim();
    if (!probeUrl) {
      return unavailableMetric(
        "network-probe",
        "NETWORK_LATENCY_PROBE_NOT_CONFIGURED",
      );
    }
    const timeoutMs = this.config.get<number>("runtime.networkProbeTimeoutMs") ?? 3000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await fetch(probeUrl, {
        method: "HEAD",
        signal: controller.signal,
      });
      if (!response.ok) {
        return unavailableMetric("fetch", `NETWORK_PROBE_HTTP_${response.status}`);
      }
      return observedMetric("fetch", round(performance.now() - startedAt));
    } catch {
      return unavailableMetric("fetch", "NETWORK_LATENCY_PROBE_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  }
}

type CpuTimes = { idle: number; total: number };

function readCpuTimes(): CpuTimes[] {
  return os.cpus().map((cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return { idle: cpu.times.idle, total };
  });
}

function toMb(bytes: number) {
  return Math.floor(bytes / 1024 / 1024);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function observedMetric<T>(source: string, value: T): MetricObservation<T> {
  return {
    value,
    available: true,
    source,
    observedAt: new Date().toISOString(),
  };
}

function unavailableMetric<T>(source: string, reason: string): MetricObservation<T> {
  return {
    value: null,
    available: false,
    source,
    reason,
    observedAt: new Date().toISOString(),
  };
}
