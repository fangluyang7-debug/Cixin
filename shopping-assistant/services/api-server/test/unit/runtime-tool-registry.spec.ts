import { ConfigService } from "@nestjs/config";
import { createShoppingPlugin } from "../../src/core/runtime/shopping-plugin";
import { ToolRegistryService } from "../../src/core/runtime/tool-registry.service";

describe("ToolRegistryService", () => {
  it("registers the shopping application as a plugin without backend choices", () => {
    const registry = new ToolRegistryService();
    registry.registerPlugin(createShoppingPlugin(new ConfigService()));

    expect(registry.list().map((tool) => tool.toolId)).toEqual([
      "answer.generate",
      "catalog.price_query",
      "catalog.vector_search",
      "image.crop",
      "image.embedding",
      "image.quality_check",
      "text.embedding",
    ]);
    expect(registry.get("image.embedding")?.resourceHints).not.toHaveProperty(
      "backend",
    );
  });

  it("rejects duplicate tools and invalid weight totals", () => {
    const registry = new ToolRegistryService();
    const plugin = createShoppingPlugin(new ConfigService());
    registry.registerPlugin(plugin);

    expect(() => registry.register(plugin.tools[0])).toThrow(
      "TOOL_ALREADY_REGISTERED",
    );
    expect(() =>
      registry.register({
        ...plugin.tools[0],
        toolId: "invalid.weights",
        defaultWeights: {
          latency: 1,
          quality: 1,
          energy: 0,
          reliability: 0,
        },
      }),
    ).toThrow("TOOL_WEIGHTS_MUST_SUM_TO_ONE");
  });

  it("rejects contradictory placement and invalid quality declarations", () => {
    const registry = new ToolRegistryService();
    const descriptor = createShoppingPlugin(new ConfigService()).tools[0];

    expect(() => registry.register({
      ...descriptor,
      toolId: "invalid.placement",
      constraints: { ...descriptor.constraints, locality: "local_only", allowLocal: false },
    })).toThrow("TOOL_CONSTRAINTS_INVALID");
    expect(() => registry.register({
      ...descriptor,
      toolId: "invalid.quality",
      quality: { ...descriptor.quality, minimumScore: 2 },
    })).toThrow("TOOL_QUALITY_INVALID");
  });
});
