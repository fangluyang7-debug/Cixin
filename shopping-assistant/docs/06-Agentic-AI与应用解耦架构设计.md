# Agentic AI 与具体应用解耦架构设计

更新日期：2026-09-06

## 1. 文档目标

本文说明如何将 Agentic AI、资源调度器和具体应用解耦。

当前项目中的 `SoleAI Shopping Assistant` 只作为一个实践应用，用于验证通用 Agent Runtime 的能力。未来即使替换为日历助手、文档助手、医疗图像助手或旅行助手，也不应重新编写整套硬件调度、资源监测和平台适配逻辑。

核心目标是：

```text
应用只提供业务工具和能力描述
Agent 负责理解目标、拆解任务和重新规划
Scheduler 负责资源匹配、安全执行和降级
Platform Adapter 负责适配不同硬件和操作系统
Executor 负责真正执行计算
```

## 2. 核心结论

Agent 不应该在用户每次发起请求时重新阅读任意 App 源代码，然后猜测任务需求。

更可靠的方式是：

```text
App 通过统一协议注册工具
→ 工具声明输入、输出、质量和资源需求
→ Agent 根据用户目标组合工具
→ Scheduler 根据当前平台能力落地执行
→ Telemetry 返回真实运行结果
→ Agent 根据结果继续执行或重新规划
```

因此：

> Agent 决定“我要完成什么，以及任务如何组织”；Scheduler 决定“当前设备能不能这样做，以及具体如何执行”。

## 3. 总体架构

```text
┌────────────────────────────────────┐
│        Agent Core                  │
│  目标理解、任务拆解、工具选择、重规划 │
└────────────────┬───────────────────┘
                 │ TaskGraph
┌────────────────▼───────────────────┐
│        Resource-Aware Scheduler     │
│  能力匹配、硬件选择、状态监测、降级   │
└────────────────┬───────────────────┘
                 │ ExecutionPlan
┌────────────────▼───────────────────┐
│        Platform Adapter             │
│ HarmonyOS / CIX P1 / Linux / Cloud │
└────────────────┬───────────────────┘
                 │
┌────────────────▼───────────────────┐
│        Executor                    │
│ CPU / GPU / NPU / Network / Storage│
└────────────────────────────────────┘
```

### 3.1 各层职责

| 层级 | 主要职责 | 不应承担的职责 |
|---|---|---|
| App | 提供业务数据、页面和工具实现 | CPU/GPU/NPU 选择、温控和任务排队 |
| Tool Registry | 声明工具的输入、输出、约束和质量要求 | 直接指定某个开发板后端 |
| Agent Core | 理解用户目标、拆解任务、选择工具、重新规划 | 直接控制底层硬件 |
| Scheduler | 检查资源、选择执行路径、排队、降级、超时和恢复 | 理解购物、日历等具体业务 |
| Platform Adapter | 读取平台硬件和运行时能力 | 负责业务流程 |
| Executor | 调用 CPU、GPU、NPU、网络或存储完成任务 | 决定整个业务任务图 |
| Telemetry | 收集延迟、内存、温度、网络和质量结果 | 代替 Agent 进行业务推理 |

## 4. App 只作为业务插件

Shopping Assistant 应该被封装为一个业务插件：

```text
ShoppingPlugin
├── image.quality_check
├── image.crop
├── image.embedding
├── text.embedding
├── catalog.vector_search
├── catalog.price_query
└── answer.generate
```

未来可以替换为：

```text
CalendarPlugin
MedicalImagePlugin
DocumentAssistantPlugin
TravelAssistantPlugin
```

Agent Core、Scheduler Core 和平台适配层不需要因为应用变化而重写。

## 5. 工具注册协议

每个 App 不直接告诉 Scheduler 使用 CPU、GPU 还是 NPU，而是注册工具描述。

示例：

```json
{
  "toolId": "image.embedding",
  "description": "将商品图片转换为检索向量",
  "inputType": "ImageRegion",
  "outputType": "Embedding",
  "quality": {
    "requiresConfidence": true,
    "minimumConfidence": 0.75
  },
  "constraints": {
    "privacy": "high",
    "localPreferred": true,
    "maxLatencyMs": 300
  },
  "resourceHints": {
    "computeClass": "neural_inference",
    "estimatedMemoryMb": 512
  }
}
```

工具描述中不应该写：

```json
{
  "backend": "NPU"
}
```

因为 NPU 是具体平台上的资源选择，不是 Shopping Assistant 的业务约束。

### 5.1 工具描述应包含的内容

```text
工具 ID 和版本
输入数据类型
输出数据类型
前置条件
后置条件
质量要求
隐私要求
延迟预算
是否允许本地执行
是否允许云端执行
预估数据量
预估内存
可否暂停
是否支持重试
失败后的补偿动作
```

## 6. Agent 如何拆解任务

用户输入：

```text
帮我找出图片里的鞋，预算 500 元以内，并比较最新价格。
```

Agent 可以生成逻辑任务图：

```text
目标理解
  ↓
图片质量评估
  ↓
必要时裁剪或调整分辨率
  ↓
图片 Embedding
  ↓
商品向量检索
  ↓
预算过滤
  ↓
实时价格查询
  ↓
结果排序
  ↓
生成说明
```

Agent 负责决定：

```text
需要哪些任务
任务之间的依赖关系
哪些任务可以并行
是否需要重试
是否需要追问
是否需要转云端
是否需要重新规划
```

例如：

```text
本地商品检索
云端商品检索
```

可以在图片 Embedding 完成后并行执行。

而：

```text
价格查询
```

可以等 Top-K 商品生成后再执行。

## 7. Agent 与 Scheduler 的协作流程

Agent 生成的是逻辑任务：

```json
{
  "task": "image.embedding",
  "input": "image_region_001",
  "constraints": {
    "localPreferred": true,
    "privacy": "high",
    "maxLatencyMs": 300
  }
}
```

Scheduler 查询当前平台能力：

```text
当前平台：
- CPU：12 核
- GPU：可用
- NPU：可用
- 内存剩余：2.1GB
- NPU 支持当前模型：是
- NPU P95 延迟：38ms
- 温度：正常
```

然后生成实际执行计划：

```json
{
  "task": "image.embedding",
  "placement": "local",
  "backend": "NPU",
  "model": "image_embedding_int8",
  "reason": [
    "满足隐私要求",
    "NPU 支持该模型",
    "内存充足",
    "P95 延迟满足预算"
  ]
}
```

如果换到另一个平台：

```text
NPU 不存在
→ GPU 支持该模型
→ 使用 GPU
```

如果 GPU 也不支持：

```text
→ 使用 CPU 轻量模型
```

如果本地内存不足：

```text
→ 转云端
```

## 8. 平台自动适配

Agent Core 和 Scheduler Core 不应直接依赖某个操作系统或开发板 API。

建议定义统一的 `PlatformAdapter`：

```ts
interface PlatformAdapter {
  getStaticProfile(): Promise<PlatformProfile>;
  getRuntimeState(): Promise<RuntimeState>;
  discoverExecutors(): Promise<ExecutorDescriptor[]>;
  probeModel(request: ModelProbeRequest): Promise<ModelProbeResult>;
}
```

不同平台提供不同实现：

```text
HarmonyPlatformAdapter
CixP1PlatformAdapter
LinuxPlatformAdapter
CloudPlatformAdapter
```

Scheduler Core 只依赖统一接口，不直接依赖：

```text
HarmonyOS API
Linux sysfs
NeuralONE API
MindSpore Lite API
具体开发板型号
```

平台适配器负责把底层信息翻译成统一格式：

```json
{
  "platformId": "cix-p1-orion-o6",
  "backends": [
    {
      "type": "NPU",
      "available": true,
      "supportedModels": ["image_embedding_int8"],
      "memoryAvailableMb": 2048
    }
  ]
}
```

## 9. 硬件能力发现

平台能力需要分三层。

### 9.1 静态能力

```text
CPU 核心数
GPU/NPU 是否存在
内存大小
支持的模型格式
Runtime 版本
存储和网络接口
```

### 9.2 模型能力

```text
模型是否支持 NPU
是否支持 INT8/FP16
是否包含不支持的算子
是否发生 CPU fallback
模型峰值内存
输入尺寸是否满足要求
```

### 9.3 动态状态

```text
CPU/GPU/NPU 利用率
温度
剩余内存
任务队列
网络延迟
网络吞吐
电量
磁盘空间
```

只有三类信息结合后，Scheduler 才能生成可靠的执行计划。

## 10. 资源不足处理

Scheduler 不是简单执行 Agent 命令，而是要进行多阶段保护。

### 10.1 执行前检查

```text
模型预计需要 800MB
当前可用内存只有 500MB
→ 禁止启动该模型
```

候选处理方式：

```text
换轻量模型
降低输入分辨率
减少并发
转云端
延迟到后台执行
```

### 10.2 执行中监控

长任务必须拆成检查点：

```text
处理第 1 批
→ 检查内存和温度
→ 处理第 2 批
→ 再次检查
```

如果资源恶化：

```text
暂停后台任务
停止下一批
切换轻量模型
转移后续阶段
```

正在执行的单次 NPU 算子通常不能直接迁移到 GPU。更现实的做法是在任务阶段边界进行：

```text
取消
降级
重新规划
```

### 10.3 执行后验证

不能只判断任务是否返回成功，还要检查：

```text
延迟是否超预算
模型置信度是否足够
结果数量是否足够
检索相似度是否达标
网络数据是否过期
```

如果结果不合格，Agent 再决定：

```text
重新裁剪
更换分辨率
更换模型
扩大检索
转云端
向用户追问
```

## 11. Agent 是否需要大模型

需要，但不应该让大模型直接控制硬件。

### Agent 大模型负责

```text
理解用户目标
拆解任务
选择工具
判断是否追问
根据结果重新规划
```

### 确定性 Scheduler 负责

```text
检查硬件
检查内存
选择后端
控制并发
处理超时
执行降级
触发安全回滚
```

大模型擅长语义理解和多步规划，但不适合直接负责内存安全、实时资源保护、线程数量和底层硬件调用。

## 12. 当前项目需要解耦的部分

当前 Scheduler 中存在购物业务耦合，例如：

```text
camera_lens_realtime
image_product_embedding_search
text_product_embedding_search
background_index_update
```

这些能力目前直接写在：

[SchedulerPolicy.ets](../../apps/scheduler/src/main/ets/policy/SchedulerPolicy.ets)

应改为：

```text
SchedulerPolicy 不认识购物业务
ToolRegistry 提供任务描述
Agent 或 App 插件提供工具
Scheduler 只处理通用约束
```

当前 `EntryAbility.ets` 还直接把商品 Embedding 执行器注册为 CPU：

[EntryAbility.ets](../../apps/entry/src/main/ets/entryability/EntryAbility.ets)

目标应改为：

```text
App 注册 image.embedding 工具
PlatformAdapter 注册 CPU/GPU/NPU 执行器
Scheduler 自动匹配可执行后端
```

当前 `TaskRequest` 要求业务代码直接指定：

```ts
inferenceLocation
capability
latencyBudgetMs
```

建议逐步引入：

```ts
interface TaskIntent {
  toolId: string;
  input: unknown;
  constraints: TaskConstraints;
}
```

其中执行位置应抽象为：

```text
AUTO
LOCAL_ONLY
CLOUD_ONLY
LOCAL_PREFERRED
CLOUD_PREFERRED
```

业务代码不应直接指定 CPU、GPU 或 NPU。

## 13. 推荐的通用任务模型

```text
TaskIntent
├── toolId
├── inputRef
├── outputType
├── constraints
│   ├── deadline
│   ├── privacy
│   ├── locality
│   ├── quality
│   ├── energyBudget
│   └── costBudget
├── dependencies
├── checkpointPolicy
└── fallbackPolicy
```

任务意图只表达“希望完成什么”和“必须满足什么”，不表达具体后端。

## 14. 推荐的 Agent 执行闭环

```text
用户目标
  ↓
Agent 理解目标
  ↓
读取 ToolRegistry
  ↓
生成 TaskGraph
  ↓
Scheduler 检查平台能力
  ↓
生成 ExecutionPlan
  ↓
Executor 执行
  ↓
Telemetry 收集结果
  ↓
验证质量和资源状态
  ↓
Agent 继续执行或重新规划
```

可以概括为：

```text
plan
→ execute
→ observe
→ verify
→ replan
```

## 15. 推荐开发顺序

### P0：建立通用协议

新增：

```text
ToolDescriptor
TaskIntent
TaskGraph
PlatformProfile
RuntimeState
ExecutionPlan
TelemetryRecord
```

### P1：移除业务耦合

将购物能力从 `SchedulerPolicy` 中移出，改为由 Shopping Plugin 注册。

### P2：建立工具注册表

将当前图片识别、Embedding、商品检索、价格查询和答案生成封装成工具。

### P3：建立平台适配层

实现：

```text
HarmonyPlatformAdapter
CixP1PlatformAdapter
CloudPlatformAdapter
```

### P4：实现 Agent Runtime

增加：

```text
目标理解
任务拆解
工具调用
结果验证
失败恢复
重新规划
```

### P5：接入真实硬件

完成：

```text
模型后端探测
CPU/GPU/NPU 执行验证
内存和温度监测
真实延迟采集
网络状态采集
```

### P6：构建 Runtime 测试演示

演示内容：

```text
用户提出目标
→ Agent 自动生成任务图
→ Scheduler 根据平台能力选择执行路径
→ 已连接的真实平台执行
→ 结果质量不足时自动重试
→ 资源不足时自动降级或转云
→ 最终返回结果并展示完整执行轨迹和阻断原因
```

## 16. 最终项目定位

项目不应被描述为：

```text
为购物助手写了一套固定的 CPU/GPU/NPU 调度规则
```

更准确的定位是：

```text
构建一个与具体业务解耦的 Agentic Runtime。
应用只声明工具和任务能力；
Agent 根据用户目标生成任务图；
Scheduler 根据当前平台的硬件、模型、内存、温度和网络状态
自动选择可执行方案；
Telemetry 将真实运行结果反馈给 Agent，
驱动后续任务继续执行、降级、重试或重新规划。
```

最终模型是：

```text
App = 业务插件
Tool Registry = App 能力说明
Agent = 目标理解和自主规划
Scheduler = 通用资源管理和安全执行
Platform Adapter = 平台翻译层
Executor = 具体执行实现
Telemetry = 运行结果反馈
```

购物助手只是验证该 Runtime 的实践平台，而不是 Scheduler 的业务边界。


调度权重问题：
1. 硬约束和权重的区别
硬约束
不满足就直接淘汰：
模型不支持 NPU
内存不足
违反隐私要求
预计 P95 超过最大时延
后端当前不可用
数据不能离开本地
例如：
图片隐私等级为 HIGH
→ 云端候选直接淘汰
权重评分
只用于比较剩下的可行方案：
CPU、GPU、NPU 都能完成任务
→ 比较谁更快、更省电、更稳定
因此流程是：
候选方案
→ 硬约束过滤
→ 指标归一化
→ 权重评分
→ 选择最高分
2. 先把实际指标归一化
不同指标不能直接相加：
延迟：几十毫秒
内存：几百 MB
功耗：几瓦
准确率：0 到 1
需要统一转换成 0 到 1 的得分。
延迟得分
延迟越低越好：
latencyScore =
  clamp((worstLatency - predictedP95) /
        (worstLatency - bestLatency), 0, 1)
其中：
predictedP95：该后端实测 P95 延迟
bestLatency：当前候选中的最好延迟
worstLatency：当前候选中的最差延迟
质量得分
qualityScore =
  clamp((predictedQuality - minQuality) /
        (maxQuality - minQuality), 0, 1)
质量可以来自：
识别准确率
Recall@K
Top-1 相似度
OCR 置信度
Agent 任务完成率
能耗得分
energyScore =
  clamp((maxEnergy - predictedEnergy) /
        (maxEnergy - minEnergy), 0, 1)
稳定性得分
reliabilityScore = 1 - failureRate
也可以综合：
reliabilityScore =
  0.6 × successRate
+ 0.4 × noFallbackRate
3. 评分公式
硬约束筛选之后，可以使用：
totalScore =
    wLatency × latencyScore
  + wQuality × qualityScore
  + wEnergy × energyScore
  + wReliability × reliabilityScore
要求：
wLatency + wQuality + wEnergy + wReliability = 1
例如前台图片搜索的初始策略：
wLatency     = 0.40
wQuality     = 0.30
wEnergy      = 0.15
wReliability = 0.15
这表示：
前台响应速度最重要
识别质量其次
同时考虑功耗和稳定性
4. 初始权重应该怎么给？
初始权重可以先由任务目标决定，但必须标记为“经验先验”。
前台实时任务
例如拍照识别：
延迟：0.45
质量：0.30
稳定性：0.15
功耗：0.10
用户主动搜索
质量：0.40
延迟：0.30
稳定性：0.20
功耗：0.10
后台批处理
功耗：0.35
吞吐量：0.30
温度稳定性：0.25
单次延迟：0.10
低电量状态
动态调整为：
功耗：0.40
温度稳定性：0.30
质量：0.20
延迟：0.10
但注意：隐私、模型支持和内存容量通常应该作为硬约束，而不是普通权重。
5. 权重不能固定不变
权重应该根据运行环境动态调整。
例如基础权重：
latency = 0.40
quality = 0.30
energy = 0.15
reliability = 0.15
如果预测延迟已经超过预算：
latencyPressure =
  max(0, predictedP95 / latencyBudget - 1)
然后增加延迟权重：
wLatency =
  baseLatencyWeight ×
  (1 + latencyPressure × 0.8)
如果电量低或温度高：
wEnergy =
  baseEnergyWeight × 1.5
如果用户选择“高质量优先”：
wQuality =
  baseQualityWeight × 1.5
最后重新归一化：
sum = wLatency + wQuality + wEnergy + wReliability

wLatency /= sum
wQuality /= sum
wEnergy /= sum
wReliability /= sum
这样权重是：
任务类型
+ 用户偏好
+ 当前设备状态
+ 当前性能压力
共同决定的。
6. 一个具体计算例子
假设 CPU、GPU、NPU 都通过了硬约束。
归一化后的指标如下：
后端	延迟	质量	能耗	稳定性
CPU	0.65	0.90	0.80	0.98
GPU	0.90	0.90	0.55	0.95
NPU	0.96	0.88	0.92	0.90


前台任务权重：
延迟：0.40
质量：0.30
能耗：0.15
稳定性：0.15
计算：
CPU =
0.65×0.40 + 0.90×0.30 + 0.80×0.15 + 0.98×0.15
= 0.795

GPU =
0.90×0.40 + 0.90×0.30 + 0.55×0.15 + 0.95×0.15
= 0.825

NPU =
0.96×0.40 + 0.88×0.30 + 0.92×0.15 + 0.90×0.15
= 0.912
所以选择：
NPU
但如果设备温度较高，能耗权重提高：
延迟：0.30
质量：0.25
能耗：0.30
稳定性：0.15
可能 CPU 或 NPU 的结果发生变化。这个选择不是固定的，而是跟着运行状态变化。
7. 权重最终如何通过真实数据获得？
建议建立性能样本：
任务类型
后端
模型版本
输入尺寸
数据量
P50 延迟
P95 延迟
内存峰值
功耗
温度变化
准确率
失败率
Fallback 次数
例如：
{
  "task": "image.embedding",
  "backend": "NPU",
  "model": "image_embedding_int8",
  "inputSize": "224x224",
  "p50LatencyMs": 21,
  "p95LatencyMs": 36,
  "memoryPeakMb": 420,
  "energyMah": 0.8,
  "quality": 0.91,
  "failureRate": 0.01
}
然后采用以下方式校准权重：
方法一：基准测试校准
对 CPU、GPU、NPU 分别测试，观察在不同任务下哪个方案实际更好，再调整权重，使评分排序接近真实最优排序。
方法二：用户偏好校准
用户选择：
速度优先
质量优先
省电优先
隐私优先
这些偏好直接映射成权重模板。
方法三：在线反馈校准
每次任务结束后记录：
预测延迟
实际延迟
预测后端
实际质量
是否发生降级
如果 NPU 经常预测很快但实际很慢，就降低它在该任务上的性能估计，而不是盲目修改全局权重。
8. 不建议只用单一权重分数
如果两个方案分数非常接近：
NPU：0.812
GPU：0.809
不应该每次都切换后端。
建议增加：
最小切换收益
例如：
新方案分数必须高出当前方案 5%
才切换：
newScore > currentScore × 1.05
同时保留：
最短保持时间
滞回机制
连续多次确认
这可以防止 CPU、GPU、NPU 来回震荡。
9. 对当前 Scheduler 的具体建议
当前代码中的：
runtimeProfile.score
backendPreference
0.42
0.24
0.20
0.14
目前属于人工经验值，不能当作真实硬件性能结论。
建议改成：
1. 任务描述提供目标权重模板
2. PlatformAdapter 提供硬件能力
3. PerformanceRegistry 提供真实测量结果
4. Scheduler 先做硬约束过滤
5. Scheduler 再执行动态评分
6. 任务完成后更新实际性能模型
最终决策应为：
候选执行器
→ 硬约束过滤
→ 读取真实性能档案
→ 指标归一化
→ 根据任务目标生成权重
→ 计算综合得分
→ 应用滞回和切换阈值
→ 选择执行器
一句话总结：
权重不是为了证明某个硬件永远更强，而是把当前任务的目标转化为可计算的偏好；权重的初始值来自任务策略，最终值必须由 P1 真机数据、用户偏好和运行反馈共同校准。
