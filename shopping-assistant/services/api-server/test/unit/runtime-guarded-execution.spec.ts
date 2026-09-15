import { ConfigService } from "@nestjs/config";
import { GuardedExecutionService, GuardedToolHandler } from "../../src/core/runtime/guarded-execution.service";
import { PerformanceRegistryService } from "../../src/core/runtime/performance-registry.service";
import { PlatformDiscoveryService } from "../../src/core/runtime/platform-discovery.service";
import { ResourcePredictorService } from "../../src/core/runtime/resource-predictor.service";
import { RuntimeEventBusService } from "../../src/core/runtime/runtime-event-bus.service";
import { RuntimeRunService } from "../../src/core/runtime/runtime-run.service";
import { ResourceAwareSchedulerService } from "../../src/core/runtime/scheduler.service";
import { TelemetryService } from "../../src/core/runtime/telemetry.service";
import { ToolRegistryService } from "../../src/core/runtime/tool-registry.service";
import { ExecutionPlan, TaskGraph } from "../../src/core/runtime/runtime.contracts";

function setup(options: { minimumQuality?: number; energyBudgetMah?: number } = {}) {
  const graph: TaskGraph = { graphId: "guard-test", goal: "run", nodes: [
    { taskId: "task", toolId: "work", inputRef: "goal",
      constraints: options.energyBudgetMah === undefined ? undefined : { energyBudgetMah: options.energyBudgetMah },
      checkpointPolicy: { enabled: true, stopOnResourcePressure: true } },
  ] };
  const assignment: ExecutionPlan["assignments"][number] = {
    taskId: "task", toolId: "work", executorId: "cpu", placement: "local", backend: "cpu",
    score: { latencyScore: 1, qualityScore: 1, energyScore: 1, reliabilityScore: 1, totalScore: 1 },
    weights: { latency: 0.4, quality: 0.3, energy: 0.1, reliability: 0.2 },
    reasons: [], plannedAt: new Date().toISOString(), status: "planned", estimatedMemoryMb: 10, estimatedLatencyMs: 1000,
  };
  const plan: ExecutionPlan = { graphId: graph.graphId, status: "ready", executionOrder: ["task"], parallelGroups: [["task"]],
    assignments: [assignment], missingRequirements: [], evaluations: {}, generatedAt: new Date().toISOString() };
  const scheduler = { plan: jest.fn().mockResolvedValue(plan) } as unknown as ResourceAwareSchedulerService;
  const events = new RuntimeEventBusService();
  const runs = new RuntimeRunService(scheduler, events);
  const run = runs.createPlanned(graph, plan);
  const tools = new ToolRegistryService();
  tools.register({ toolId: "work", version: "1", description: "work", inputType: "Text", outputType: "Text",
    preconditions: [], postconditions: [], quality: options.minimumQuality === undefined ? {} : { minimumScore: options.minimumQuality },
    constraints: { privacy: "internal", locality: "local_only", allowLocal: true, allowCloud: false },
    resourceHints: { computeClass: "general_cpu", estimatedMemoryMb: 10 },
    execution: { supportsPause: false, supportsRetry: false, maxAttempts: 1, compensationActions: [] },
    defaultWeights: { latency: 0.4, quality: 0.3, energy: 0.1, reliability: 0.2 } });
  const now = () => new Date().toISOString();
  let disconnected = false;
  const snapshot = () => ({
    state: { platformId: "host", observedAt: now(), freeMemoryMb: metric(4096), cpuUtilizationPercent: metric(20),
      temperatureCelsius: metric(40), batteryPercent: metric(80) },
    executors: [{ executorId: "cpu", available: !disconnected }],
  });
  const platforms = { discover: jest.fn().mockImplementation(async () => [snapshot()]) } as unknown as PlatformDiscoveryService;
  const predictor = new ResourcePredictorService(new ConfigService());
  const performance = new PerformanceRegistryService(new ConfigService({ runtime: { minimumPerformanceSamples: 1 } }));
  const telemetry = new TelemetryService(performance);
  const guard = new GuardedExecutionService(runs, platforms, predictor, tools, telemetry, events);
  return { guard, runs, graph, runId: run.runId, events, performance, disconnect: () => { disconnected = true; } };
}

function metric(value: number) {
  return { value, available: true, source: "test", observedAt: new Date().toISOString() };
}

describe("guarded execution", () => {
  it("waits for a cooperative task to settle before restoring its checkpoint", async () => {
    const { guard, runs, runId, events } = setup();
    let value = 0;
    let settle!: () => void;
    let started!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { settle = resolve; });
    const handler: GuardedToolHandler = {
      toolId: "work", executorId: "cpu", supportsAbort: true,
      capture: async () => value,
      execute: async ({ signal }) => { value = 1; started(); await held; expect(signal.aborted).toBe(true); return { output: "late", memoryPeakMb: 10 }; },
      restore: async checkpoint => { value = checkpoint as number; },
    };
    guard.register(handler);
    const result = guard.execute(runId);
    await running;
    expect(guard.cancel(runId)?.status).toBe("stopping");
    expect(value).toBe(1);
    settle();
    const final = await result;
    expect(value).toBe(0);
    expect(final.status).toBe("rolled_back");
    expect(final.outputs).toBeUndefined();
    expect(final.protection?.rollback).toBe("succeeded");
    expect(events.replay().map(item => item.type)).toContain("checkpoint_restored");
    expect(runs.get(runId)?.status).toBe("rolled_back");
  });

  it("keeps rollback failure visible instead of claiming recovery", async () => {
    const { guard, runId } = setup();
    guard.register({ toolId: "work", executorId: "cpu", supportsAbort: true,
      capture: async () => 0,
      execute: async () => { throw new Error("work failed"); },
      restore: async () => { throw new Error("restore failed"); } });
    const final = await guard.execute(runId);
    expect(final.status).toBe("rollback_failed");
    expect(final.protection?.rollback).toBe("failed");
    expect(final.protection?.advice.join(" ")).toContain("回退未成功");
  });

  it("refuses execution without a bound handler", async () => {
    const { guard, runId } = setup();
    await expect(guard.execute(runId)).rejects.toThrow("GUARDED_EXECUTOR_NOT_BOUND");
  });

  it("records a verification failure as failed telemetry before rollback", async () => {
    const { guard, runs, runId, performance } = setup({ minimumQuality: 0.9 });
    let value = 0;
    guard.register({
      toolId: "work", executorId: "cpu", supportsAbort: true,
      capture: async () => value,
      execute: async () => { value = 1; return { output: "low-quality", memoryPeakMb: 10, quality: 0.2 }; },
      restore: async checkpoint => { value = checkpoint as number; },
    });

    const final = await guard.execute(runId);

    expect(final.status).toBe("rolled_back");
    expect(value).toBe(0);
    expect(final.outputs).toBeUndefined();
    expect(runs.get(runId)?.verifications[0]).toMatchObject({
      passed: false,
      reasons: ["QUALITY_REQUIREMENT_NOT_MET"],
    });
    expect(runs.get(runId)?.telemetry[0]).toMatchObject({
      success: false,
      errorCode: "RESULT_VERIFICATION_FAILED",
      quality: 0.2,
    });
    expect(performance.get("work", "cpu")?.failureRate).toBe(1);
  });

  it("enforces a task-specific energy budget on the measured result", async () => {
    const { guard, runs, runId } = setup({ energyBudgetMah: 1 });
    guard.register({
      toolId: "work", executorId: "cpu", supportsAbort: true,
      capture: async () => "checkpoint",
      execute: async () => ({ output: "too-expensive", memoryPeakMb: 10, energyMah: 2 }),
      restore: async () => undefined,
    });

    const final = await guard.execute(runId);

    expect(final.status).toBe("rolled_back");
    expect(runs.get(runId)?.verifications[0].reasons).toContain("ENERGY_BUDGET_EXCEEDED");
    expect(runs.get(runId)?.telemetry[0].success).toBe(false);
  });
});

describe("terminal protection and checkpoint correlation", () => {
  it("accepts only a fresh event matching the currently bound execution", async () => {
    const { guard, runs, runId } = setup();
    guard.register({ toolId: "work", executorId: "cpu", supportsAbort: true,
      capture: async () => 0, restore: async () => undefined,
      execute: async input => {
        const event = { runId, executorId: "cpu", executionId: input.executionId, workerStopped: true as const,
          reason: "TERMINAL_THERMAL_REDLINE" as const, observedAt: new Date().toISOString() };
        expect(() => guard.reportTerminalProtection({ ...event, executionId: "another-stage" })).toThrow("MISMATCH");
        expect(() => guard.reportTerminalProtection({ ...event, observedAt: "2020-01-01T00:00:00Z" })).toThrow("INVALID");
        expect(input.signal.aborted).toBe(false);
        expect(guard.reportTerminalProtection(event)).toMatchObject({ accepted: true });
        expect(input.signal.aborted).toBe(true);
        return { output: "not committed", memoryPeakMb: 10 };
      } });
    const final = await guard.execute(runId);
    expect(final.status).toBe("rolled_back");
    expect(final.outputs).toBeUndefined();
    expect(runs.get(runId)?.checkpoints).toEqual([expect.objectContaining({ status: "restored", checkpointId: expect.any(String), executionId: expect.any(String) })]);
  });

  it("detects a deadline overrun before a short stage can commit", async () => {
    const { guard, graph, runId } = setup();
    graph.nodes[0].constraints = { deadlineMs: 2000 };
    let now = Date.now();
    const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
    try {
      guard.register({ toolId: "work", executorId: "cpu", supportsAbort: true,
        capture: async () => 0, restore: async () => undefined,
        execute: async () => { now += 3000; return { output: "late", memoryPeakMb: 10 }; } });
      const final = await guard.execute(runId);
      expect(final.status).toBe("rolled_back");
      expect(final.protection?.reason).toBe("RUNTIME_DEADLINE_EXCEEDED");
      expect(final.outputs).toBeUndefined();
    } finally { clock.mockRestore(); }
  });

  it("correlates committed measurements with the captured checkpoint", async () => {
    const { guard, runId } = setup();
    guard.register({ toolId: "work", executorId: "cpu", supportsAbort: true,
      capture: async () => 0, restore: async () => undefined,
      execute: async () => ({ output: "done", memoryPeakMb: 10, quality: 1 }) });
    const final = await guard.execute(runId);
    expect(final.status).toBe("completed");
    expect(final.telemetry[0].executionId).toBe(final.checkpoints?.[0].executionId);
    expect(final.telemetry[0].metadata?.checkpointId).toBe(final.checkpoints?.[0].checkpointId);
    expect(final.checkpoints?.[0].status).toBe("committed");
  });
});
