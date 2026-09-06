import { ConfigService } from "@nestjs/config";
import { PerformanceRegistryService } from "../../src/core/runtime/performance-registry.service";
import { PlatformDiscoveryService } from "../../src/core/runtime/platform-discovery.service";
import { ResourceAwareSchedulerService } from "../../src/core/runtime/scheduler.service";
import {
  ExecutorDescriptor,
  PlatformProfile,
  RuntimeState,
  TaskGraph,
  ToolDescriptor,
} from "../../src/core/runtime/runtime.contracts";
import { ToolRegistryService } from "../../src/core/runtime/tool-registry.service";
import { createShoppingPlugin } from "../../src/core/runtime/shopping-plugin";

describe("ResourceAwareSchedulerService", () => {
  it("blocks a local neural task until real performance data exists", async () => {
    const registry = new ToolRegistryService();
    registry.registerPlugin(createShoppingPlugin(new ConfigService()));
    const scheduler = createScheduler(registry, [localSnapshot()]);

    const plan = await scheduler.plan(graph("image.embedding"));

    expect(plan.status).toBe("blocked");
    expect(plan.assignments).toHaveLength(0);
    expect(plan.missingRequirements[0].code).toBe("NO_FEASIBLE_EXECUTOR");
    expect(plan.evaluations["task-1"][0].reasons).toContain(
      "MODEL_UNSUPPORTED:NO_LOCAL_NEURAL_MODEL_RUNTIME_DISCOVERED",
    );
  });

  it("filters hard constraints before scoring measured candidates", async () => {
    const registry = new ToolRegistryService();
    const tool = toolWithLocalCpu();
    registry.register(tool);
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    for (const executorId of ["local-fast", "local-slow"]) {
      performance.record({
        executionId: `${executorId}-1`,
        taskId: "crop-1",
        toolId: tool.toolId,
        executorId,
        startedAt: "2026-09-06T00:00:00.000Z",
        finishedAt: "2026-09-06T00:00:01.000Z",
        latencyMs: executorId === "local-fast" ? 10 : 30,
        memoryPeakMb: 10,
        energyMah: executorId === "local-fast" ? 2 : 4,
        quality: 1,
        fallbackOccurred: false,
        success: true,
      });
    }
    const scheduler = createScheduler(
      registry,
      [localSnapshot([executor("local-fast"), executor("local-slow")])],
      performance,
    );

    const plan = await scheduler.plan(graph(tool.toolId));

    expect(plan.status).toBe("ready");
    expect(plan.assignments[0].executorId).toBe("local-fast");
    expect(plan.evaluations["task-1"].every((item) => item.accepted)).toBe(
      true,
    );
  });

  it("rejects cloud execution for high privacy tasks", async () => {
    const registry = new ToolRegistryService();
    const tool = {
      ...toolWithLocalCpu(),
      toolId: "private.cpu",
      constraints: {
        ...toolWithLocalCpu().constraints,
        allowLocal: false,
        allowCloud: true,
        locality: "cloud_preferred" as const,
        privacy: "high" as const,
      },
      resourceHints: {
        ...toolWithLocalCpu().resourceHints,
        computeClass: "general_cpu" as const,
      },
    } satisfies ToolDescriptor;
    registry.register(tool);
    const scheduler = createScheduler(registry, [
      localSnapshot([], [executor("cloud-api", "cloud")]),
    ]);

    const plan = await scheduler.plan(graph(tool.toolId));

    expect(plan.status).toBe("blocked");
    expect(plan.evaluations["task-1"][0].reasons).toContain(
      "HIGH_PRIVACY_REQUIRES_LOCAL_EXECUTION",
    );
  });
});

function createScheduler(
  registry: ToolRegistryService,
  snapshots: ReturnType<typeof localSnapshot>[],
  performance = new PerformanceRegistryService(
    new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
  ),
) {
  const platformDiscovery = {
    discover: jest.fn().mockResolvedValue(snapshots),
  } as unknown as PlatformDiscoveryService;
  return new ResourceAwareSchedulerService(
    registry,
    platformDiscovery,
    performance,
    new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
  );
}

function graph(toolId: string): TaskGraph {
  return {
    graphId: "test-graph",
    goal: "测试任务",
    nodes: [{ taskId: "task-1", toolId, inputRef: "input-1" }],
  };
}

function toolWithLocalCpu(): ToolDescriptor {
  return {
    toolId: "local.cpu",
    version: "1.0.0",
    description: "测试工具",
    inputType: "Input",
    outputType: "Output",
    preconditions: [],
    postconditions: [],
    quality: {},
    constraints: {
      privacy: "internal",
      locality: "local_only",
      allowLocal: true,
      allowCloud: false,
    },
    resourceHints: { computeClass: "general_cpu", estimatedMemoryMb: 1 },
    execution: {
      supportsPause: false,
      supportsRetry: true,
      maxAttempts: 1,
      compensationActions: [],
    },
    defaultWeights: {
      latency: 0.4,
      quality: 0.3,
      energy: 0.15,
      reliability: 0.15,
    },
  };
}

function executor(
  executorId: string,
  placement: "local" | "cloud" = "local",
): ExecutorDescriptor {
  return {
    executorId,
    backend: placement === "local" ? "cpu" : "cloud_api",
    placement,
    available: true,
    supportedComputeClasses: ["general_cpu", "neural_inference"],
    supportedModels: [],
    totalMemoryMb: placement === "local" ? 1000 : null,
    source: "test",
    capabilities: ["general_cpu"],
  };
}

function localSnapshot(
  executors: ExecutorDescriptor[] = [executor("host-cpu")],
  cloudExecutors: ExecutorDescriptor[] = [],
) {
  const state: RuntimeState = {
    platformId: "host",
    cpuUtilizationPercent: metric(20),
    gpuUtilizationPercent: unavailable("test"),
    npuUtilizationPercent: unavailable("test"),
    temperatureCelsius: unavailable("test"),
    freeMemoryMb: metric(4096),
    networkLatencyMs: unavailable("test"),
    networkThroughputMbps: unavailable("test"),
    batteryPercent: unavailable("test"),
    diskFreeMb: unavailable("test"),
    activeTaskCount: unavailable("test"),
    observedAt: "2026-09-06T00:00:00.000Z",
  };
  const profile: PlatformProfile = {
    platformId: "host",
    available: true,
    os: "test",
    arch: "x64",
    runtimeVersion: "test",
    cpuLogicalCores: 4,
    totalMemoryMb: 8192,
    backends: [...executors, ...cloudExecutors],
    missingCapabilities: [],
    source: "test",
    observedAt: "2026-09-06T00:00:00.000Z",
  };
  return {
    adapter: {
      probeModel: jest.fn().mockImplementation((_executor, request) =>
        Promise.resolve({
          supported: request.computeClass !== "neural_inference",
          reason: "NO_LOCAL_NEURAL_MODEL_RUNTIME_DISCOVERED",
        }),
      ),
    },
    profile,
    state,
    executors: [...executors, ...cloudExecutors],
  } as any;
}

function metric(value: number) {
  return {
    value,
    available: true,
    source: "test",
    observedAt: "2026-09-06T00:00:00.000Z",
  };
}

function unavailable(source: string) {
  return {
    value: null,
    available: false,
    source,
    reason: "missing",
    observedAt: "2026-09-06T00:00:00.000Z",
  };
}
