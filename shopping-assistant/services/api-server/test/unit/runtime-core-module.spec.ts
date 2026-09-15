import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { LocalTaskPlannerService, LOCAL_TASK_DECISION_PROVIDER } from "../../src/core/runtime/local-task-planner.service";
import { AGENT_PLANNER, AgentPlanner } from "../../src/core/runtime/agent-runtime.service";
import { ToolRegistryService } from "../../src/core/runtime/tool-registry.service";
import { RuntimeCoreModule } from "../../src/modules/runtime/runtime-core.module";
import { shoppingTaskTemplates } from "../../src/core/runtime/shopping-task-templates";
import { PlatformDiscoveryService, RUNTIME_PLATFORM_ADAPTERS } from "../../src/core/runtime/platform-discovery.service";

it("lets another Nest app import the scheduler without shopping tools and supply its own local model", async () => {
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => ({ runtime: {} })] }),
    RuntimeCoreModule.register({ operations: shoppingTaskTemplates, decisionProvider: {
      provide: LOCAL_TASK_DECISION_PROVIDER,
      useValue: { decide: async () => ({ operation: "text_search", confidence: 0.99,
        realtime: "interactive", complexity: "simple", priority: "interactive", privacy: "sensitive", reasons: [],
        providerId: "external-local", trainedModel: true }) },
    } }),
  ] }).compile();
  try {
    await module.init();
    expect(module.get(ToolRegistryService).list()).toEqual([]);
    const graph = await module.get(LocalTaskPlannerService).planGoal({ goal: "寻找商品" });
    expect(graph.demand).toMatchObject({ source: "local_provider", plannerVersion: "external-local" });
  } finally {
    await module.close();
  }
});

it("accepts a non-shopping operation registry and an app-owned platform adapter list", async () => {
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RuntimeCoreModule.register({
      operations: [{ operation: "document_indexing", realtime: "deferred", complexity: "complex", privacy: "high",
        match: goal => goal === "index", build: () => [{ taskId: "index", toolId: "document.index", inputRef: "goal" }] }],
      platformAdapters: { provide: RUNTIME_PLATFORM_ADAPTERS, useValue: [] },
    }),
  ] }).compile();
  try {
    await module.init();
    const graph = await module.get(LocalTaskPlannerService).planGoal({ goal: "index" });
    expect(graph.demand?.operation).toBe("document_indexing");
    expect(graph.nodes[0].toolId).toBe("document.index");
    expect(await module.get(PlatformDiscoveryService).discover()).toEqual([]);
    expect(module.get(ToolRegistryService).list()).toEqual([]);
  } finally { await module.close(); }
});

it("allows another domain to replace the shopping planner without changing the scheduler", async () => {
  const customPlanner: AgentPlanner = {
    planGoal: async ({ goal }) => ({
      graphId: "custom-graph",
      goal,
      demand: {
        operation: "document_indexing",
        realtime: "deferred",
        complexity: "complex",
        deadlineMs: 60000,
        priority: "background",
        source: "external_planner",
        reasons: ["custom domain"],
        plannerVersion: "custom-v1",
        trainedModel: false,
      },
      nodes: [{ taskId: "index", toolId: "document.index", inputRef: "goal" }],
    }),
  };
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => ({ runtime: {} })] }),
    RuntimeCoreModule.register({ planner: { provide: AGENT_PLANNER, useValue: customPlanner } }),
  ] }).compile();
  try {
    await module.init();
    const graph = await module.get<AgentPlanner>(AGENT_PLANNER).planGoal({ goal: "index docs" });
    expect(graph.demand).toMatchObject({ operation: "document_indexing", source: "external_planner" });
  } finally {
    await module.close();
  }
});
