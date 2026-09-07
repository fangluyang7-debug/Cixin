# Runtime API Contract

本接口用于把购物业务操作和 Agentic Runtime 的调度轨迹关联起来。Runtime 只记录可验证的平台能力和真实性能，不会把缺失的 GPU、NPU、模型或云端 API 当成可用资源。

## 读取快照

```http
GET /api/v1/runtime/snapshot
```

返回 `tools`、`platforms`、`performanceSamples`、全局 `missingRequirements`、当前 `activeRun` 和最近 `recentRuns`。`activeRun` 为最近更新的运行记录，当前版本最多保留最近 20 条运行记录，保存在 API 进程内。

## 创建或更新计划

```http
POST /api/v1/runtime/plan
Content-Type: application/json

{
  "graphId": "image-search-demo",
  "goal": "使用上传图片检索商品",
  "nodes": [
    {
      "taskId": "crop",
      "toolId": "image.crop",
      "inputRef": "asset:asset_123"
    },
    {
      "taskId": "embedding",
      "toolId": "image.embedding",
      "inputRef": "task:crop",
      "dependencies": ["crop"]
    }
  ]
}
```

不传 `runId` 时创建新运行并返回 `runId`、`status`、`executionOrder`、`parallelGroups`、`assignments`、`evaluations` 和 `missingRequirements`。带上已有 `runId` 时，计划会覆盖该运行的当前 taskGraph 和 executionPlan。

`status=blocked` 是明确的阻断结果，不是异常。常见原因包括 `REAL_PERFORMANCE_PROFILE_MISSING`、`MODEL_UNSUPPORTED:*`、`CLOUD_ENDPOINT_NOT_CONFIGURED:*` 和 `NO_FEASIBLE_EXECUTOR`。

## 查询运行与回放

```http
GET /api/v1/runtime/runs
GET /api/v1/runtime/runs/:runId
```

单条运行包含：

- `taskGraph`：目标、节点和依赖关系。
- `executionPlan`：最终计划、候选执行器评估和硬约束原因。
- `telemetry`：调用方提交的真实执行指标。
- `operationTimeline`：业务入口实际经过的阶段耗时，例如上传、裁剪、模型调用和召回；它只用于流程回放，不会被当作某个执行器的性能样本。
- `verifications`：按任务记录的质量、延迟和 fallback 验证结果。
- `replanEvents`：重规划原因及关联的 telemetry 数量。

## 记录 Telemetry

```http
POST /api/v1/runtime/telemetry
Content-Type: application/json

{
  "runId": "run_...",
  "executionId": "exec_...",
  "taskId": "embedding",
  "toolId": "image.embedding",
  "executorId": "cix-p1-npu",
  "startedAt": "2026-09-07T00:00:00.000Z",
  "finishedAt": "2026-09-07T00:00:00.180Z",
  "latencyMs": 180,
  "memoryPeakMb": 420,
  "quality": 0.91,
  "fallbackOccurred": false,
  "success": true
}
```

Telemetry 会进入性能注册表，参与后续 Scheduler 评分；没有达到最小样本数的执行器仍不会被选中。

## Verify 与 Replan

`POST /api/v1/runtime/verify` 接收 `runId`、`assignment` 和同一执行的 `telemetry`，返回 `passed`、`reasons` 和 `recommendedActions`，并把结果挂到运行轨迹。

`POST /api/v1/runtime/replan` 接收 `runId`、`taskGraph`、`telemetry` 和可选 `reason`，重新运行 Scheduler，并记录一条 `replanEvents`。云端或设备能力缺失时，重规划仍会返回可解释的 `blocked` 结果，不会自动伪造 fallback 执行器。

## 图片搜索关联

`POST /api/v1/debug/image-search` 会在搜索前创建 Runtime run，并在响应的 `runtime` 字段返回完整运行记录；其中 `runtime.runId` 可以直接用于调度盘查询。图片搜索本身仍由购物业务服务执行，Runtime 负责目标拆解、资源评估和真实性能记录，不替代业务执行器。
