import { RuntimeRunService } from "../../src/core/runtime/runtime-run.service";
import { ExecutionPlan, TaskGraph, TelemetryRecord } from "../../src/core/runtime/runtime.contracts";
import { ResourceAwareSchedulerService } from "../../src/core/runtime/scheduler.service";
import { buildImageSearchTaskGraph } from "../../src/core/runtime/image-search-task-graph";

describe("RuntimeRunService", () => {
  it("keeps the runId and scheduler result together for a planned graph", async () => {
    const plan = executionPlan("ready");
    const scheduler = {
      plan: jest.fn().mockResolvedValue(plan),
    } as unknown as ResourceAwareSchedulerService;
    const service = new RuntimeRunService(scheduler);

    const run = await service.start(graph());

    expect(run.runId).toMatch(/^run_/);
    expect(run.goal).toBe("检索商品");
    expect(run.executionPlan).toBe(plan);
    expect(run.status).toBe("ready");
    expect(service.latest()?.runId).toBe(run.runId);
  });

  it("records telemetry and verification events without fabricating measurements", () => {
    const scheduler = { plan: jest.fn() } as unknown as ResourceAwareSchedulerService;
    const service = new RuntimeRunService(scheduler);
    const run = service.startBlockedGoal("测试", "NO_PLANNER", "没有规划器");
    const telemetry: TelemetryRecord = {
      executionId: "exec-1",
      taskId: "task-1",
      toolId: "image.crop",
      executorId: "host-cpu",
      startedAt: "2026-09-07T00:00:00.000Z",
      finishedAt: "2026-09-07T00:00:01.000Z",
      latencyMs: 1000,
      memoryPeakMb: 24,
      fallbackOccurred: false,
      success: true,
    };

    service.recordTelemetry(run.runId, telemetry);
    service.recordVerification(run.runId, { taskId: "task-1", toolId: "image.crop" }, {
      passed: true,
      reasons: [],
      recommendedActions: [],
    });

    expect(service.get(run.runId)?.telemetry).toEqual([telemetry]);
    expect(service.get(run.runId)?.verifications[0].passed).toBe(true);
  });

  it("can persist a plan already produced by an external Agent Planner", () => {
    const scheduler = { plan: jest.fn() } as unknown as ResourceAwareSchedulerService;
    const service = new RuntimeRunService(scheduler);
    const planned = executionPlan("ready");

    const run = service.createPlanned(graph(), planned);

    expect(scheduler.plan).not.toHaveBeenCalled();
    expect(run.executionPlan).toBe(planned);
    expect(run.status).toBe("ready");
  });

  it("reuses an existing runId when attaching a later task graph", async () => {
    const plan = executionPlan("blocked");
    const scheduler = {
      plan: jest.fn().mockResolvedValue(plan),
    } as unknown as ResourceAwareSchedulerService;
    const service = new RuntimeRunService(scheduler);
    const first = await service.start(graph());

    const attached = await service.attachGraph(first.runId, {
      ...graph(),
      goal: "使用图片 asset_1 完成检索",
    });

    expect(attached.runId).toBe(first.runId);
    expect(attached.goal).toBe("使用图片 asset_1 完成检索");
    expect(scheduler.plan).toHaveBeenCalledTimes(2);
  });

  it("starts a new run when the requested runId is missing", async () => {
    const scheduler = {
      plan: jest.fn().mockResolvedValue(executionPlan("blocked")),
    } as unknown as ResourceAwareSchedulerService;
    const service = new RuntimeRunService(scheduler);

    const run = await service.attachGraph("run_missing", graph());

    expect(run.runId).toMatch(/^run_/);
    expect(run.runId).not.toBe("run_missing");
  });

  it("keeps business operation timing separate from executor telemetry", () => {
    const scheduler = { plan: jest.fn() } as unknown as ResourceAwareSchedulerService;
    const service = new RuntimeRunService(scheduler);
    const run = service.startBlockedGoal("图片搜索", "BLOCKED", "等待资源");

    service.recordOperationTimeline(run.runId, [{
      key: "raw_ann",
      label: "ANN 原始召回",
      startedAtMs: 50,
      endedAtMs: 180,
      durationMs: 130,
      status: "ok",
    }]);

    expect(service.get(run.runId)?.operationTimeline[0].durationMs).toBe(130);
    expect(service.get(run.runId)?.telemetry).toHaveLength(0);
  });
});

describe("buildImageSearchTaskGraph", () => {
  it("keeps the shopping debug graph ordered for scheduler scoring", () => {
    const graph = buildImageSearchTaskGraph("asset_demo");

    expect(graph.graphId).toBe("image-search-asset_demo");
    expect(graph.nodes.map((node) => node.taskId)).toEqual([
      "quality-check",
      "crop",
      "embedding",
      "vector-search",
    ]);
    expect(graph.nodes[2].dependencies).toEqual(["crop"]);
  });
});

function graph(): TaskGraph {
  return {
    graphId: "graph-1",
    goal: "检索商品",
    nodes: [{ taskId: "task-1", toolId: "image.crop", inputRef: "asset-1" }],
  };
}

function executionPlan(status: "ready" | "blocked"): ExecutionPlan {
  return {
    graphId: "graph-1",
    status,
    executionOrder: [],
    parallelGroups: [],
    assignments: [],
    missingRequirements: [],
    evaluations: {},
    generatedAt: "2026-09-07T00:00:00.000Z",
  };
}
