# AI 任务语义调度 SDK：接入与实现

更新日期：2026-09-21。需求来源：[07-AI任务语义调度件工作要求](07-AI任务语义调度件工作要求.md)、[09-受约束策略闭环](09-HarmonyOS受约束策略闭环实施方案.md)。

本文说明本轮实际代码及边界。旧 API 文档和历史功能介绍中的购物能力名称硬编码、整批索引预热、固定任务类型优先级，不能代表新 `SchedulerClient` 路径。

## 1. 应用接口与依赖方向

```text
应用 UI
  -> 应用自己的适配服务（示例：ShoppingTaskService）
     -> SchedulerClient（模板注册、实例提交、运行信号）
        -> SchedulerRuntime 接口
           -> SchedulerService（策略、队列、执行与审计）
              -> WorkloadExecutor 接口
                 -> 应用提供的模型、数据库或网络实现
```

- `scheduler` HAR 不导入购物页面、Product、StoreManager、MindSpore 模型或模型权重。
- 能力名只是注册标识，不用于猜测业务成本；模板和约束才进入语义策略。
- `SchedulerClient` 接受 `SchedulerRuntime` 接口，便于替换运行实现和测试。`SchedulerService` 可独立实例化；原单例接口保留兼容。
- 多个 Client 共享 Service 时，执行器能力名自动加上 Client 命名空间，同名能力不会串用执行器。
- 应用持有原始输入，SDK 将输入作为不透明对象传递；审计记录不包含原始文本、图片、节点输出或检查点数据。
- 注册模板会创建快照。业务参数不放进 SDK 策略代码，不必给每种 AI 功能增加专用 SDK 方法。

## 2. 三层契约

| 契约 | 由谁提供 | 实际作用 |
|---|---|---|
| `TaskTemplate` | 应用初始化注册 | 能力标识、任务类型先验、执行位置、质量阶梯、隐私、重复策略、中断能力、资源先验；工作流节点引用已注册的叶子模板 |
| `TaskContext` | 每次调用时应用提供 | deadline、freshness、用户是否可见和等待、质量底线、重要度、输入规模、去重键、网络许可；SDK 分配工作流与节点关联 ID |
| `TaskSignal` | 应用在用户操作时发送 | 页面离开、输入替代、取消、等待状态变化、强制高质量、结果展示/消费/忽略 |
| `TaskTelemetry` | SDK 与执行器共同提供 | 排队与执行时延、预测和误差、检查点数、执行器上报的模型版本/后端/线程配置等；未采集的数据不伪造 |

`deadlineMs` 和 `freshnessMs` 均是从整个请求提交时刻起算的相对毫秒数。后续节点和检查点恢复不会重新获得完整时限。`timeoutMs` 限制一个叶子任务累计占用执行器的时间，包含 warmup，不包含排队和暂停。

质量底线使用 `ModelTier` 的顺序：LIGHTWEIGHT < BALANCED < HIGH_ACCURACY。应用负责声明各档真实含义。`highQuality` 要求最高档；无法同时满足保护规则和质量底线时拒绝执行，不偷偷降级。

输入规模字段用于成本估计，不代表 SDK 已理解用户原始内容。结构化约束必须由应用声明；SDK 不解析任意字符串 `metadata` 来推断隐私或业务价值。

## 3. 接入顺序

1. 初始化独立的 `SchedulerService`，接上 `HarmonyDeviceStateAdapter`；也可注入自己的状态来源。
2. 创建 `SchedulerClient(service)`，先注册叶子模板和执行器，再注册引用这些叶子的工作流模板。
3. 调用统一的 `client.submit<TInput, TOutput>(capability, input, context)`，获得 `WorkflowHandle<TOutput>`。
4. 通过 `handle.signal()` 反馈业务事件；只在结果成功且仍属于当前请求时更新页面。
5. 应用退出时先 `await client.dispose()`，再停止状态采集、关闭 Service。

```typescript
// 初始化阶段已注册 my_search 模板及对应 WorkloadExecutor。
const handle = client.submit<string, string>('my_search', query, {
  deadlineMs: 500,
  freshnessMs: 800,
  userVisible: true,
  userWaiting: true,
  accuracyFloor: ModelTier.BALANCED,
  deduplicationKey: 'search-page',
  networkAllowed: false
});

// 用户继续输入、离开页面时及时调用。
await handle.signal({ type: TaskSignalType.INPUT_REPLACED });
// 页面展示结果、用户点击结果时分别发送 DISPLAYED、CONSUMED。
```

完整可编译的接入示例是 `apps/harmony/entry/src/main/ets/services/ShoppingTaskService.ets`。执行器的 `supports()` 必须真实反映支持的档位、后端和线程配置；执行器必须等待所有原生/TaskPool 子工作完成再返回，不能启动后台推理后立即宣告完成。

## 4. 工作流与重复请求

实际购物文本搜索链路为：

```text
query_prepare：等待本地数据就绪，整理文本
  -> text_encode：真实 MindSpore Lite 256 维文本编码
     -> vector_retrieve：TaskPool 对 2700 条向量评分并返回 Top-K 商品
```

节点通过 `WorkflowInput<T>.outputs` 读取自己显式依赖的节点输出。SDK 校验重复节点、缺失依赖、环和输出节点。当前按拓扑顺序串行推进 DAG，不支持嵌套工作流和多节点并行执行。

`CANCEL_WORKFLOW` 使一个节点失败后停止剩余工作；`SKIP_DEPENDENTS` 跳过其后继链，仍允许不依赖它的分支继续。根工作流的隐私限制会传递到叶子节点。

重复策略：

- `KEEP_ALL`：每次请求独立执行。
- `KEEP_LATEST`：同 Client、同能力、同去重键的旧工作流失效，取消排队节点，对运行节点请求停止并丢弃迟到结果。
- `MERGE_EQUIVALENT`：应用必须提供代表等价输入的去重键，SDK 同时比较实例约束，只复用相同约束的未完成作业。SDK 不读取原始输入判等。返回同一个工作流句柄，取消任一共享句柄会取消共享作业；不支持多个订阅者独立取消。

没有去重键的 MERGE 不会合并。业务键不能使用普通页面 ID 来表示不同输入“等价”；索引预热可使用包含模型版本、维度和索引版本的键。

## 5. 检查点、停止和设备保护

后台索引预热每步处理最多 128 条向量，返回单调递增的 `TaskCheckpoint.cursor` 和应用拥有的进度对象。SDK 收到 `completed: false` 后记录检查点、释放执行槽、重新排队，下次出队重新评估设备状态。前台交互可在两个分块之间进入执行。

- 手动暂停可请求正在运行的可检查点任务在当前分块结束后暂停。
- 保护性暂停在设备恢复后自动重评估；手动暂停需显式恢复。
- 正在执行的计划不会被恢复接口改写；新计划只用于后续执行片段。
- 临界温度或内存状态会对语义任务请求停止；底层调用不能安全打断时，等待其返回。
- 超时和取消不是强杀线程。执行槽要等执行器真正返回后才能释放；不合作且永不返回的执行器会阻塞串行队列，应由执行器实现可靠的原生超时。
- 中间进度仅保存在当前进程内，暂不支持进程退出后的持久化恢复。
- 索引缓存只在全部向量处理完成后发布；取消时旧的完整缓存仍可用。这不是任意业务副作用回滚，网络写入、数据库写入仍需应用自己的事务或补偿机制。

`NON_INTERRUPTIBLE` 表示 SDK 不具备检查点恢复能力，也不会强行终止原生调用；请求过期后结果仍会被丢弃。执行器应根据自身能力响应取消信号。

## 6. 策略与预测的实际水平

新语义路径先检查设备保护、隐私、网络、质量底线和过期约束，再对模板质量候选估计时延、内存、相对能耗和风险，选择可行档位与执行配置。

最终队列分值包含：任务类型的少量先验、业务重要度、用户可见和等待状态、截止时间压力、新鲜度压力、预测成本以及等待老化。应用退到后台时，不继续按前台可见/等待状态加分。

预测实现是本地可解释基线：

- 无历史数据时使用应用声明的成本先验，结合输入规模、CPU 负载和热状态，并留出 1.5 倍时延余量。
- 成功执行后按能力、模型版本、质量档、后端、线程、输入规模桶和设备状态桶更新 EWMA 均值及偏差。
- 失败、取消、超时样本不当作成功样本训练；执行器报告的配置与计划不一致时不更新对应计划的预测。
- 检查点任务记录每个片段的预测、实际时间与误差；汇总执行时延不会与单片段预测混为一谈。
- 多次收到结果“被忽略”的信号，会降低无人等待且不可见任务的业务价值加分；不会据此禁止用户明确等待的请求。
- `relativeEnergyCost` 是无量纲估计，不是焦耳；`thermalRisk`、`deadlineMissRisk` 是未校准风险分数，不是经过验证的概率。

尚未训练新的神经网络调度模型，没有未来温度轨迹的物理预测，也没有真机能耗标定。模型权重不属于 SDK 必要依赖，后续可用采集到的结构化遥测替换成本预测器。

当前每次评估关注将要执行的节点/片段。尚未实现整张 DAG 的联合成本优化、跨任务并发规划或端云自动迁移。远端执行需明确注册模板及执行器，网络许可默认不授予；SANITIZED_REMOTE 的脱敏工作由应用完成并声明。

## 7. 模型与演示边界

购物模型仍是文本 Embedding 模型，不是任务语义理解或调度决策模型。编码阶段仍计算完整的 256 维向量；256/64/16 档位主要改变检索阶段使用的维度，不代表三套独立神经模型。

真实执行后端仍为 CPU。MindSpore 线程配置和 TaskPool 分区数会被传入运行时；遥测中的线程值表示执行器使用的配置/并行分区，不是操作系统线程采样结果。

默认购物搜索已走本地任务图，不再在搜索前请求代理归一化接口，也不在每次本地搜索后自动调用云端聊天。旧云端 Provider 作为可选扩展保留。镜头预览仍是交互占位演示，没有新增真实图像识别模型；商品详情点击用于报告结果消费，不再把原样返回 ID 的操作包装为 AI 推理。

## 8. 审计与分发

`client.exportAudit()` / `service.exportAudit()` 返回当前 Service 的有界 JSON 审计记录，含节点关联 ID、策略原因、设备快照、执行计划、预测与实际、终态及失败原因。它不自动写文件或上传网络。同一 Service 多 Client 的审计属于同一进程信任边界；需要隔离日志时使用独立 Service。

`getRecentLogs()` 返回脱离内部状态的快照，应用不能通过修改日志反向篡改 SDK 记录。SDK 默认保留 500 条事件、最近 100 个已完成工作流句柄及有界预测样本。

其他应用只需集成 `scheduler` HAR、声明模板、提供执行器及状态来源。无需携带购物数据库、5.5 MB 的购物模型或本地大模型服务。若自己的业务需要模型，由应用自己的资源目录、模型管理模块或授权远端 Provider 负责部署。

原 `runTask/submitTask/evaluate` 保留为低层兼容 API，缺少新契约时日志标注 `SEMANTICS_UNSPECIFIED`；不应把低层兼容调用当作已获得全部新语义能力。新应用以 `SchedulerClient` 为入口。

测试与仍待验收的部分见 [语义调度验收记录](testing/04-semantic-scheduler-acceptance.md)。

## 9. 可选的受约束配置闭环

为本地叶子 `TaskTemplate` 增加 `manifest`，即可启用新路径；工作流根模板继续描述 DAG，不承担各节点参数。`ExecutionProfile` 必须指定质量级 ID、后端、workerCount、估计质量、前后台支持、保护状态支持、质量验证与低风险标记，可选候选数/维度/批次。所有字段联动执行，不由 HAR 拼装独立数值。应用修改配置语义时必须同时更新模型/契约版本，避免混入旧样本。

宿主通过 `SchedulerService.configureConstrainedPolicy()` 安装可信本地 `ConstrainedPolicyConfig`。同一版本内容不可改变；版本过期、能力不匹配、熔断或用户停用时使用合法 fallback，fallback 也不能突破质量和设备约束。没有可行配置则拒绝；后台资源压力可暂停。学习路径的一跳约束不阻止紧急保护直接回退。

- `OBSERVE`：执行合法基线，采集实际样本，不应用优化建议。硬保护与已声明时限仍生效。
- `SHADOW`：记录合法相邻建议、预测和效用分项，执行配置仍与基线一致。
- `CANARY`：仅对声明为低风险且可检查点的后台任务开放；需要显式窗口/阈值/分流比例、同类基线样本与冷却条件。
- `ACTIVE`：还要求宿主设置 `activeValidated`，各配置仍须 `qualityValidated`。该标记代表宿主提供的验收结论，HAR 不能自行证明质量。

默认策略为 `local-observe-v1`，购物 App 控制台只开放 OBSERVE/SHADOW。API 的 `PolicyMode.ADAPTIVE` 等旧选项与新闭环模式是不同概念：旧模式用于兼容模板，不能覆盖配置包硬约束。

执行器返回遥测必须确认 `profileId`、`actualModelTier`、`actualBackend`、`workerCount` 和配置要求的候选数、维度、批次。`actualThreads` 只用于确知的推理线程配置；TaskPool 上报 `workerCount` 分区数。未确认配置不算成功；调度器也不会在不可中断调用中强改参数。取消后超过 2 秒未返回会触发局部熔断审计，执行槽仍保留到真实返回。

`targetLatencyMs` 是体验目标，`softDeadlineMs` 超出后只标记体验风险；`deadlineMs`/`freshnessMs` 仍按工作流提交时间起算。自动信号不会被当作主观评价，也不会自动放宽目标时延。

宿主显式启用本地反馈后，在 `RESULT_DISPLAYED` 后调用 `client.getFeedbackRequest(handle.workflowId)`，拿到可忽略的单题建议。通过 `handle.signal({ type: TaskSignalType.USER_FEEDBACK, feedback: ... })` 回传请求中允许的枚举。SDK 校验关联 ID、选项、有效期和去重；工作流反馈只关联输出节点，不向每个中间节点复制答案。

`getPolicyMetrics()` 按版本、能力/模型版本、任务类型、输入规模、设备状态、配置、组别输出有界窗口统计；`exportAudit()` 保留预测、实际、反馈与回退原因。P50/P95 预测的冷启动值是声明先验，经验分位数也不是因果收益；热风险/置信度不是概率。

`PolicyStateStore` 由宿主实现，当前 App 使用私有 Preferences。启动读取和后台异步保存熔断/停用/同意/限频摘要，不保存原始任务数据；预测样本和检查点不跨进程恢复。默认不提供网络 Provider；未经验证的远端 JSON 不能直接传给本地策略入口。完整实现调整、测试与真机步骤见 [本轮验收记录](testing/05-constrained-policy-acceptance.md)。
