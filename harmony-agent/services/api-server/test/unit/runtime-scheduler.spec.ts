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
import { estimateCloudRoute } from "../../src/core/runtime/cloud-route-cost";

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

  it("includes measured transfer cost before choosing a cloud executor", async () => {
    const registry = new ToolRegistryService();
    const tool: ToolDescriptor = {
      ...toolWithLocalCpu(),
      constraints: { ...toolWithLocalCpu().constraints,
        locality: "auto", allowCloud: true, maxLatencyMs: 2_000, costBudgetMinorUnits: 20 },
    };
    registry.register(tool);
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    for (const [executorId, duration] of [["host-cpu", 100], ["cloud-api", 5]] as const) {
      performance.record({
        executionId: `${executorId}-1`, taskId: "task-1", toolId: tool.toolId,
        executorId, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        latencyMs: duration, latencyScope: "execution_only", memoryPeakMb: 10,
        energyMah: 1, quality: 1, fallbackOccurred: false, success: true,
      });
    }
    const scheduler = createScheduler(registry,
      [localSnapshot([executor("host-cpu")], [executor("cloud-api", "cloud")])], performance);
    const taskGraph = graph(tool.toolId);
    taskGraph.nodes[0].cloudRoutes = [{
      executorId: "cloud-api", inputResidence: "device", accessMode: "inline_transfer",
      transferAuthorized: true, inputBytes: 1_000_000, outputBytes: 1_000,
      roundTripMs: 80, uploadMbps: 10, downloadMbps: 10,
      storageReadMs: 0, queueMs: 20, estimatedFeeMinorUnits: 5,
      observedAt: new Date().toISOString(), source: "measured",
    }];

    const plan = await scheduler.plan(taskGraph);

    expect(plan.status).toBe("ready");
    expect(plan.assignments[0].executorId).toBe("host-cpu");
    expect(plan.evaluations["task-1"].find((item) => item.executorId === "cloud-api")
      ?.estimatedEndToEndMs).toBeGreaterThan(800);

    taskGraph.nodes[0].cloudRoutes = undefined;
    const withoutRoute = await scheduler.plan(taskGraph);
    expect(withoutRoute.evaluations["task-1"].find((item) => item.executorId === "cloud-api")
      ?.reasons).toContain("CLOUD_ROUTE_PROFILE_MISSING");
  });

  it("rejects expired signed COS access and stale link observations", () => {
    const now = Date.now();
    const task = graph("local.cpu").nodes[0];
    task.cloudRoutes = [{
      executorId: "cloud-api", inputResidence: "cos", accessMode: "signed_object_url",
      transferAuthorized: true, inputBytes: 100, outputBytes: 100,
      roundTripMs: 20, uploadMbps: 10, downloadMbps: 10,
      storageReadMs: 10, queueMs: 0,
      accessExpiresAt: new Date(now + 1_000).toISOString(),
      observedAt: new Date(now - 60_000).toISOString(), source: "measured",
    }];
    const estimate = estimateCloudRoute(task, "cloud-api", now);
    expect(estimate.reasons).toContain("SIGNED_OBJECT_ACCESS_EXPIRED");
    expect(estimate.reasons).toContain("CLOUD_ROUTE_EXPIRED");
    expect(estimate.overheadMs).toBeNull();
  });

  it("counts COS read and write instead of phone upload and download", () => {
    const now = Date.now();
    const task = graph("local.cpu").nodes[0];
    task.cloudRoutes = [{
      executorId: "cloud-api", inputResidence: "cos", outputDestination: "cos",
      accessMode: "signed_object_url", transferAuthorized: true,
      inputBytes: 10_000_000, outputBytes: 5_000_000,
      roundTripMs: 20, uploadMbps: 0, downloadMbps: 0,
      storageReadMs: 30, storageWriteMs: 15, queueMs: 10,
      accessExpiresAt: new Date(now + 120_000).toISOString(),
      observedAt: new Date(now).toISOString(), source: "measured",
    }];
    expect(estimateCloudRoute(task, "cloud-api", now)).toEqual({
      reasons: [], overheadMs: 75, feeMinorUnits: null,
    });
  });

  it("re-estimates cloud end-to-end time from execution feedback and the current route", async () => {
    const registry = new ToolRegistryService();
    const tool: ToolDescriptor = {
      ...toolWithLocalCpu(),
      constraints: { ...toolWithLocalCpu().constraints, locality: "auto", allowCloud: true },
    };
    registry.register(tool);
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    const base = {
      taskId: "task-1", toolId: tool.toolId,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      memoryPeakMb: 10, energyMah: 1, quality: 1,
      fallbackOccurred: false, success: true,
    };
    performance.record({ ...base, executionId: "local-1", executorId: "host-cpu",
      latencyMs: 200 });
    performance.record({ ...base, executionId: "cloud-1", executorId: "cloud-api",
      latencyMs: 900, latencyScope: "end_to_end",
      cloud: { inputBytes: 100_000, outputBytes: 1_000, uploadMs: 860,
        storageReadMs: 5, queueMs: 10, executionMs: 20, downloadMs: 5 } });
    const scheduler = createScheduler(registry,
      [localSnapshot([executor("host-cpu")], [executor("cloud-api", "cloud")])], performance);
    const taskGraph = graph(tool.toolId);
    taskGraph.nodes[0].cloudRoutes = [{
      executorId: "cloud-api", inputResidence: "device", accessMode: "inline_transfer",
      transferAuthorized: true, inputBytes: 100_000, outputBytes: 1_000,
      roundTripMs: 10, uploadMbps: 100, downloadMbps: 100,
      storageReadMs: 5, queueMs: 10,
      observedAt: new Date().toISOString(), source: "measured",
    }];

    const plan = await scheduler.plan(taskGraph);
    expect(performance.get(tool.toolId, "cloud-api")?.p95LatencyMs).toBe(900);
    expect(performance.get(tool.toolId, "cloud-api")?.cloudExecutionP95Ms).toBe(20);
    expect(plan.evaluations["task-1"].find((item) => item.executorId === "cloud-api")
      ?.estimatedEndToEndMs).toBeLessThan(100);
    expect(plan.assignments[0].executorId).toBe("cloud-api");
  });

  it("does not train cloud latency on failed attempts", () => {
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    const record = {
      executionId: "failed", taskId: "task-1", toolId: "cloud.tool",
      executorId: "cloud-api", startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(), latencyMs: 10_000,
      latencyScope: "end_to_end" as const, memoryPeakMb: 0,
      fallbackOccurred: false, success: false,
    };
    performance.record(record);
    expect(performance.get("cloud.tool", "cloud-api")?.sampleCount).toBe(0);
    expect(performance.get("cloud.tool", "cloud-api")?.p95LatencyMs).toBeNull();
    performance.record({ ...record, executionId: "success", latencyMs: 100, success: true,
      cloud: { inputBytes: 100, outputBytes: 50, uploadMs: 20,
        storageReadMs: 10, queueMs: 10, executionMs: 50, downloadMs: 10 } });
    expect(performance.get("cloud.tool", "cloud-api")?.p95LatencyMs).toBe(100);
    expect(performance.get("cloud.tool", "cloud-api")?.cloudExecutionP95Ms).toBe(50);
    expect(performance.get("cloud.tool", "cloud-api")?.latencyScope).toBe("end_to_end");
    expect(performance.get("cloud.tool", "cloud-api")?.failureRate).toBe(0.5);
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
