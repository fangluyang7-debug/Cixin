# 端云协同 AI 调度中间件 API 设计

## 文档信息

- API 版本：0.3（端云执行位置类型已落地）
- 状态：端云类型拆分已实现；真实云端 HTTP 与端侧模型仍按各自状态推进
- 适用模块：HarmonyOS HAR 调度中间件
- 上位基线：`00-项目统一口径与开发基线.md`

> 本文同时记录当前契约和目标迁移契约。标注“规划中”的字段不得在 UI 或调用代码中假装已经生效；当前真实实现以 `apps/scheduler/src/main/ets/api/SchedulerTypes.ets` 为准。

## 0. 0.3 版端云执行契约

- 已新增 `InferenceLocation.LOCAL_DEVICE` 与 `InferenceLocation.REMOTE_CLOUD`。
- `TaskType` 表示用户交互和优先级语义，`InferenceLocation` 表示执行位置，二者不能互相替代。
- 本地执行计划包含模型版本、真实 backend 和 CPU 线程数。
- 远端执行计划包含 Provider、超时、有限重试、并发等级和降级许可，禁止包含 CPU/GPU/NPU 和线程数。
- capability 与执行器注册信息必须声明执行位置；SchedulerService 拒绝位置不匹配的请求。
- `ExecutionPlan` 已拆分为判别联合类型；SchedulerService、执行器注册表、日志和 HUD 均按执行位置路由。

## 1. 设计原则

1. 演示 App 只依赖 HAR 公共类型和门面接口。
2. 系统 API、策略实现和 Native 推理细节不暴露给调用方。
3. 任务必须声明类型、精度偏好、时延目标和降级许可。
4. 调度结果必须可解释、可取消、可观测。
5. NPU、QoS 和热档位为能力适配，不是公共 API 的强依赖。
6. API 使用结构化错误，不把异常字符串作为业务协议。

## 2. 核心枚举

### 2.1 PolicyMode

| 值 | 含义 |
|---|---|
| `ADAPTIVE` | 根据设备状态和任务属性动态调度，默认模式 |
| `FIXED_PERFORMANCE` | 固定高性能配置，用于对照实验 |
| `FIXED_POWER_SAVING` | 固定省电配置，用于对照实验 |

### 2.2 TaskType

| 值 | 用途 |
|---|---|
| `FOREGROUND_REALTIME` | 拍照识别、用户点击搜索 |
| `USER_INITIATED` | 商品详情分析、相似商品推荐 |
| `BACKGROUND_BATCH` | 索引重建、缓存刷新、离线批处理 |

### 2.3 AccuracyPreference

| 值 | 含义 |
|---|---|
| `QUALITY_FIRST` | 精度优先，但仍受热安全限制 |
| `BALANCED` | 精度和速度平衡 |
| `SPEED_FIRST` | 速度和能耗优先 |

### 2.4 ModelTier

`HIGH_ACCURACY`、`BALANCED`、`LIGHTWEIGHT`。

### 2.5 ThermalLevel

中间件内部统一为 `UNKNOWN`、`NORMAL`、`WARM`、`HOT`、`CRITICAL`。系统原始枚举必须先经过适配，不在公共 API 中直接传播。

## 3. 初始化

### 3.1 initialize

```ts
initialize(config: SchedulerConfig): Promise<void>
```

职责：

- 注册状态适配器和执行器。
- 加载策略配置。
- 初始化日志、指标窗口和任务队列。
- 可选预热模型。

`SchedulerConfig` 建议字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `defaultPolicyMode` | `PolicyMode` | 是 | 默认调度模式 |
| `enableDebugInjection` | `boolean` | 是 | 发布版默认关闭 |
| `metricsWindowSize` | `number` | 是 | 近期耗时滑动窗口大小 |
| `upgradeStableDurationMs` | `number` | 是 | 状态恢复后的升档等待时间 |
| `minimumTierHoldMs` | `number` | 是 | 档位最短保持时间 |
| `executors` | `ExecutorConfig[]` | 是 | 已注册执行器与能力 |

初始化失败时不得进入半可用状态；再次初始化前应先调用 `shutdown()`。

## 4. 提交与控制任务

### 4.1 submitTask

```ts
submitTask<TInput, TOutput>(request: TaskRequest<TInput>): Promise<TaskHandle<TOutput>>
```

`TaskRequest`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `taskId` | `string` | 否 | 不提供时由中间件生成 |
| `taskType` | `TaskType` | 是 | 任务交互与优先级分类 |
| `inferenceLocation` | `InferenceLocation` | 是 | `LOCAL_DEVICE` 或 `REMOTE_CLOUD` |
| `capability` | `string` | 是 | 如 `image_embedding` |
| `input` | `TInput` | 是 | 任务输入，不进入普通日志 |
| `accuracyPreference` | `AccuracyPreference` | 是 | 精度偏好 |
| `latencyBudgetMs` | `number` | 否 | 期望时延目标 |
| `allowDegrade` | `boolean` | 是 | 是否允许降模型档位 |
| `allowPause` | `boolean` | 是 | 是否允许暂停/延后 |
| `timeoutMs` | `number` | 是 | 最大执行时间 |
| `remoteOptions` | `RemoteExecutionOptions` | 远端必填 | Provider、重试、并发与本地降级许可；本地任务禁止携带 |
| `metadata` | `Record<string, string>` | 否 | 业务追踪信息，不含密钥 |

`TaskHandle` 至少提供：

```ts
interface TaskHandle<TOutput> {
  taskId: string;
  result: Promise<TaskResult<TOutput>>;
  cancel(): Promise<boolean>;
  getStatus(): TaskStatus;
}
```

### 4.2 cancelTask

```ts
cancelTask(taskId: string): Promise<boolean>
```

未开始任务应从队列移除；运行中任务仅在执行器支持安全取消时中止，否则标记取消请求并丢弃回传结果。

### 4.3 setTaskPriority

```ts
setTaskPriority(taskId: string, priority: TaskPriority): Promise<void>
```

只允许调整尚未完成的任务。调用方调整优先级不能绕过热安全和低电量保护。

## 5. 策略控制

### 5.1 setPolicyMode

```ts
setPolicyMode(mode: PolicyMode): Promise<void>
```

模式变更对后续调度生效；已经运行的单次推理不在中途切换。固定模式仍需遵守临界热保护。

### 5.2 getPolicyMode

```ts
getPolicyMode(): PolicyMode
```

### 5.3 evaluate

```ts
evaluate(profile: TaskProfile, state?: DeviceState): ExecutionPlan
```

该接口主要用于单元测试和调试。生产调用通常通过 `submitTask` 自动完成评估。

`ExecutionPlan` 是 `LocalExecutionPlan | RemoteExecutionPlan` 判别联合，两类计划共享 `inferenceLocation`、`priority`、`queueAction`、`reasonCodes` 和 `policyVersion`。

`LocalExecutionPlan` 专有字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `modelTier` | `ModelTier` | 端侧模型档位 |
| `threadCount` | `1 \| 2 \| 4` | 真实 CPU 并行配置 |
| `backend` | `Backend` | 真实探测并由执行器支持的端侧后端 |

`RemoteExecutionPlan` 专有字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `provider` | `string` | 服务端代理 Provider ID |
| `timeoutMs` | `number` | 远端请求超时 |
| `maxRetries` | `number` | 有限重试次数，当前限制 0–3 |
| `maxConcurrency` | `number` | 远端并发上限 |
| `allowLocalFallback` | `boolean` | 云端失败时是否允许本地模板降级 |

远端计划在类型层没有 `modelTier`、`threadCount` 或 `backend` 字段。

## 6. 状态读取与注入

### 6.1 getDeviceState

```ts
getDeviceState(): DeviceState
```

`DeviceState`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `batteryPercent` | `number \| null` | 0–100，未知时为 null |
| `isCharging` | `boolean \| null` | 未知时为 null |
| `thermalLevel` | `ThermalLevel` | 统一热档位 |
| `appVisibility` | `FOREGROUND \| BACKGROUND` | 应用状态 |
| `recentLatencyMs` | `number \| null` | 最近窗口平均值 |
| `queueDepth` | `number` | 当前排队数量 |
| `availableBackends` | `Backend[]` | 真实能力枚举结果 |
| `source` | `REAL \| INJECTED \| MIXED` | 状态来源 |
| `capturedAt` | `number` | 时间戳 |

### 6.2 registerStateCallback

```ts
registerStateCallback(callback: StateCallback): Unsubscribe
```

只在状态实际变化或策略档位变化时通知，避免高频 UI 刷新。

### 6.3 injectDebugState

```ts
injectDebugState(patch: DebugStatePatch): Promise<void>
```

仅当 `enableDebugInjection=true` 时可用。所有注入状态必须在日志中标记，且不得进入真机实验统计。

### 6.4 clearDebugState

```ts
clearDebugState(): Promise<void>
```

恢复真实状态输入。

## 7. 日志与指标

### 7.1 registerLogCallback

```ts
registerLogCallback(callback: SchedulerLogCallback): Unsubscribe
```

`SchedulerLogEntry` 至少包含任务信息、设备状态摘要、状态来源、执行计划、命中规则、阶段耗时、结果状态和错误码。

### 7.2 getMetricsSnapshot

```ts
getMetricsSnapshot(filter?: MetricsFilter): MetricsSnapshot
```

用于调度面板和实验报告，返回任务数、均值、P95、队列时间、策略分布、降级次数和失败率。

## 8. 生命周期

### 8.1 pauseBackgroundTasks

```ts
pauseBackgroundTasks(reason?: string): Promise<number>
```

返回被暂停任务数量。

### 8.2 resumeBackgroundTasks

```ts
resumeBackgroundTasks(): Promise<number>
```

恢复前必须重新评估当前设备状态，不能无条件恢复高负载。

### 8.3 shutdown

```ts
shutdown(): Promise<void>
```

停止状态监听、拒绝新任务、处理剩余任务并释放 Native 资源。

## 9. 执行器接口

```ts
interface WorkloadExecutor<TInput, TOutput> {
  capability: string;
  supports(plan: ExecutionPlan): boolean;
  warmup?(plan: ExecutionPlan): Promise<void>;
  execute(
    input: TInput,
    plan: ExecutionPlan,
    signal: CancellationSignal
  ): Promise<ExecutorResult<TOutput>>;
  dispose(): Promise<void>;
}
```

可注册执行器包括 `NativeInferenceExecutor`、`LocalSearchExecutor`、`LocalAnnExecutor` 和仅用于原型测试的 `MockWorkloadExecutor`。

`TaskExecutor<TInput, TOutput>` 函数类型作为 `runTask()`/`schedule()` 的兼容入口继续保留；新能力优先通过注册 `WorkloadExecutor` 后调用 `submitTask()`，以获得排队、取消、超时和暂停控制。

## 10. 错误模型

| 错误码 | 含义 | 调用方处理 |
|---|---|---|
| `NOT_INITIALIZED` | 中间件未初始化 | 先执行 initialize |
| `ALREADY_INITIALIZED` | 未释放时重复初始化 | 先调用 shutdown |
| `INVALID_CONFIG` | 初始化配置不合法 | 修正窗口大小或滞回时长 |
| `INVALID_STATE` | 状态字段超出约束 | 修正电量、队列深度或近期耗时 |
| `DEBUG_INJECTION_DISABLED` | 调试注入未启用 | 开发配置开启后再注入，发布版保持关闭 |
| `INVALID_TASK` | 任务字段或输入不合法 | 修正请求 |
| `CAPABILITY_UNAVAILABLE` | 没有可用执行器 | 使用关键词兜底或提示 |
| `TASK_TIMEOUT` | 超出执行时间 | 允许时降级重试 |
| `TASK_CANCELLED` | 任务已取消 | 停止展示加载状态 |
| `MODEL_LOAD_FAILED` | 模型加载失败 | 降级模型或关闭能力 |
| `THERMAL_PROTECTION` | 临界热保护拒绝任务 | 延后执行并提示用户 |
| `INTERNAL_ERROR` | 未分类内部错误 | 记录任务 ID |

错误对象不得包含密钥、文件系统敏感路径或完整用户图片。

## 11. 线程与回调约束

- UI 回调必须切回适合更新 ArkUI 状态的上下文。
- Native 推理不能阻塞 UI 主线程。
- 回调内部异常不能中断调度器。
- 同一任务只允许完成一次；取消和完成竞争时以最先确认的终态为准。
- 日志与指标写入不能显著增加前台任务延迟。

## 12. 版本兼容

- 公共接口采用语义化版本。
- 新增可选字段保持向后兼容。
- 删除字段或改变枚举语义必须升级主版本。
- `policyVersion` 与模型版本独立记录，便于实验复现。

## 13. 当前实现状态

| 能力 | 状态 | 当前位置/备注 |
|---|---|---|
| RelationalStore 初始化 | 已实现 | `entry/src/main/ets/database/StoreManager.ets` |
| 2700 条商品事实数据导入 | 已实现 | `DataInitService.ets` + rawfile；尚无商品向量表 |
| 本地关键词搜索 | 已实现 | `StoreManager.searchProducts`，覆盖标题、店铺、平台与 `limit/offset` |
| 原生搜索首页 | 已实现 | `entry/src/main/ets/pages/Index.ets` |
| 调度面板 | 已实现，待模拟器验证 | `SchedulerPanelPage.ets` 展示状态、策略、队列、指标、日志，并支持调试注入和样例任务 |
| 独立结果页/详情页 | 未实现 | 下一阶段接入导航、筛选和详情 |
| HAR 模块与公共类型 | 已实现 | `apps/scheduler`、`SchedulerTypes.ets`、根 `Index.ets` |
| `SchedulerService` 生命周期门面 | 已实现 | 初始化、释放、模式切换、策略评估、状态/日志回调、任务队列和实时指标 |
| 三档 `SchedulerPolicy` | 已实现（专家规则） | 本地轻量/均衡/高精度与远端计划已分流；决策树和真实端侧执行器约束尚未实现 |
| `HysteresisController` | 已实现 | 支持立即降级、稳定延迟升级、最小驻留与逐档恢复 |
| 任务提交与控制 API | 已实现 | `submitTask`、`TaskHandle`、取消、优先级调整、超时与后台暂停恢复；兼容 `runTask`/`schedule` |
| 状态模型与来源合并 | 已实现 | `DeviceStateController` 统一 REAL/MIXED/INJECTED 快照并校验输入 |
| 真实状态感知 | 已实现，待真机验证 | 已接入电量、充电、thermal 回调与 Ability 生命周期，失败时降级为 UNKNOWN/null |
| 调试状态注入 | 已实现 | 支持局部覆盖、来源标记和清除后恢复最新真实状态 |
| 任务队列、执行器和日志 | 已实现 | 稳定优先级队列、`ExecutorRegistry`、`MockWorkloadExecutor`、任务日志与指标窗口 |
| 本地张量/Embedding 引擎 | 原型 | 当前为哈希投影、顺序分片和人工延时，不是真实模型或性能证据 |
| MindSpore Lite / C++ | 未实现 | 需新增 Native 模块、模型文件和模型卡 |
| 云端 LLM Provider | Stub | 当前没有真实 LLM HTTP 请求；`10.0.2.2` 仅用于模拟器代理联调 |
| GPU / NPU / NNRT | 未验证 | 当前默认可用列表待纠偏；不得写成已支持 |
| `InferenceLocation` 与双计划类型 | 已实现 | 公共类型、请求校验、执行器位置匹配、日志和 HUD 已完成迁移 |
