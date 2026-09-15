import { LocalTaskDecision, LocalTaskDecisionProvider, LocalTaskPlannerService, LocalTaskTemplate } from "../../src/core/runtime/local-task-planner.service";
import { shoppingTaskTemplates } from "../../src/core/runtime/shopping-task-templates";

const decisionBase = { realtime: "interactive", complexity: "simple", priority: "interactive", privacy: "sensitive", reasons: [] } as const;
function shoppingPlanner(provider?: { decide: () => Promise<Partial<LocalTaskDecision>> }) {
  const adapted: LocalTaskDecisionProvider | undefined = provider ? { decide: async () => ({ ...decisionBase, ...await provider.decide() } as LocalTaskDecision) } : undefined;
  return new LocalTaskPlannerService(adapted, undefined, shoppingTaskTemplates);
}

describe("local task planner", () => {
  it("uses explicit business operation and keeps realtime separate from workflow complexity", async () => {
    const planner = shoppingPlanner();
    const graph = await planner.planGoal({ goal: "比较这两款产品", context: {
      operation: "product_compare", realtime: "interactive", deadlineMs: 2500, privacy: "high",
      locality: "local_only", minimumQuality: 0.85, energyBudgetMah: 5,
    } });
    expect(graph.demand).toMatchObject({ complexity: "complex", realtime: "interactive", deadlineMs: 2500, trainedModel: false });
    expect(graph.nodes.map(node => node.toolId)).toEqual(["text.embedding", "catalog.vector_search", "answer.generate"]);
    expect(graph.nodes.every(node => node.constraints?.privacy === "high")).toBe(true);
    expect(graph.nodes.every(node => node.constraints?.locality === "local_only")).toBe(true);
    expect(graph.nodes.every(node => node.constraints?.minimumQuality === 0.85)).toBe(true);
    expect(graph.nodes.every(node => node.constraints?.energyBudgetMah === 5)).toBe(true);
  });

  it("blocks ambiguous goals instead of inventing a task graph", async () => {
    await expect(shoppingPlanner().planGoal({ goal: "帮我处理一下" })).rejects.toMatchObject({ code: "LOCAL_INTENT_UNSUPPORTED" });
  });

  it("requires local image input for image search", async () => {
    await expect(shoppingPlanner().planGoal({ goal: "以图搜商品" })).rejects.toMatchObject({ code: "IMAGE_ASSET_REQUIRED" });
  });

  it("accepts a confident host-supplied local decision provider", async () => {
    const planner = shoppingPlanner({ decide: async () => ({
      operation: "text_search", realtime: "deferred", confidence: 0.94,
      complexity: "complex", providerId: "host-local-v1", trainedModel: true,
    }) });
    const graph = await planner.planGoal({ goal: "我想找一双适合跑步的鞋" });
    expect(graph.demand).toMatchObject({
      source: "local_provider", realtime: "deferred", complexity: "complex",
      trainedModel: true, decisionConfidence: 0.94,
    });
  });

  it("falls back to rules on low-confidence provider output", async () => {
    const planner = shoppingPlanner({ decide: async () => ({
      operation: "product_compare", confidence: 0.2, providerId: "bad", trainedModel: true,
    }) });
    const graph = await planner.planGoal({ goal: "搜索鞋子" });
    expect(graph.demand).toMatchObject({ operation: "text_search", source: "local_template_rules", trainedModel: false });
  });

  it("rejects an out-of-range provider confidence and uses the rule baseline", async () => {
    const planner = shoppingPlanner({ decide: async () => ({
      operation: "product_compare", confidence: 2, providerId: "invalid", trainedModel: true,
    }) });
    const graph = await planner.planGoal({ goal: "搜索鞋子" });
    expect(graph.demand).toMatchObject({ operation: "text_search", source: "local_template_rules" });
  });

  it("falls back when an otherwise confident provider returns an invalid semantic field", async () => {
    const planner = shoppingPlanner({ decide: async () => ({
      operation: "product_compare", realtime: "instant" as any, confidence: 0.95,
      providerId: "invalid-realtime", trainedModel: true,
    }) });
    const graph = await planner.planGoal({ goal: "搜索鞋子" });
    expect(graph.demand).toMatchObject({ operation: "text_search", source: "local_template_rules" });
  });
});

describe("domain-neutral local decision protocol", () => {
  const operations: LocalTaskTemplate[] = [{ operation: "document_indexing", realtime: "deferred", complexity: "complex", privacy: "high",
    match: goal => goal.startsWith("index "),
    build: () => [{ taskId: "index", toolId: "document.index", inputRef: "goal" }] }];
  const decision: LocalTaskDecision = { operation: "document_indexing", realtime: "deferred", complexity: "simple", priority: "normal",
    privacy: "public", confidence: 0.95, trainedModel: true, providerId: "local-doc-v1", reasons: ["background document operation"] };

  it("does not register shopping rules in the reusable core", async () => {
    await expect(new LocalTaskPlannerService().planGoal({ goal: "搜索鞋子" })).rejects.toMatchObject({ code: "LOCAL_INTENT_UNSUPPORTED" });
  });

  it("passes versioned operations and preserves app privacy and workflow floors", async () => {
    const decide = jest.fn(async input => { input.context.privacy = "public"; return decision; });
    const planner = new LocalTaskPlannerService({ decide }, undefined, operations);
    const graph = await planner.planGoal({ goal: "organize my files", context: { privacy: "high", locality: "local_only", priority: "urgent" } });
    expect(decide.mock.calls[0][0]).toMatchObject({ schemaVersion: "1", operations: ["document_indexing"] });
    expect(graph.demand).toMatchObject({ operation: "document_indexing", complexity: "complex", priority: "urgent", source: "local_provider" });
    expect(graph.nodes[0].constraints).toMatchObject({ privacy: "high", locality: "local_only" });
  });

  it("bypasses the provider for an explicit operation", async () => {
    const decide = jest.fn(async () => decision);
    await new LocalTaskPlannerService({ decide }, undefined, operations).planGoal({ goal: "files", context: { operation: "document_indexing" } });
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([
    { operation: "video_summary" }, { confidence: 0.79 }, { privacy: "secret" },
    { priority: "immediate" }, { localityPreference: "remote" }, { reasons: [5] }, { realtime: undefined },
  ])("rejects invalid provider fields %j and uses domain rules", async invalid => {
    const planner = new LocalTaskPlannerService({ decide: async () => ({ ...decision, ...invalid } as LocalTaskDecision) }, undefined, operations);
    const graph = await planner.planGoal({ goal: "index docs" });
    expect(graph.demand).toMatchObject({ source: "local_template_rules", trainedModel: false });
    expect(graph.demand?.reasons).toContain("LOCAL_PROVIDER_OUTPUT_REJECTED");
  });

  it("aborts a hung provider within the decision budget and falls back", async () => {
    jest.useFakeTimers();
    try {
      let signal!: AbortSignal;
      const planner = new LocalTaskPlannerService({ decide: input => { signal = input.signal; return new Promise(() => {}); } }, undefined, operations);
      const pending = planner.planGoal({ goal: "index docs" });
      await jest.advanceTimersByTimeAsync(50);
      expect((await pending).demand?.reasons).toContain("LOCAL_PROVIDER_TIMEOUT");
      expect(signal.aborted).toBe(true);
    } finally { jest.useRealTimers(); }
  });
});
