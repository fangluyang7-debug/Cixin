# Runtime API Contract

本接口用于把购物业务操作和 Agentic Runtime 的调度轨迹关联起来。Runtime 只记录可验证的平台能力和真实性能，不会把缺失的 GPU、NPU、模型或云端 API 当成可用资源。

## 读取快照

```http
GET /api/v1/runtime/snapshot
```

返回 `tools`、`platforms`、`performanceSamples`、全局 `missingRequirements`、当前 `activeRun` 和最近 `recentRuns`。`activeRun` 为最近更新的运行记录，当前版本最多保留最近 20 条运行记录，保存在 API 进程内。

## 实时事件流

```http
GET /api/v1/runtime/events
```

SSE 流。新连接会先回放进程内最近 200 条事件，再持续推送 Scheduler 关键节点：

- `task_graph_received`
- `candidate_evaluated`
- `executor_selected`
- `plan_blocked`
- `telemetry_recorded`
- `verification_failed`
- `replan_requested`
- `platform_state_updated`

事件 `data` 为 JSON，包含 `type`、`message`、`emittedAt`，以及可选的 `runId`、`graphId`、`taskId`、`toolId`、`executorId` 和 `payload`。连接保活使用 `heartbeat` 事件，不进入回放缓冲。

## 开发板动态状态上报

开发板或边缘代理可以主动向 Runtime 上报静态能力和动态状态。Runtime 只接受带来源和采样时间的真实观测；没有上报的指标在调度盘中显示为 `N/A`，不会被填入默认值。

```http
POST /api/v1/runtime/platforms/cix_p1/heartbeat
Content-Type: application/json
# 配置 RUNTIME_PLATFORM_HEARTBEAT_TOKEN 后必须携带：
x-runtime-agent-token: <shared-secret>

{
  "reportedAt": "2026-09-08T12:00:00.000Z",
  "source": "cix-agent-1.0",
  "profile": {
    "platformId": "cix_p1",
    "available": true,
    "os": "HarmonyOS/Linux",
    "arch": "arm64",
    "runtimeVersion": "NeuralONE 1.0",
    "cpuLogicalCores": 12,
    "totalMemoryMb": 65536,
    "backends": [],
    "missingCapabilities": [],
    "source": "cix-agent",
    "observedAt": "2026-09-08T12:00:00.000Z"
  },
  "executors": [],
  "state": {
    "cpuUtilizationPercent": 48.2,
    "cpuFrequencyMhz": 2800,
    "cpuCoreUtilizationPercent": [45, 51, 49, 47, 32, 38, 36, 35, 12, 15, 10, 9],
    "cpuClusterFrequencyMhz": [2800, 2400, 1800],
    "cpuClusterUtilizationPercent": [48, 35, 12],
    "gpuUtilizationPercent": 34.1,
    "npuUtilizationPercent": 72.4,
    "temperatureCelsius": 55.0,
    "freeMemoryMb": 42000,
    "networkLatencyMs": 39.6,
    "networkThroughputMbps": 1200,
    "networkTxMbps": 1180,
    "networkRxMbps": 360,
    "batteryPercent": null,
    "diskFreeMb": 420000,
    "activeTaskCount": 3,
    "queueDepth": 2,
    "queueWaitMs": 1.8,
    "powerWatts": 19.95,
    "fanRpm": 1850,
    "thermalThrottle": false,
    "npuLatencyMs": 37.5,
    "pipelineFps": 59.9,
    "droppedFrames": 0,
    "ioReadMbps": 210,
    "ioWriteMbps": 85,
    "iops": 45000,
    "currentModel": "ViT-B FP16",
    "observedAt": "2026-09-08T12:00:00.000Z"
  }
}
```

心跳默认有效期为 10 秒，由 `RUNTIME_PLATFORM_REPORT_TTL_MS` 配置。有效期按服务端 `receivedAt` 计算，避免开发板时钟漂移或未来时间戳让旧数据永久有效。快照中的每个平台包含 `heartbeat.fresh/reportedAt/receivedAt/source/ageMs/expiresInMs`；超过有效期后动态状态回退为适配器状态，过期元数据保留用于前端明确显示 `STALE`。

`profile` 和 `executors` 是启用板卡参与调度所必需的能力证明；只上报状态会显示“板端在线 · 不可调度”，不会自动伪造执行器。若设置 `RUNTIME_PLATFORM_HEARTBEAT_TOKEN`，板端必须通过 `x-runtime-agent-token` 提交共享令牌。

调度器当前会把空闲内存、性能样本、P95 延迟、质量、能耗、隐私与本地性作为原有约束，并新增以下实时保护：`thermalThrottle=true`、温度达到 `RUNTIME_CRITICAL_TEMPERATURE_CELSIUS`、CPU 执行器负载达到 `RUNTIME_MAX_CPU_UTILIZATION_PERCENT`、队列深度达到 `RUNTIME_MAX_LOCAL_QUEUE_DEPTH` 时拒绝本地候选；较高温度/低电量、队列压力、网络抖动和丢包会动态调整评分权重。

完整的显示/调度映射及当前无法可靠采集的项目见 [runtime-monitor-data-map.md](./runtime-monitor-data-map.md)。

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

`POST /api/v1/debug/image-search` 会先读取可选的 `runtimeRunId`。图片搜索页在用户点击搜索时会额外调用 `POST /api/v1/runtime/plan`，再把返回的 `runId` 传给图片搜索，使购物操作和同一次 Runtime 规划绑定在一起。没有 `runtimeRunId` 时，后端仍会新建运行记录。响应的 `runtime` 字段返回完整运行记录，可直接用于调度盘查询。图片搜索本身仍由购物业务服务执行，Runtime 负责目标拆解、资源评估和真实性能记录，不替代业务执行器。
