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
import { RuntimeEventBusService } from "../../src/core/runtime/runtime-event-bus.service";

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

  it("emits graph, candidate, and blocked events for a scheduler plan", async () => {
    const registry = new ToolRegistryService();
    registry.registerPlugin(createShoppingPlugin(new ConfigService()));
    const events = new RuntimeEventBusService();
    const scheduler = createScheduler(registry, [localSnapshot()], undefined, events);

    await scheduler.plan(graph("image.embedding"), { runId: "run_demo" });

    const types = events.replay().map((event) => event.type);
    expect(types[0]).toBe("task_graph_received");
    expect(types).toContain("candidate_evaluated");
    expect(types.at(-1)).toBe("plan_blocked");
    expect(events.replay()[0].runId).toBe("run_demo");
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

  it("rejects a saturated local CPU before dispatch", async () => {
    const registry = new ToolRegistryService();
    const tool = toolWithLocalCpu();
    registry.register(tool);
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    performance.record({
      executionId: "cpu-pressure-1",
      taskId: "task-1",
      toolId: tool.toolId,
      executorId: "host-cpu",
      startedAt: "2026-09-06T00:00:00.000Z",
      finishedAt: "2026-09-06T00:00:00.010Z",
      latencyMs: 10,
      memoryPeakMb: 10,
      energyMah: 1,
      quality: 1,
      fallbackOccurred: false,
      success: true,
    });
    const snapshot = localSnapshot();
    snapshot.state.cpuUtilizationPercent = metric(96);
    const scheduler = createScheduler(registry, [snapshot], performance);

    const plan = await scheduler.plan(graph(tool.toolId));

    expect(plan.status).toBe("blocked");
    expect(plan.evaluations["task-1"][0].reasons).toContain("LOCAL_CPU_PRESSURE");
  });

  it("accepts a model capability proven by a fresh platform heartbeat", async () => {
    const registry = new ToolRegistryService();
    const tool = {
      ...toolWithLocalCpu(),
      toolId: "local.npu",
      resourceHints: {
        computeClass: "neural_inference" as const,
        estimatedMemoryMb: 128,
        modelId: "vit-b",
      },
    } satisfies ToolDescriptor;
    registry.register(tool);
    const npu = {
      ...executor("cix-p1-npu"),
      backend: "npu" as const,
      supportedModels: ["vit-b"],
    };
    const snapshot = localSnapshot([npu]);
    snapshot.heartbeat = {
      fresh: true,
      executorIds: [npu.executorId],
    };
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    performance.record({
      executionId: "heartbeat-model-1",
      taskId: "task-1",
      toolId: tool.toolId,
      executorId: npu.executorId,
      modelId: "vit-b",
      startedAt: "2026-09-06T00:00:00.000Z",
      finishedAt: "2026-09-06T00:00:00.020Z",
      latencyMs: 20,
      memoryPeakMb: 64,
      energyMah: 1,
      quality: 0.95,
      fallbackOccurred: false,
      success: true,
    });
    const scheduler = createScheduler(registry, [snapshot], performance);

    const plan = await scheduler.plan(graph(tool.toolId));

    expect(plan.status).toBe("ready");
    expect(plan.assignments[0].executorId).toBe("cix-p1-npu");
  });
});

function createScheduler(
  registry: ToolRegistryService,
  snapshots: ReturnType<typeof localSnapshot>[],
  performance?: PerformanceRegistryService,
  events?: RuntimeEventBusService,
) {
  const platformDiscovery = {
    discover: jest.fn().mockResolvedValue(snapshots),
  } as unknown as PlatformDiscoveryService;
  return new ResourceAwareSchedulerService(
    registry,
    platformDiscovery,
    performance ??
      new PerformanceRegistryService(
        new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
      ),
    new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    events,
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
