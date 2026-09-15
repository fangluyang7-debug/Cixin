# Runtime API Contract

> 2026-09-15 规范化更新：通用业务模板注册、Provider v1、warning 分级、终端保护通道与检查点关联已加入。购物规则只在演示模块注册，核心默认无操作集。当前无训练模型，也未绑定购物保护 Handler。验收见 [测试报告](../../../docs/调度件规范化测试报告.md)。

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
- `protection_triggered`
- `checkpoint_committed`
- `checkpoint_captured`
- `checkpoint_restored`
- `rollback_failed`

事件 `data` 为 JSON，包含 `type`、`message`、`emittedAt`，以及可选的 `runId`、`graphId`、`taskId`、`toolId`、`executorId` 和 `payload`。连接保活使用 `heartbeat` 事件，不进入回放缓冲。

## 本地任务规划与受保护执行

`POST /api/v1/runtime/agent/plan` 接收 `{ "goal": "搜索鞋子", "context": { "operation": "text_search", "realtime": "interactive", "deadlineMs": 1500, "privacy": "sensitive", "locality": "local_preferred", "minimumQuality": 0.8, "energyBudgetMah": 5, "preference": "speed", "allowDegrade": false } }`。默认本地购物 Planner 的 `operation` 允许 `text_search`、`image_search`、`product_compare`、`background_search`，`image_search` 还需 `context.assetId`。未指定 `operation` 时，只解析受限前缀；无法判断返回 `blocked` 和 `LOCAL_INTENT_UNSUPPORTED`。`realtime` 与 `deadlineMs` 是业务声明或模板默认值，不等同于 OS 的硬实时保证；`complexity` 当前按模板工作流结构给出。使用 `RuntimeCoreModule` 的其他业务可注入自己的 `AGENT_PLANNER`，并在直接 `TaskGraph` 中使用任意非空操作名。

计划的 `demand` 标明操作、交互类别、复杂度、预算、优先级、来源、规划器版本、`trainedModel` 及可选 `decisionConfidence`。监控页用 `EXPLICIT/RULE/PROVIDER/MODEL` 区分显式声明、模板规则、外接决策器和已训练模型。`estimatedCriticalPathMs` 是依赖链的实测 P95 加已知传输/排队开销；`evaluations[].forecast` 列出红线、预测值、缺失指标和建议。`allowDegrade=true` 只放开工具显式注册、经过性能验证的轻量模型变体，不自动把请求送云端。云端仍需硬约束、健康/模型证明和新鲜网络测量。

宿主通过 `operations: LocalTaskTemplate[]` 注册任意业务操作和本地规则，另可注册 `LOCAL_TASK_DECISION_PROVIDER`。Provider v1 接收 `goal/context/operations/schemaVersion="1"/signal`，返回必需字段 `operation/realtime/complexity/priority/privacy/confidence/providerId/trainedModel/reasons`，可选 `localityPreference`。操作必须位于配置集合内；reasons 最多 8 条、每条最多 256 字。模型超过默认 50 ms（最多 500 ms）、置信度不在 0.8～1 或字段非法时丢弃整个结果并回退业务规则；未命中则 LOCAL_INTENT_UNSUPPORTED。显式 operation 优先且不调用 Provider，显式 taskGraph 不经过 Provider。模板复杂度和隐私是下限，调用方显式优先级及位置约束优先，不能用模型放宽保护。当前没有默认训练模型。

`POST /api/v1/runtime/runs/{runId}/execute` 会用最新设备状态重新准入，要求计划中每个任务已绑定匹配工具/执行器/模型的 `GuardedToolHandler`。若缺绑定则返回 `409 GUARDED_EXECUTOR_NOT_BOUND`，不会假装执行。当前注册集合为空，需要宿主在启动时调用 `GuardedExecutionService.register`。这条执行路径现阶段串行运行，每 500 ms 监测当前执行器，保留已完成阶段输出；实际执行器必须支持取消、`capture` 和 `restore`。

`POST /api/v1/runtime/runs/{runId}/cancel` 发出协作式取消，先返回 `stopping`，待 Handler 的 `execute` 结束并尝试恢复检查点后，`GET /api/v1/runtime/runs/{runId}` 才会显示 `rolled_back`、`rollback_failed` 或 `cancelled`。不能中断不响应信号的推理内核，也不能回退系统和其他应用状态。`advice` 仅提出本应用降载/检查散热等建议，不会自动终止其他应用。预测方法是带残差余量的线性趋势，不是训练模型；除内存预算外，尚不预测新任务造成的额外升温或耗电，缺温度等指标会标 `unknown`。

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

`profile` 和 `executors` 是启用板卡参与调度所必需的能力证明；只上报状态会显示“板端在线 · 不可调度”，不会自动伪造执行器。若设置 `RUNTIME_PLATFORM_HEARTBEAT_TOKEN`，板端必须通过 `x-runtime-agent-token` 提交共享令牌；同一令牌也保护 Telemetry、Verify 和 Replan 写入口，避免未授权样本改变调度档案。未配置令牌只适合可信本机演示环境。

预测结果为 nominal/warning/critical/unknown。普通 CPU/GPU/NPU 高负载、队列压力、轻微升温、抖动进入 warning，不单独拒绝。warning 对应 run_conservatively，选中后 recommendedMaxConcurrency=1、parallelGroups 串行化，并重新检查串行时限。warning 候选分数乘 0.9，已允许且质量合格的轻量候选乘 0.95，调整原因写入 reasons。

内存不足、温度达到或预测达到红线、持续高负载伴随热降频、确定的排队超时才 critical。临界电量还需结合外部电源和任务可中断性/实测能耗。缺 CPU、温度等非必需观测标 unknown，不单独拒绝；缺必要可用内存、模型证明、性能档案或硬约束所需证据仍拒绝。unknownMetrics 与 trendUnavailableMetrics 分别表示观测缺失和趋势样本不足。新心跳可上报 gpuMemoryFreeMb/npuMemoryFreeMb/dmaPoolFreeMb/externalPower；后者为布尔观测。前两者有新鲜值时用于加速器容量检查，DMA 暂只记录。阈值见 .env.example，RUNTIME_MAX_CPU_UTILIZATION_PERCENT 仅保留为告警阈值的旧配置别名。

所有当前状态判断检查 observedAt；位置偏好仍由 RUNTIME_PLACEMENT_PREFERENCE_BOOST 提供软增益，不覆盖硬约束。

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

`RuntimeCoreModule.register({ operations, decisionProvider, platformAdapters, planner })` 支持业务模板、决策器、设备适配器和完整规划器扩展。核心默认不注册任何购物操作/工具。planner 绑定 AGENT_PLANNER；decisionProvider 绑定 LOCAL_TASK_DECISION_PROVIDER；platformAdapters 绑定 RUNTIME_PLATFORM_ADAPTERS 并返回 PlatformAdapter[]，替换默认设备列表。接口从 public-api.ts 导入，当前仍是源码模块，不是已发布 SDK。

## 终端硬保护与运行关联

`POST /api/v1/runtime/protection` 接收：

```json
{
  "runId": "current-run-id",
  "executionId": "current-execution-id",
  "executorId": "bound-executor-id",
  "reason": "TERMINAL_THERMAL_REDLINE",
  "observedAt": "2026-09-15T00:00:00.000Z",
  "workerStopped": true
}
```

示例 ID/时间必须替换为当前 Handler 参数/采样时间。reason 仅允许 TERMINAL_THERMAL_REDLINE、TERMINAL_MEMORY_REDLINE、TERMINAL_EXECUTOR_LOST。必须配置共享令牌并携带 x-runtime-agent-token；未配置也返回 401。事件不得早于 10 秒或超前 1 秒；格式错误返回 400，非当前绑定执行返回 409。成功返回 accepted/executionId，仅表示接受停止事件，不等于恢复完成。

Handler.execute 现在接收 runId/executionId/checkpointId，端侧适配器应原样关联上报；Linux 独立保护辅助组件见 tools/cix-runtime-agent/local_safety_guard.py。它先停止自己启动的进程组，再回调上报，当前不自动注册到购物工具。

Run.checkpoints 保存 captured/committed/restored/restore_failed、关联 ID 与时间；实际快照由 Handler 持有。Telemetry.metadata 关联 runId/checkpointId，阶段时间线与 SSE 记录捕获和恢复。当前均为内存记录，无重启恢复能力。未取得真实资源测量的失败/取消不生成伪造 Telemetry。

受保护执行器当前串行且一次只接受一个运行。串行预测超时返回 409 GUARDED_SERIAL_DEADLINE_EXCEEDED；实际执行与提交前也检查节点/任务图预算。预算仍是启发式执行阶段预算，不是包含 API 往返的硬实时承诺。

不传 `runId` 时创建新运行并返回 `runId`、`status`、`executionOrder`、`parallelGroups`、`assignments`、`evaluations` 和 `missingRequirements`。带上已有 `runId` 时，只能更新 `planning/ready/blocked` 运行的 taskGraph 和 executionPlan。不存在的 ID 返回 `RUNTIME_RUN_NOT_FOUND`；`running/stopping` 或终态运行返回 `RUNTIME_RUN_PLAN_LOCKED`，并且不会先产生候选事件或写入 Telemetry。

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

Telemetry 会先校验标识、时间顺序、非负延迟/内存/能耗和 `0~1` 质量范围，再进入性能注册表并参与后续 Scheduler 评分；没有达到最小样本数的执行器仍不会被选中。相同内容的 `executionId` 重复提交是幂等操作，不增加样本数；同一 ID 的内容冲突返回 `409 TELEMETRY_EXECUTION_ID_CONFLICT`。受保护执行中，若实际输出未通过任务/工具的质量、时限、能耗或 fallback 校验，会保存为 `success=false/errorCode=RESULT_VERIFICATION_FAILED`，然后恢复检查点；该负样本会反映到后续可靠性评分。

## Verify 与 Replan

`POST /api/v1/runtime/verify` 接收 `runId`、`assignment` 和同一执行的 `telemetry`，返回 `passed`、`reasons` 和 `recommendedActions`，并把结果挂到运行轨迹。

`POST /api/v1/runtime/replan` 接收 `runId`、`taskGraph`、`telemetry` 和可选 `reason`，重新运行 Scheduler，并记录一条 `replanEvents`。云端或设备能力缺失时，重规划仍会返回可解释的 `blocked` 结果，不会自动伪造 fallback 执行器。

## 图片搜索关联

`POST /api/v1/debug/image-search` 会先读取可选的 `runtimeRunId`。图片搜索页在用户点击搜索时会额外调用 `POST /api/v1/runtime/plan`，再把返回的 `runId` 传给图片搜索，使购物操作和同一次 Runtime 规划绑定在一起。没有 `runtimeRunId` 时，后端仍会新建运行记录。响应的 `runtime` 字段返回完整运行记录，可直接用于调度盘查询。图片搜索本身仍由购物业务服务执行，Runtime 负责目标拆解、资源评估和真实性能记录，不替代业务执行器。
