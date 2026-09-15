import { LocalTaskTemplate } from "./local-task-planner.service";
import { buildImageSearchTaskGraph } from "./image-search-task-graph";
import { RuntimePlanningError } from "./runtime-errors";
import { TaskIntent } from "./runtime.contracts";

function textNodes(compare = false): TaskIntent[] {
  const nodes: TaskIntent[] = [
    { taskId: "embedding", toolId: "text.embedding", inputRef: "goal" },
    { taskId: "search", toolId: "catalog.vector_search", inputRef: "task:embedding", dependencies: ["embedding"] },
  ];
  if (compare) nodes.push({ taskId: "answer", toolId: "answer.generate", inputRef: "task:search", dependencies: ["search"] });
  return nodes;
}

/** Demonstration rules only; the reusable core registers no business operations by default. */
export const shoppingTaskTemplates: LocalTaskTemplate[] = [
  { operation: "text_search", realtime: "interactive", complexity: "simple", privacy: "sensitive",
    match: goal => /^(搜|搜索|查找|帮我找|找)(商品|产品|一下|一双|一件|\s|鞋|电脑|手机)/u.test(goal), build: () => textNodes() },
  { operation: "product_compare", realtime: "interactive", complexity: "complex", privacy: "sensitive",
    match: goal => /^(比较|对比)(商品|产品|一下|这|\s)/u.test(goal), build: () => textNodes(true) },
  { operation: "background_search", realtime: "deferred", complexity: "simple", privacy: "sensitive",
    match: goal => /^(后台搜索|批量搜索)/u.test(goal), build: () => textNodes() },
  { operation: "image_search", realtime: "interactive", complexity: "complex", privacy: "sensitive",
    match: goal => /^(以图搜|图片搜|拍照搜)/u.test(goal),
    build: (_, context) => {
      if (typeof context.assetId !== "string" || !context.assetId.trim()) {
        throw new RuntimePlanningError("IMAGE_ASSET_REQUIRED", "图片检索需要本地 assetId。");
      }
      return buildImageSearchTaskGraph(context.assetId.trim()).nodes;
    } },
];
