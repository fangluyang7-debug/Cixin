# 云任务画像 Null 修复与调度闭环完善说明

## 1. 目标

本阶段主要解决当前云任务调度中网络画像长期为 `null`、云任务预测不足、执行中缺少监测、执行后缺少回写的问题。

最终目标是让调度件在不绑定具体 App 业务的前提下，形成：

```text
任务画像声明 -> 路由候选构建 -> 执行前探测/预测 -> 调度决策 -> 执行中监测 -> 执行后回写 -> 下一次调度优化
```

调度件不应该识别“拍照找鞋”“商品搜索”等业务名，而应该只识别通用任务画像，例如输入大小、是否上传、实时性、隐私等级、候选执行端、可降级方式和远程依赖。

## 2. 当前问题

目前云任务画像中的以下字段容易为 `null`：

- `rttMs`
- `uplinkMbps`
- `downlinkMbps`
- `cloudQueueMs`
- `estimatedUploadMs`
- `remoteDependencyHealth`
- `costEstimate`

原因不是调度件理论上无法获得这些信息，而是链路没有接完整：

1. App 只声明了任务，未在调度前补齐网络与云端状态。
2. 云端路由多来自固定 `declaredRoute`，即静态声明的云能力。
3. 真实路由在进入执行器后才创建，调度器在决策前拿不到完整候选路径。
4. 执行过程中的真实上传耗时、云端响应耗时、失败原因没有稳定回写到画像。
5. TTL 规则尚未按任务画像建立，导致调度器不知道哪些数据已过期。

## 3. 解耦原则

调度件不得依赖具体 App 业务名。

错误方式：

```text
如果是 shopping-assistant 的拍照找鞋任务，则刷新上传带宽
```

正确方式：

```text
如果 task.input.modality = image
且 task.input.bytes > 256KB
且 task.remote.requiresUpload = true
则要求 uplinkMbps 在 TTL 内有效
```

App 负责提供任务画像，调度件负责根据画像和资源状态做决策。

## 4. 任务画像建议字段

App 接入调度件时，应提交通用任务画像：

```ts
interface TaskProfile {
  taskId: string
  taskKind: 'vision' | 'text' | 'audio' | 'embedding' | 'search' | 'generic'
  latencyClass: 'realtime' | 'interactive' | 'background'
  deadlineMs?: number

  input: {
    modality: 'image' | 'text' | 'audio' | 'video' | 'mixed'
    bytes: number
    requiresUpload: boolean
  }

  execution: {
    candidateBackends: Array<'local' | 'cloud' | 'edge'>
    qualityPreference: 'speed' | 'balanced' | 'quality'
    retryable: boolean
    degradeOptions: string[]
  }

  remote?: {
    required: boolean
    dependencies: Array<'api' | 'database' | 'object_storage' | 'model_service'>
    estimatedResultBytes?: number
  }

  privacy: {
    level: 'low' | 'normal' | 'high'
    allowCloud: boolean
  }
}
```

## 5. 路由候选必须前置

需要把“路由创建”从执行器内部提前到调度器决策前。

目标链路：

```text
App TaskProfile
-> RouteRegistry 获取 local/cloud/edge 候选路由
-> ProbeService 补齐候选路由指标
-> Scheduler 比较各路由代价
-> Executor 只执行调度器选中的路由
```

不要让执行器内部才临时生成云路由，否则调度器只能根据静态 `declaredRoute` 做粗略判断。

## 6. declaredRoute 的定位

`declaredRoute` 只表示某个执行端“理论上支持什么任务”，例如：

```ts
{
  backend: 'cloud',
  supports: ['vision', 'search'],
  endpoint: 'https://xxx.zeabur.app',
  dependencies: ['database', 'object_storage', 'model_service']
}
```

它不能替代真实网络画像。

调度器可以把 `declaredRoute` 作为候选来源，但必须再叠加探测结果：

```text
declaredRoute + probeMetrics + executionHistory = routeCandidate
```

## 7. 执行前探测链路

当 App 接入调度件并声明存在云端任务后，调度件应自动进行轻量探测：

```text
1. ping/health 探测 RTT 和服务可达性
2. 小 payload 上传探测有效上行带宽
3. 云端 probe 接口探测冷启动和队列延迟
4. 远程依赖探测数据库、COS、模型服务是否可用
```

建议云端提供接口：

```text
GET  /runtime/probe/ping
POST /runtime/probe/upload
GET  /runtime/probe/dependencies
POST /runtime/probe/minimal-task
```

这些接口只返回状态和耗时，不执行业务搜索。

## 8. 执行前预测逻辑

调度器在执行前应估算：

```text
estimatedUploadMs = input.bytes / uplinkMbps
estimatedCloudMs = rttMs + estimatedUploadMs + cloudQueueMs + modelServiceMs + dbMs
estimatedLocalMs = localModelPredictionMs + devicePressurePenalty
```

然后比较：

```text
localCost
cloudCost
edgeCost
```

如果云端预测超过 `deadlineMs`，或者隐私不允许上云，则选择本地或降级。

## 9. 执行中监测

执行器需要回传阶段性事件：

```ts
interface ExecutionTelemetry {
  taskId: string
  routeId: string
  phase: 'upload' | 'queue' | 'compute' | 'download' | 'complete' | 'failed'
  timestamp: number
  durationMs?: number
  bytesSent?: number
  bytesReceived?: number
  errorCode?: string
}
```

调度件根据这些事件更新运行状态：

```text
上传变慢 -> 降低 cloud route 分数
云端排队过长 -> 尝试取消、降级或提示用户
本机温度升高 -> 降低 local route 分数
请求失败 -> 立即失效相关画像
```

## 10. 执行后回写

每次执行结束都要写回真实结果：

```text
actualUploadMs
actualRttMs
actualQueueMs
actualComputeMs
actualTotalMs
success/failure
failureReason
backendUsed
inputBytes
networkType
```

这些数据进入 `executionHistory`，用于下一次预测。

历史数据建议使用滑动窗口或指数移动平均，不要只保存最后一次值。

## 11. TTL 规则

TTL 按画像字段设置，而不是按 App 功能设置。

推荐初版：

```ts
const TTL = {
  rttMs: 30_000,
  uplinkMbps: 60_000,
  downlinkMbps: 120_000,
  cloudQueueMs: 60_000,
  cloudReachability: 180_000,
  remoteDependencyHealth: 180_000,
  costPolicy: 1_800_000,
  deviceState: 5_000
}
```

任务级调整：

```text
realtime:
  RTT TTL <= 10-15s
  优先本地或边缘，不做重探测

interactive:
  RTT TTL = 30s
  uplink TTL = 60s
  queue TTL = 60s

background:
  RTT TTL = 120s
  uplink TTL = 180s
  dependency TTL = 300s
```

强制失效规则：

```text
Wi-Fi/蜂窝切换 -> 网络画像立即失效
IP 或网络类型变化 -> 网络画像立即失效
请求超时 -> cloudReachability、rtt、queue 降权或失效
上传失败 -> uplinkMbps 立即失效
云端 5xx -> remoteDependencyHealth 降权
连续真实请求成功 -> 用真实数据刷新画像，不额外探测
```

## 12. 验收标准

完成后应满足：

1. 云任务调度前，`rttMs`、`uplinkMbps`、`cloudReachability` 不再长期为 `null`。
2. 大输入上传任务执行前能刷新上行带宽。
3. 调度器能在 local/cloud/edge 候选路由之间做预测比较。
4. 执行器能回传 upload、queue、compute、download、complete/fail 阶段事件。
5. 执行后真实耗时能写回历史画像。
6. TTL 过期、网络切换、请求失败会触发画像失效。
7. 调度逻辑不出现 shopping-assistant 专属判断，其他 App 只要提供相同 `TaskProfile` 即可接入。

## 13. 实施顺序

建议按以下顺序开发：

```text
P0：统一 TaskProfile、RouteCandidate、ExecutionTelemetry 类型
P1：把 cloud route 创建提前到调度器前
P2：增加 ProbeService，补齐 rtt/uplink/cloudHealth
P3：增加 TTL 判断和强制失效规则
P4：执行器分阶段回传 telemetry
P5：执行后写回 executionHistory
P6：调度盘展示预测值、真实值、TTL 状态和失效原因
```

## 14. 本阶段结论

本阶段的核心不是单纯“把 null 填成默认值”，而是建立真实的云任务调度闭环。

只有当调度器在执行前能获得有效预测，在执行中能感知异常，在执行后能回写经验时，调度件才真正具备区别于操作系统默认调度的价值。
