import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { RuntimeModule } from "../../src/modules/runtime/runtime.module";
import { RuntimeEventBusService } from "../../src/core/runtime/runtime-event-bus.service";
import { RuntimeRunService } from "../../src/core/runtime/runtime-run.service";
import { PerformanceRegistryService } from "../../src/core/runtime/performance-registry.service";
import { ExecutionPlan, TaskGraph } from "../../src/core/runtime/runtime.contracts";

describe("runtime API integration", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => ({ runtime: {
        minimumPerformanceSamples: 1,
        platformHeartbeatToken: "test-agent-token",
      } })] }),
      RuntimeModule,
    ] }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it("authenticates terminal protection and rejects unbound or malformed events", async () => {
    const event = { runId: "unbound", executionId: "none", executorId: "host-cpu",
      workerStopped: true, reason: "TERMINAL_THERMAL_REDLINE", observedAt: new Date().toISOString() };
    await request(app.getHttpServer()).post("/api/v1/runtime/protection").send(event).expect(401);
    await request(app.getHttpServer()).post("/api/v1/runtime/protection").set("x-runtime-agent-token", "test-agent-token")
      .send({ ...event, workerStopped: false }).expect(400);
    await request(app.getHttpServer()).post("/api/v1/runtime/protection").set("x-runtime-agent-token", "test-agent-token")
      .send(event).expect(409);
  });

  it("returns an honest local plan with business demand and missing real model evidence", async () => {
    const response = await request(app.getHttpServer()).post("/api/v1/runtime/agent/plan")
      .send({ goal: "搜索鞋子", context: { deadlineMs: 1000, realtime: "interactive" } }).expect(201);
    expect(response.body.data.taskGraph.demand).toMatchObject({ operation: "text_search", trainedModel: false, deadlineMs: 1000 });
    expect(response.body.data.status).toBe("blocked");
    expect(response.body.data.executionPlan.missingRequirements.length).toBeGreaterThan(0);
    expect(app.get(RuntimeEventBusService).replay()).toContainEqual(
      expect.objectContaining({ type: "task_graph_received", runId: response.body.data.runId }),
    );
  });

  it("blocks ambiguous goals instead of routing them to an unconfigured model", async () => {
    const response = await request(app.getHttpServer()).post("/api/v1/runtime/agent/plan")
      .send({ goal: "你看着办" }).expect(201);
    expect(response.body.data.status).toBe("blocked");
    expect(response.body.data.missingRequirements[0].code).toBe("LOCAL_INTENT_UNSUPPORTED");
    expect(app.get(RuntimeEventBusService).replay()).toContainEqual(
      expect.objectContaining({ type: "plan_blocked", runId: response.body.data.runId }),
    );
  });

  it("rejects replan for a running run before recording telemetry or emitting a request", async () => {
    const runs = app.get(RuntimeRunService);
    const events = app.get(RuntimeEventBusService);
    const performance = app.get(PerformanceRegistryService);
    const taskGraph: TaskGraph = {
      graphId: "locked-graph",
      goal: "locked",
      nodes: [{ taskId: "task", toolId: "image.crop", inputRef: "asset" }],
    };
    const executionPlan: ExecutionPlan = {
      graphId: taskGraph.graphId,
      status: "ready",
      executionOrder: ["task"],
      parallelGroups: [["task"]],
      assignments: [],
      missingRequirements: [],
      evaluations: {},
      generatedAt: new Date().toISOString(),
    };
    const run = runs.createPlanned(taskGraph, executionPlan);
    runs.setExecutionState(run.runId, "running");
    const eventCount = events.replay().length;
    const performanceCount = performance.list().length;

    await request(app.getHttpServer()).post("/api/v1/runtime/replan")
      .set("x-runtime-agent-token", "test-agent-token").send({
      runId: run.runId,
      taskGraph,
      reason: "should-not-run",
      telemetry: [{
        executionId: "locked-execution",
        taskId: "task",
        toolId: "image.crop",
        executorId: "host-cpu",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        latencyMs: 1,
        memoryPeakMb: 1,
        fallbackOccurred: false,
        success: true,
      }],
    }).expect(409);

    expect(events.replay()).toHaveLength(eventCount);
    expect(performance.list()).toHaveLength(performanceCount);
    expect(runs.get(run.runId)?.telemetry).toHaveLength(0);
    expect(runs.get(run.runId)?.replanEvents).toHaveLength(0);
  });

  it("validates telemetry before storage and keeps repeated execution IDs idempotent", async () => {
    const runs = app.get(RuntimeRunService);
    const run = runs.startBlockedGoal("telemetry", "WAITING", "waiting");
    const timestamp = new Date().toISOString();
    const payload = {
      runId: run.runId,
      executionId: "idempotent-execution",
      taskId: "task",
      toolId: "image.crop",
      executorId: "host-cpu",
      startedAt: timestamp,
      finishedAt: timestamp,
      latencyMs: 5,
      memoryPeakMb: 2,
      quality: 0.8,
      fallbackOccurred: false,
      success: true,
    };

    await request(app.getHttpServer()).post("/api/v1/runtime/telemetry")
      .send(payload).expect(401);
    await request(app.getHttpServer()).post("/api/v1/runtime/telemetry")
      .set("x-runtime-agent-token", "test-agent-token")
      .send({ ...payload, quality: 2 }).expect(400);
    expect(runs.get(run.runId)?.telemetry).toHaveLength(0);

    const first = await request(app.getHttpServer()).post("/api/v1/runtime/telemetry")
      .set("x-runtime-agent-token", "test-agent-token")
      .send(payload).expect(201);
    const repeated = await request(app.getHttpServer()).post("/api/v1/runtime/telemetry")
      .set("x-runtime-agent-token", "test-agent-token")
      .send(payload).expect(201);

    expect(first.body.data.sample.sampleCount).toBe(1);
    expect(repeated.body.data.sample.sampleCount).toBe(1);
    expect(runs.get(run.runId)?.telemetry).toHaveLength(1);
    await request(app.getHttpServer()).post("/api/v1/runtime/telemetry")
      .set("x-runtime-agent-token", "test-agent-token")
      .send({ ...payload, latencyMs: 6 }).expect(409);
  });
});
