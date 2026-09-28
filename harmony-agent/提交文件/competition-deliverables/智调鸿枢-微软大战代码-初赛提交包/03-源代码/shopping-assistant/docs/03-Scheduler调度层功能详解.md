# Scheduler 调度层功能详解

更新日期：2026-07-21

本文用于给队友说明当前 `scheduler` 调度层已经具备什么能力、每个能力的设计目的是什么、现在的实现逻辑是什么，以及后续可以怎么继续补。它不是 HarmonyOS 系统内核调度器，而是运行在 App/HAR 层的“AI 任务调度中间层”。

## 1. 当前定位

`scheduler` 的作用是把拍照识别、语音理解、商品检索、推荐排序、后台批处理等 AI/计算任务统一包成任务，再根据设备状态和任务要求生成执行计划。

执行计划目前会包含：

1. 使用高精度、均衡还是轻量模型档位。
2. 使用 1、2、4 个 CPU 线程档位。
3. 使用 CPU 还是 NNRT/NPU 后端。
4. 当前任务优先级。
5. 当前任务是立即执行、排队、限速、暂停还是拒绝。
6. 这次决策的原因码。

当前源码位置：

```text
shopping-assistant/apps/scheduler
```

主要入口：

```text
apps/scheduler/Index.ets
apps/scheduler/src/main/ets/api/SchedulerService.ets
```

## 2. 当前目录结构

```text
api/
  SchedulerTypes.ets      公共类型、任务结构、状态结构、日志结构
  SchedulerService.ets    调度器门面，App 和页面主要调用这里
  SchedulerError.ets      统一错误码

policy/
  SchedulerPolicy.ets       策略决策：根据任务和设备状态选择执行计划
  HysteresisController.ets   滞回控制：防止模型档位频繁来回跳
  SchedulerReasonCode.ets   策略原因码

state/
  DeviceStateController.ets      真实状态和调试注入状态的合成
  HarmonyDeviceStateAdapter.ets  HarmonyOS 设备状态适配器

executor/
  ExecutorRegistry.ets        执行器注册表
  CancellationController.ets  取消信号
  MockWorkloadExecutor.ets    测试用 Mock 执行器

queue/
  TaskQueue.ets               优先级任务队列，已加入老化机制

src/test/
  SchedulerUnit.test.ets
  TaskExecutionUnit.test.ets
```

## 3. 对外接口现状

当前 `SchedulerService` 已经提供这些核心接口：

| 功能 | 当前接口 | 状态 |
|---|---|---|
| 初始化 | `initialize(config)` | 已实现 |
| 销毁 | `shutdown()` | 已实现 |
| 全局暂停 | `pause()` | 已实现，本次新增 |
| 全局恢复 | `resume()` | 已实现，本次新增 |
| 是否暂停 | `isPaused()` | 已实现，本次新增 |
| 提交任务 | `submitTask(request)` | 已实现 |
| 直接运行任务 | `runTask(request, executor)` | 已实现 |
| 取消任务 | `cancelTask(taskId)` | 已实现 |
| 查询任务状态 | `getTaskStatus(taskId)` | 已实现，本次新增 |
| 调整任务优先级 | `setTaskPriority(taskId, priority)` | 已实现 |
| 切换策略模式 | `setPolicyMode(mode)` | 已实现 |
| 获取当前策略 | `getCurrentPolicy()` / `getPolicyMode()` | 已实现，本次新增别名 |
| 获取运行指标 | `getRuntimeMetrics()` / `getMetricsSnapshot()` | 已实现，本次新增别名 |
| 注册状态回调 | `registerStateCallback(callback)` | 已实现 |
| 注册日志回调 | `registerLogCallback(callback)` | 已实现 |
| 获取最近日志 | `getRecentLogs(limit)` | 已实现 |
| 注入调试状态 | `injectDebugState(patch)` | 已实现，本次扩展 |
| 清除调试状态 | `clearDebugState()` | 已实现 |
| 暂停后台任务 | `pauseBackgroundTasks(reason?)` | 已实现 |
| 恢复后台任务 | `resumeBackgroundTasks()` | 已实现 |

## 4. 调度器初始化与销毁

设计目标：App 启动时统一创建调度器需要的策略、状态、队列、执行器注册表和日志窗口；App 退出或重置时释放资源、取消未完成任务。

当前实现：

```ts
SchedulerService.initialize(config)
SchedulerService.shutdown()
```

初始化时会创建：

1. `SchedulerPolicy`
2. `HysteresisController`
3. `DeviceStateController`
4. `ExecutorRegistry`
5. `TaskQueue`
6. 任务表、日志列表、指标计数器

本次补充：新增 `pause()`、`resume()` 和 `isPaused()`。暂停后，已经运行中的任务不会被强行杀掉，但调度器不会继续从队列取新任务；恢复后会继续消费队列。

## 5. AI 任务统一封装

设计目标：页面不要直接调用模型或重计算逻辑，而是把任务统一描述成 `TaskRequest`。

关键类型：

```ts
TaskRequest<TInput>
TaskProfile
TaskResult<TOutput>
TaskHandle<TOutput>
```

`TaskRequest` 负责描述任务输入和要求，例如：

```text
taskType: USER_INITIATED
capability: local_product_search
accuracyPreference: SPEED_FIRST
latencyBudgetMs: 120
allowDegrade: true
allowPause: false
timeoutMs: 3000
```

调度器内部会把它转成 `TaskProfile`，再交给策略层计算 `ExecutionPlan`。

## 6. 任务提交与状态管理

设计目标：任务进入调度器后，可以排队、执行、取消、超时、查询状态。

当前状态枚举：

```text
CREATED
QUEUED
RUNNING
SUCCEEDED
FAILED
TIMED_OUT
CANCELLED
```

当前流程：

```text
submitTask()
-> 校验 TaskRequest
-> 生成 taskId
-> 读取 DeviceState
-> evaluate() 生成 ExecutionPlan
-> 找到匹配的 WorkloadExecutor
-> 创建 InternalTask
-> 写 CREATED 日志
-> 放入 TaskQueue
-> 返回 TaskHandle
```

本次补充：新增 `getTaskStatus(taskId)`。它会先查当前活动任务；如果任务已经结束，会回看最近日志，返回最后一次终态。

## 7. 多优先级任务队列

设计目标：前台实时任务优先，用户触发任务其次，后台批处理任务最低，但后台任务不能永远饿死。

当前实现文件：

```text
apps/scheduler/src/main/ets/queue/TaskQueue.ets
```

当前排序逻辑：

```text
CRITICAL > HIGH > NORMAL > LOW
```

同优先级按进入队列顺序执行。

本次补充：新增队列老化机制。任务每等待 30 秒会获得一点排序加成，最多加 3 点。这样低优先级后台任务如果长期等待，会逐步获得运行机会。

## 8. 设备状态感知

设计目标：调度策略不能只看任务本身，还要看设备当前能不能承受高负载。

当前 `DeviceState` 包含：

```ts
batteryPercent
isCharging
thermalLevel
appVisibility
recentLatencyMs
queueDepth
availableBackends
source
capturedAt
```

其中：

1. `thermalLevel` 表示热状态。
2. `batteryPercent` 和 `isCharging` 表示电量和充电状态。
3. `recentLatencyMs` 表示近期推理耗时。
4. `queueDepth` 表示当前排队压力。
5. `availableBackends` 表示可用后端，例如 `CPU`、`NNRT`。
6. `source` 表示状态来自真实设备、调试注入，还是混合状态。

本次补充：`DebugStatePatch` 已支持注入 `queueDepth` 和 `availableBackends`。这意味着可以在调度面板或测试代码中模拟“队列拥塞”和“NNRT/NPU 可用”。

## 9. 调度策略决策

设计目标：根据任务要求和设备状态生成执行计划。

当前策略模式：

```text
ADAPTIVE              自适应
FIXED_PERFORMANCE     固定高性能
FIXED_POWER_SAVING    固定省电
```

当前自适应策略大致是：

1. 如果热状态是 `CRITICAL`，进入保护，必要时拒绝不可降级任务。
2. 如果热状态是 `HOT`，降到轻量模型，后台任务可暂停。
3. 如果低电量且未充电，降到轻量模型。
4. 如果状态未知，保守选择均衡模型。
5. 如果温热，选择均衡模型，后台任务限速。
6. 如果用户要求速度优先且允许降级，选择轻量模型。
7. 如果延迟压力明显且电量条件允许，选择高精度/高性能档。
8. 如果队列拥塞，选择均衡档，并对后台任务限速。
9. 如果电量健康或正在充电，可以使用高精度档。

每次决策都会记录 `reasonCodes`，用于展示“为什么这样调度”。

## 10. 模型档位选择

当前模型档位：

```text
HIGH_ACCURACY
BALANCED
LIGHTWEIGHT
```

当前对应线程档位：

| 模型档位 | 线程数 |
|---|---|
| `HIGH_ACCURACY` | 4 |
| `BALANCED` | 2 |
| `LIGHTWEIGHT` | 1 |

目前还没有接入真实模型文件。这里的模型档位先作为调度决策输出，后续真实推理执行器需要根据这个档位选择不同模型或不同参数。

## 11. CPU 线程档位选择

当前线程档位和模型档位绑定：

```text
高精度 -> 4 线程
均衡   -> 2 线程
轻量   -> 1 线程
```

后续如果接入真实推理库，可以把 `threadCount` 传给推理引擎，或者由执行器内部解释为不同线程池配置。

## 12. QoS 优先级管理

当前用 `TaskPriority` 表达应用层优先级：

```text
FOREGROUND_REALTIME -> CRITICAL
USER_INITIATED      -> HIGH
BACKGROUND_BATCH    -> LOW
```

这还不是系统级 QoS API，只是 App 内部的调度优先级。后续如果 HarmonyOS 提供可用的线程 QoS 设置，可以在执行器内部把 `TaskPriority` 映射到系统接口。

## 13. 推理后端选择

设计目标：如果设备支持 NNRT/NPU，就优先让较重的模型走 NNRT；如果不支持，或者当前是轻量/保护档，就回到 CPU。

当前后端枚举：

```text
CPU
NNRT
```

本次补充：

1. `SchedulerPolicy` 不再永远返回 CPU。
2. 当 `availableBackends` 包含 `NNRT`，且模型档位不是 `LIGHTWEIGHT`，执行计划会选择 `NNRT`。
3. 当模型档位是 `LIGHTWEIGHT`，即使设备有 NNRT，也会选择 CPU。
4. 原因码会追加：
   - `NNRT_BACKEND_SELECTED`
   - `CPU_BACKEND_FALLBACK`

注意：这一步只是调度计划层面的选择。真正调用 NPU/NNRT，还需要后续 `WorkloadExecutor` 接入真实推理后端。

## 14. 并发与资源控制

当前实现是单执行循环：同一时间只从队列取一个任务执行。

这样做的优点是第一版稳定、容易展示和排查。后续可以扩展成：

1. 前台实时任务单独通道。
2. 后台批处理限速通道。
3. CPU 和 NNRT 分别维护资源槽位。
4. 根据热状态和电量动态调整最大并发数。

## 15. 实时任务优化

当前已经有 `TaskType.FOREGROUND_REALTIME`，它会被映射成 `CRITICAL` 优先级，并默认 `IMMEDIATE`。

尚未实现的部分：

1. 摄像头帧队列长度限制。
2. 丢弃过期帧。
3. 只保留最新帧。
4. 动态推理频率控制。

后续拍照/摄像头能力接入后，这部分应该放在提交任务之前或执行器内部处理。

## 16. 热状态与低电量降级

当前已经实现：

1. `HOT`：降到轻量模型，后台任务可暂停。
2. `CRITICAL`：进入强保护，不允许降级的任务会被拒绝。
3. 低电量且未充电：降到轻量模型，后台任务可暂停或限速。
4. `WARM`：选择均衡模型，后台任务限速。

这些策略会反映在：

```text
ExecutionPlan.modelTier
ExecutionPlan.threadCount
ExecutionPlan.queueAction
ExecutionPlan.reasonCodes
```

## 17. 滞回与防震荡

设计目标：设备状态刚恢复时不要马上升档，避免高低档来回跳。

当前实现文件：

```text
apps/scheduler/src/main/ets/policy/HysteresisController.ets
```

当前逻辑：

1. 降级立即生效。
2. 升级需要等待稳定窗口。
3. 升级不是从轻量直接跳高精度，而是逐级上升。
4. 切换策略模式时会重置滞回状态。

本次补充：如果滞回把模型档位压回 `LIGHTWEIGHT`，后端也同步回到 CPU，避免日志里出现“轻量模型但仍显示 NNRT”的不一致。

## 18. 推理执行管理

当前执行入口有两种：

```ts
runTask(request, executor)
submitTask(request)
```

`runTask` 适合页面内临时任务，传入一个函数作为执行器；`submitTask` 适合已注册的正式执行器。

执行器接口：

```ts
WorkloadExecutor<TInput, TOutput>
```

它需要实现：

```ts
capability
supports(plan)
execute(input, plan, signal)
dispose()
```

后续真实推理模块应该通过 `registerExecutor()` 注册进来，例如：

```text
image_capture_executor
speech_recognition_executor
shoe_attribute_executor
recommendation_rank_executor
```

## 19. 反馈与性能统计

当前 `MetricsSnapshot` 包含：

```text
taskCount
averageLatencyMs
p95LatencyMs
averageQueueDurationMs
degradeCount
failureCount
cancellationCount
policySwitchCount
capturedAt
```

这些指标来自最近一段终态日志。当前默认窗口大小由 `metricsWindowSize` 控制。

本次补充：新增 `getRuntimeMetrics()`，作为 `getMetricsSnapshot()` 的直观别名，更贴近提纲里的对外接口。

## 20. 异常处理与降级回退

当前已经覆盖：

1. 未初始化时报 `NOT_INITIALIZED`。
2. 重复初始化时报 `ALREADY_INITIALIZED`。
3. 配置不合法时报 `INVALID_CONFIG`。
4. 任务参数不合法时报 `INVALID_TASK`。
5. 无可用执行器时报 `CAPABILITY_UNAVAILABLE`。
6. 任务超时报 `TASK_TIMEOUT`。
7. 任务取消时报 `TASK_CANCELLED`。
8. 禁止调试注入时报 `DEBUG_INJECTION_DISABLED`。

后续需要补：

1. 真实模型加载失败后的轻量模型回退。
2. NNRT 执行失败后的 CPU 重试。
3. 系统状态 API 不可用时的默认状态策略。

## 21. 调度日志

当前每个任务会写：

1. 创建日志。
2. 运行日志。
3. 终态日志。

日志结构：

```text
SchedulerLogEntry
```

包含：

```text
taskId
taskType
capability
deviceState
executionPlan
status
queuedAt
startedAt
finishedAt
queueDurationMs
executionDurationMs
totalDurationMs
errorCode
```

最多保留 500 条。页面可以通过 `getRecentLogs(limit)` 读取最近日志，也可以通过 `registerLogCallback()` 订阅实时日志。

## 22. 调试状态注入

设计目标：比赛演示时，不一定每次都能等手机真的发热、低电或 NPU 状态变化，所以需要可控的“模拟状态”。

当前可注入：

```text
batteryPercent
isCharging
thermalLevel
appVisibility
recentLatencyMs
queueDepth
availableBackends
```

本次补充了后两项：

1. `queueDepth`：用于模拟任务拥塞。
2. `availableBackends`：用于模拟 CPU/NNRT 可用性。

这使得演示时可以做出：

```text
正常状态 -> 高精度/NNRT
低电状态 -> 轻量/CPU
高热状态 -> 轻量/CPU/后台暂停
拥塞状态 -> 均衡/后台限速
```

## 23. 当前和提纲的对应关系

| 提纲能力 | 当前状态 | 说明 |
|---|---|---|
| 1. 调度器初始化与销毁 | 已实现 | 本次新增全局暂停/恢复 |
| 2. AI 任务统一封装 | 已实现 | `TaskRequest`、`TaskProfile`、`TaskResult` |
| 3. 任务提交与状态管理 | 已实现 | 本次新增 `getTaskStatus` |
| 4. 多优先级任务队列 | 已实现 | 本次新增队列老化 |
| 5. 设备状态感知 | 已实现 | 本次扩展 NPU/队列调试注入 |
| 6. 调度策略决策 | 已实现第一版 | 自适应、性能、省电三种模式 |
| 7. 模型档位选择 | 已实现计划层 | 真实模型文件待接入 |
| 8. CPU 线程档位选择 | 已实现计划层 | 真实线程参数待执行器落地 |
| 9. QoS 优先级管理 | 已实现应用层 | 系统级 QoS 待后续接入 |
| 10. 推理后端选择 | 已实现计划层 | 本次新增 NNRT/CPU 选择 |
| 11. 并发与资源控制 | 已实现单执行循环 | 多资源并发待扩展 |
| 12. 实时任务优化 | 部分实现 | 类型和优先级已有，帧丢弃待补 |
| 13. 热状态与低电量降级 | 已实现 | 热、低电、温热都有策略 |
| 14. 滞回与防震荡 | 已实现 | 本次修正轻量档后端一致性 |
| 15. 推理执行管理 | 已实现骨架 | 真实推理执行器待接入 |
| 16. 反馈与性能统计 | 已实现 | 平均、P95、队列、失败等 |
| 17. 异常处理与降级回退 | 部分实现 | 任务级异常已做，模型/NNRT 回退待补 |
| 18. 调度日志 | 已实现 | 任务全链路日志 |
| 19. 调试状态注入 | 已实现 | 本次补队列和 NNRT 注入 |
| 20. 对外接口 | 已基本实现 | 本次补齐提纲里的直观接口名 |

## 24. 一切就绪后的中间调度层构建思路

后续建议按这条线继续推进：

```text
ArkUI 页面
-> 把拍照/语音/商品检索封装成 TaskRequest
-> SchedulerService.submitTask()
-> SchedulerPolicy.evaluate()
-> 得到 ExecutionPlan
-> ExecutorRegistry 找到真实执行器
-> 执行器根据 plan 选择模型、线程、CPU/NNRT
-> 返回结果给页面
-> SchedulerLogEntry 和 MetricsSnapshot 展示调度过程
```

建议分三步落地：

1. 先把现有 ArkUI 页面所有“重计算动作”都改成通过 `SchedulerService.runTask()` 或 `submitTask()` 进入调度层。
2. 再补真实执行器，例如图片识别执行器、语音识别执行器、推荐排序执行器。
3. 最后把 `SchedulerPanelPage` 或首页状态栏接到 `getDeviceState()`、`getCurrentPolicy()`、`getRuntimeMetrics()`、`getRecentLogs()`，实现“一边操作购物助手，一边看到调度过程”。

最终展示效果应该是：用户仍然在购物助手前端里拍照、搜索、语音输入、查看推荐；页面底部或侧边有一块调度状态栏，实时显示这次任务用了哪个模型档位、几个线程、CPU 还是 NNRT、为什么升降级、排队多久、执行多久。

## 25. 本次代码改动摘要

本次围绕 scheduler 层做了这些改动：

1. `SchedulerService.ets`
   - 新增 `pause()`、`resume()`、`isPaused()`。
   - 新增 `getTaskStatus(taskId)`。
   - 新增 `getCurrentPolicy()` 和 `getRuntimeMetrics()` 两个直观别名。
   - 调度循环支持全局暂停，暂停时不再消费新任务。

2. `SchedulerTypes.ets`
   - `DebugStatePatch` 新增 `queueDepth`。
   - `DebugStatePatch` 新增 `availableBackends`。

3. `DeviceStateController.ets`
   - 调试注入状态可以覆盖队列深度和可用后端。
   - 校验 `queueDepth` 和 `availableBackends`。

4. `TaskQueue.ets`
   - 新增队列老化机制，避免低优先级任务长期饥饿。

5. `SchedulerPolicy.ets`
   - 根据 `availableBackends` 选择 CPU 或 NNRT。
   - 均衡/高精度档在 NNRT 可用时选择 NNRT。
   - 轻量档和保护场景回 CPU。

6. `SchedulerReasonCode.ets`
   - 新增 `NNRT_BACKEND_SELECTED`。
   - 新增 `CPU_BACKEND_FALLBACK`。

7. `HysteresisController.ets`
   - 滞回降到轻量档时同步使用 CPU。

8. 测试文件
   - 补充调试注入队列/NPU 的用例。
   - 补充 NNRT 选择策略用例。
   - 补充全局暂停/恢复调度循环用例。

## 26. 当前验证状态

已做代码级核对：

1. 搜索确认 `createPlan()` 调用已全部传入设备状态。
2. 搜索确认新增接口和新增状态字段已落到 scheduler 模块。
3. 单元测试文件已同步补充覆盖场景。

本机命令行没有找到可直接调用的 `hvigor` 或 `ohpm`，所以还没有在命令行完成 ArkTS 编译。建议下一步在 DevEco Studio 中执行一次 Build。如果出现 ArkTS 严格类型错误，再按错误行号继续修。
