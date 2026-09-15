import { TaskGraph } from "./runtime.contracts";

export function buildImageSearchTaskGraph(assetId: string): TaskGraph {
  return {
    graphId: `image-search-${assetId}`,
    goal: `使用图片 ${assetId} 完成可解释的商品候选检索`,
    planner: "shopping-debug-entry",
    createdAt: new Date().toISOString(),
    demand: {
      operation: "image_search",
      realtime: "interactive",
      complexity: "complex",
      deadlineMs: 3000,
      priority: "interactive",
      source: "explicit_operation",
      reasons: ["用户正在等待图片检索结果", "图片流水线包含预处理、推理和检索阶段"],
      plannerVersion: "shopping-debug-entry-v1",
      trainedModel: false,
    },
    nodes: [
      {
        taskId: "quality-check",
        toolId: "image.quality_check",
        inputRef: `asset:${assetId}`,
        constraints: { deadlineMs: 3000, priority: "interactive", allowDegrade: false },
        checkpointPolicy: { enabled: true, stopOnResourcePressure: true },
        fallbackPolicy: {
          enabled: true,
          actions: ["请求用户重新上传图片"],
          maxAttempts: 2,
          replanAtStageBoundary: true,
        },
      },
      {
        taskId: "crop",
        toolId: "image.crop",
        inputRef: `asset:${assetId}`,
        dependencies: ["quality-check"],
        constraints: { deadlineMs: 3000, priority: "interactive", allowDegrade: false },
        checkpointPolicy: { enabled: true, stopOnResourcePressure: true },
        fallbackPolicy: {
          enabled: true,
          actions: ["使用原图继续处理"],
          maxAttempts: 2,
          replanAtStageBoundary: true,
        },
      },
      {
        taskId: "embedding",
        toolId: "image.embedding",
        inputRef: "task:crop",
        dependencies: ["crop"],
        constraints: { deadlineMs: 3000, priority: "interactive", allowDegrade: false },
        checkpointPolicy: { enabled: true, stopOnResourcePressure: true },
        fallbackPolicy: {
          enabled: true,
          actions: ["降低输入分辨率"],
          maxAttempts: 2,
          replanAtStageBoundary: true,
        },
      },
      {
        taskId: "vector-search",
        toolId: "catalog.vector_search",
        inputRef: "task:embedding",
        dependencies: ["embedding"],
        constraints: { deadlineMs: 3000, priority: "interactive", allowDegrade: false },
        checkpointPolicy: { enabled: true, stopOnResourcePressure: true },
        fallbackPolicy: {
          enabled: true,
          actions: ["切换到结构化标签召回"],
          maxAttempts: 2,
          replanAtStageBoundary: true,
        },
      },
    ],
  };
}
