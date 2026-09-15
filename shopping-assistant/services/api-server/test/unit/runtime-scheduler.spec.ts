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

  it("allows ordinary saturated CPU load with warning and serial execution", async () => {
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

    expect(plan.status).toBe("ready");
    expect(plan.evaluations["task-1"][0].forecast?.reasons).toContain("CPU_PRESSURE_WARNING");
    expect(plan.recommendedMaxConcurrency).toBe(1);
  });

  it("does not treat an expired high CPU sample as current pressure", async () => {
    const registry = new ToolRegistryService();
    const tool = toolWithLocalCpu();
    registry.register(tool);
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    performance.record(measurement(tool.toolId, "host-cpu", 10));
    const snapshot = localSnapshot();
    snapshot.state.cpuUtilizationPercent = {
      ...metric(99),
      observedAt: new Date(Date.now() - 60_000).toISOString(),
    };

    const plan = await createScheduler(registry, [snapshot], performance).plan(graph(tool.toolId));
    const reasons = plan.evaluations["task-1"][0].reasons;

    expect(reasons).not.toContain("LOCAL_CPU_PRESSURE");
    expect(plan.status).toBe("ready");
    expect(plan.evaluations["task-1"][0].forecast?.unknownMetrics).toContain("cpuUtilizationPercent");
  });

  it("ignores an expired thermal-throttle flag instead of reporting a current throttle", async () => {
    const registry = new ToolRegistryService();
    const tool = toolWithLocalCpu();
    registry.register(tool);
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    performance.record(measurement(tool.toolId, "host-cpu", 10));
    const snapshot = localSnapshot();
    snapshot.state.thermalThrottle = {
      value: true,
      available: true,
      source: "expired-test",
      observedAt: new Date(Date.now() - 60_000).toISOString(),
    };

    const plan = await createScheduler(registry, [snapshot], performance).plan(graph(tool.toolId));
    const reasons = plan.evaluations["task-1"][0].reasons;

    expect(reasons).not.toContain("LOCAL_THERMAL_THROTTLING");
    expect(plan.status).toBe("ready");
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

  it("rejects a graph whose measured critical path exceeds its business deadline", async () => {
    const registry = new ToolRegistryService();
    registry.register(toolWithLocalCpu());
    const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
    performance.record(measurement("local.cpu", "host-cpu", 80));
    const taskGraph = graph("local.cpu");
    taskGraph.demand = { operation: "text_search", realtime: "interactive", complexity: "simple", deadlineMs: 50,
      priority: "interactive", source: "explicit_operation", reasons: [], plannerVersion: "test", trainedModel: false };
    const plan = await createScheduler(registry, [localSnapshot()], performance).plan(taskGraph);
    expect(plan.status).toBe("blocked");
    expect(plan.missingRequirements.map(item => item.code)).toContain("GRAPH_DEADLINE_EXCEEDED");
    expect(plan.estimatedCriticalPathMs).toBe(80);
  });

  it("selects a measured light model only when degradation is allowed", async () => {
    const registry = new ToolRegistryService();
    const tool = { ...toolWithLocalCpu(), toolId: "text.classify", constraints: {
      ...toolWithLocalCpu().constraints, maxLatencyMs: 40 }, resourceHints: {
      ...toolWithLocalCpu().resourceHints, modelId: "full", modelVariants: [{ modelId: "light", tier: "light" as const, estimatedMemoryMb: 1 }],
    } } satisfies ToolDescriptor;
    registry.register(tool);
    const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
    performance.record({ ...measurement(tool.toolId, "host-cpu", 80), modelId: "full" });
    performance.record({ ...measurement(tool.toolId, "host-cpu", 20), modelId: "light" });
    const scheduler = createScheduler(registry, [localSnapshot()], performance);
    const request = graph(tool.toolId);
    expect((await scheduler.plan(request)).status).toBe("blocked");
    request.nodes[0].constraints = { allowDegrade: true };
    const result = await scheduler.plan(request);
    expect(result.status).toBe("ready");
    expect(result.assignments[0]).toMatchObject({ modelId: "light", modelTier: "light" });
  });

  it("prefers a permitted light variant under warning but never relaxes quality", async () => {
    const registry = new ToolRegistryService();
    const tool = { ...toolWithLocalCpu(), resourceHints: { ...toolWithLocalCpu().resourceHints,
      modelId: "full", modelVariants: [{ modelId: "light", tier: "light" as const, estimatedMemoryMb: 1 }] } };
    registry.register(tool);
    const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
    performance.record({ ...measurement(tool.toolId, "host-cpu", 20), executionId: "full-warning", modelId: "full", quality: 1 });
    performance.record({ ...measurement(tool.toolId, "host-cpu", 20), executionId: "light-warning", modelId: "light", quality: 0.99 });
    const snapshot = localSnapshot();
    snapshot.state.cpuUtilizationPercent = metric(96);
    const scheduler = createScheduler(registry, [snapshot], performance);
    const input = graph(tool.toolId);
    expect((await scheduler.plan(input)).assignments[0].modelId).toBe("full");
    input.nodes[0].constraints = { allowDegrade: true };
    const lightPlan = await scheduler.plan(input);
    expect(lightPlan.assignments[0].modelId).toBe("light");
    expect(lightPlan.assignments[0].reasons).toContain("WARNING_LIGHT_SCORE_FACTOR_0.95");
    input.nodes[0].constraints.minimumQuality = 1;
    expect((await scheduler.plan(input)).assignments[0].modelId).toBe("full");
  });

  it.each([100, 300])("tries serialization for combined memory pressure, then checks deadline %i", async deadlineMs => {
    const registry = new ToolRegistryService();
    const tool = { ...toolWithLocalCpu(), resourceHints: { computeClass: "general_cpu" as const, estimatedMemoryMb: 400 } };
    registry.register(tool);
    const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
    performance.record(measurement(tool.toolId, "host-cpu", 80));
    const snapshot = localSnapshot();
    snapshot.state.freeMemoryMb = metric(700);
    const input = graph(tool.toolId);
    input.nodes.push({ taskId: "task-2", toolId: tool.toolId, inputRef: "second" });
    input.demand = { operation: "batch", realtime: "deferred", complexity: "simple", deadlineMs, priority: "normal",
      source: "explicit_operation", reasons: [], plannerVersion: "test", trainedModel: false };
    const plan = await createScheduler(registry, [snapshot], performance).plan(input);
    expect(plan.parallelGroups).toEqual([["task-1"], ["task-2"]]);
    expect(plan.estimatedCriticalPathMs).toBe(160);
    expect(plan.status).toBe(deadlineMs < 160 ? "blocked" : "ready");
    expect(plan.assignments.every(item => item.forecast?.risk !== "critical")).toBe(true);
  });

  it("requires fresh network evidence to consider a cloud candidate", async () => {
    const registry = new ToolRegistryService();
    const tool = { ...toolWithLocalCpu(), constraints: { ...toolWithLocalCpu().constraints,
      locality: "auto" as const, allowCloud: true } } satisfies ToolDescriptor;
    registry.register(tool);
    const cloud = { ...executor("cloud-api", "cloud"), totalMemoryMb: 1024 };
    const snapshot = localSnapshot([], [cloud]);
    const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
    performance.record(measurement(tool.toolId, "cloud-api", 20));
    const scheduler = createScheduler(registry, [snapshot], performance);
    const blocked = await scheduler.plan(graph(tool.toolId));
    expect(blocked.evaluations["task-1"][0].reasons).toContain("CLOUD_NETWORK_METRIC_UNAVAILABLE");
    snapshot.state.networkLatencyMs = metric(10);
    const ready = await scheduler.plan(graph(tool.toolId));
    expect(ready.status).toBe("ready");
    expect(ready.assignments[0].placement).toBe("cloud");
    expect(ready.estimatedCriticalPathMs).toBe(30);
  });

  it("honors a soft local preference when measured performance is nearly equal", async () => {
    const registry = new ToolRegistryService();
    const tool = { ...toolWithLocalCpu(), constraints: {
      ...toolWithLocalCpu().constraints,
      locality: "local_preferred" as const,
      allowCloud: true,
    } } satisfies ToolDescriptor;
    registry.register(tool);
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    performance.record(measurement(tool.toolId, "host-cpu", 11));
    performance.record(measurement(tool.toolId, "cloud-api", 10));
    const cloud = { ...executor("cloud-api", "cloud"), totalMemoryMb: 1000 };
    const snapshot = localSnapshot([executor("host-cpu")], [cloud]);
    snapshot.state.networkLatencyMs = metric(0);

    const plan = await createScheduler(registry, [snapshot], performance).plan(graph(tool.toolId));

    expect(plan.status).toBe("ready");
    expect(plan.assignments[0].executorId).toBe("host-cpu");
    expect(plan.assignments[0].reasons.join(" ")).toContain("本地软偏好");
  });

  it("serializes memory-pressure tasks before considering combined allocation", async () => {
    const registry = new ToolRegistryService();
    registry.register({ ...toolWithLocalCpu(), resourceHints: { computeClass: "general_cpu", estimatedMemoryMb: 100 } });
    const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
    performance.record(measurement("local.cpu", "host-cpu", 20));
    const snapshot = localSnapshot();
    snapshot.state.freeMemoryMb = metric(250);
    const taskGraph = graph("local.cpu");
    taskGraph.nodes.push({ taskId: "task-2", toolId: "local.cpu", inputRef: "input-2" });
    const plan = await createScheduler(registry, [snapshot], performance).plan(taskGraph);
    expect(plan.status).toBe("ready");
    expect(plan.parallelGroups).toEqual([["task-1"], ["task-2"]]);
    expect(plan.recommendedMaxConcurrency).toBe(1);
  });

  it("rejects invalid caller constraints instead of treating unknown locality as auto", async () => {
    const registry = new ToolRegistryService();
    registry.register(toolWithLocalCpu());
    const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
    performance.record(measurement("local.cpu", "host-cpu", 20));
    const taskGraph = graph("local.cpu");
    taskGraph.nodes[0].constraints = { locality: "somewhere" as any };
    const plan = await createScheduler(registry, [localSnapshot()], performance).plan(taskGraph);
    expect(plan.status).toBe("blocked");
    expect(plan.missingRequirements.map(item => item.code)).toContain("TASK_CONSTRAINT_INVALID");
  });

  it("keeps scoring finite when zero-weight quality and energy metrics are absent", async () => {
    const registry = new ToolRegistryService();
    const tool = { ...toolWithLocalCpu(), defaultWeights: {
      latency: 0.5, quality: 0, energy: 0, reliability: 0.5,
    } } satisfies ToolDescriptor;
    registry.register(tool);
    const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
    const sample = measurement(tool.toolId, "host-cpu", 20);
    delete (sample as any).energyMah;
    delete (sample as any).quality;
    performance.record(sample);
    const plan = await createScheduler(registry, [localSnapshot()], performance).plan(graph(tool.toolId));
    expect(plan.status).toBe("ready");
    expect(Number.isFinite(plan.assignments[0].score.totalScore)).toBe(true);
    expect(plan.assignments[0].score).toMatchObject({ qualityScore: 1, energyScore: 1 });
  });

  it("blocks duplicate executor IDs across platforms", async () => {
    const registry = new ToolRegistryService();
    registry.register(toolWithLocalCpu());
    const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
    performance.record(measurement("local.cpu", "shared-cpu", 20));
    const first = localSnapshot([executor("shared-cpu")]);
    const second = localSnapshot([executor("shared-cpu")]);
    second.profile.platformId = "cix_p1";
    second.state.platformId = "cix_p1";
    const plan = await createScheduler(registry, [first, second], performance).plan(graph("local.cpu"));
    expect(plan.status).toBe("blocked");
    expect(plan.assignments).toHaveLength(0);
    expect(plan.missingRequirements.map(item => item.code)).toContain("EXECUTOR_ID_AMBIGUOUS");
  });

  it("requires latency evidence whenever the graph declares an end-to-end deadline", async () => {
    const registry = new ToolRegistryService();
    const tool = { ...toolWithLocalCpu(), defaultWeights: {
      latency: 0, quality: 0, energy: 0, reliability: 1,
    } } satisfies ToolDescriptor;
    registry.register(tool);
    const performance = {
      getMinimumSamples: () => 1,
      get: () => ({
        toolId: tool.toolId, executorId: "host-cpu", sampleCount: 3,
        p50LatencyMs: null, p95LatencyMs: null, memoryPeakMb: 10,
        energyMah: null, quality: null, failureRate: 0, noFallbackRate: 1,
        measuredAt: new Date().toISOString(), source: "test",
      }),
    } as unknown as PerformanceRegistryService;
    const taskGraph = graph(tool.toolId);
    taskGraph.demand = { operation: "text_search", realtime: "interactive", complexity: "simple",
      deadlineMs: 1000, priority: "interactive", source: "explicit_operation",
      reasons: [], plannerVersion: "test", trainedModel: false };
    const plan = await createScheduler(registry, [localSnapshot()], performance).plan(taskGraph);
    expect(plan.status).toBe("blocked");
    expect(plan.evaluations["task-1"][0].reasons).toContain("P95_LATENCY_METRIC_MISSING");
  });

  it("blocks an invalid business-demand declaration passed through the public scheduler API", async () => {
    const registry = new ToolRegistryService();
    const tool = toolWithLocalCpu();
    registry.register(tool);
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    performance.record(measurement(tool.toolId, "host-cpu", 10));
    const taskGraph = graph(tool.toolId);
    taskGraph.demand = {
      operation: "text_search",
      realtime: "interactive",
      complexity: "simple",
      deadlineMs: -1,
      priority: "interactive",
      source: "explicit_operation",
      reasons: [],
      plannerVersion: "test",
      trainedModel: false,
    };

    const plan = await createScheduler(registry, [localSnapshot()], performance).plan(taskGraph);

    expect(plan.status).toBe("blocked");
    expect(plan.missingRequirements.map(item => item.code)).toContain("TASK_DEMAND_INVALID");
  });

  it("accepts a valid non-shopping operation from an external planner", async () => {
    const registry = new ToolRegistryService();
    const tool = toolWithLocalCpu();
    registry.register(tool);
    const performance = new PerformanceRegistryService(
      new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }),
    );
    performance.record(measurement(tool.toolId, "host-cpu", 10));
    const taskGraph = graph(tool.toolId);
    taskGraph.demand = {
      operation: "document_indexing",
      realtime: "deferred",
      complexity: "complex",
      deadlineMs: 1000,
      priority: "background",
      source: "external_planner",
      reasons: ["custom domain"],
      plannerVersion: "custom-v1",
      trainedModel: false,
    };

    const plan = await createScheduler(registry, [localSnapshot()], performance).plan(taskGraph);

    expect(plan.status).toBe("ready");
    expect(plan.missingRequirements.map(item => item.code)).not.toContain("TASK_DEMAND_INVALID");
  });
});

function measurement(toolId: string, executorId: string, latencyMs: number) {
  return { executionId: `${toolId}-${executorId}-${latencyMs}`, taskId: "task-1", toolId, executorId,
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), latencyMs,
    memoryPeakMb: 10, energyMah: 1, quality: 1, fallbackOccurred: false, success: true };
}

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
    observedAt: new Date().toISOString(),
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
    observedAt: new Date().toISOString(),
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
    observedAt: new Date().toISOString(),
  };
}

function unavailable(source: string) {
  return {
    value: null,
    available: false,
    source,
    reason: "missing",
    observedAt: new Date().toISOString(),
  };
}
