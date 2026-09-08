import { ConfigService } from "@nestjs/config";
import { PlatformStateRegistryService } from "../../src/core/runtime/platform-state-registry.service";
import {
  ExecutorDescriptor,
  PlatformHeartbeat,
  PlatformProfile,
  RuntimeState,
} from "../../src/core/runtime/runtime.contracts";

describe("PlatformStateRegistryService", () => {
  afterEach(() => jest.useRealTimers());

  it("expires reports by server receipt time and keeps profile backends aligned", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-08T12:00:00.000Z"));
    const registry = new PlatformStateRegistryService(
      new ConfigService({ runtime: { platformReportTtlMs: 1000 } }),
    );
    const reportedExecutor = executor("cix-npu");
    const heartbeat: PlatformHeartbeat = {
      platformId: "cix_p1",
      reportedAt: "2099-01-01T00:00:00.000Z",
      source: "board-agent",
      state: state("cix_p1", 72),
      profile: profile([reportedExecutor]),
      executors: [reportedExecutor],
    };
    registry.upsert(heartbeat);

    const fresh = registry.merge("cix_p1", base());
    expect(fresh.heartbeat?.fresh).toBe(true);
    expect(fresh.state.npuUtilizationPercent.value).toBe(72);
    expect(fresh.profile.backends).toEqual([reportedExecutor]);

    jest.advanceTimersByTime(1001);
    const stale = registry.merge("cix_p1", base());
    expect(stale.heartbeat?.fresh).toBe(false);
    expect(stale.state.npuUtilizationPercent.value).toBeNull();
  });
});

function base() {
  return {
    state: state("cix_p1", null),
    profile: profile([]),
    executors: [] as ExecutorDescriptor[],
  };
}

function profile(backends: ExecutorDescriptor[]): PlatformProfile {
  return {
    platformId: "cix_p1",
    available: backends.length > 0,
    os: "HarmonyOS/Linux",
    arch: "arm64",
    runtimeVersion: "test",
    cpuLogicalCores: 12,
    totalMemoryMb: 65536,
    backends,
    missingCapabilities: [],
    source: "test",
    observedAt: "2026-09-08T12:00:00.000Z",
  };
}

function state(platformId: RuntimeState["platformId"], npu: number | null): RuntimeState {
  return {
    platformId,
    cpuUtilizationPercent: metric(npu === null ? null : 40),
    gpuUtilizationPercent: metric(null),
    npuUtilizationPercent: metric(npu),
    temperatureCelsius: metric(npu === null ? null : 55),
    freeMemoryMb: metric(npu === null ? null : 42000),
    networkLatencyMs: metric(null),
    networkThroughputMbps: metric(null),
    batteryPercent: metric(null),
    diskFreeMb: metric(null),
    activeTaskCount: metric(null),
    observedAt: "2026-09-08T12:00:00.000Z",
  };
}

function metric(value: number | null) {
  return {
    value,
    available: value !== null,
    source: "test",
    observedAt: "2026-09-08T12:00:00.000Z",
  };
}

function executor(executorId: string): ExecutorDescriptor {
  return {
    executorId,
    backend: "npu",
    placement: "local",
    available: true,
    supportedComputeClasses: ["neural_inference"],
    supportedModels: ["vit-b"],
    totalMemoryMb: 16384,
    source: "test",
    capabilities: ["neural_inference"],
  };
}
