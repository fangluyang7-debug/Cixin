# 受约束策略闭环 V1 验收记录

日期：2026-09-21。分支：`harmony/mobile-scheduler`。范围：`harmony-agent/apps/harmony` 手机原生 App 与 scheduler HAR。

需求与方案：[09-HarmonyOS受约束策略闭环实施方案](../09-HarmonyOS受约束策略闭环实施方案.md)。项目日志：[03-分阶段开发与验证记录](../03-分阶段开发与验证记录.md#阶段四受约束策略闭环-v12026-09-21)。

## 完成状态

| 阶段 | 代码与本地验证 | 真机/外部条件 |
|---|---|---|
| P0 契约与审计 | 已实现可选 manifest、完整配置校验、目标/软截止、策略版本及执行确认 | 需要第三方 App 接入验证 |
| P1 配置选择与保护 | 已实现一跳选择、硬约束、未知/过期回退、冷却、局部熔断、取消确认监控 | 保护阈值、传感器可用性需目标手机确认 |
| P2 被动观测与反馈 | 已接入真实文本搜索执行器、结果展示/使用/失效信号、本地选择题和限频 | ArkUI 真机交互、数据采集尚待验收 |
| P3 影子和面板 | 已区分基线/建议/实际配置，开放 OBSERVE/SHADOW；统计明确分组 | 尚无影子覆盖率及预测误差实测报告 |
| P4 受控试验 | SDK 已有稳定分流、最小样本、显式停止阈值、试验期限、劣化停止；CANARY 限制可检查点后台任务 | 未开展手机实验；App 未开放真实放量快捷入口；可选云端控制面未实现 |

代码闭环可本地运行；不能据此宣称性能、质量或功耗已经优于基线。

## 验证命令与证据

在 `harmony-agent` 目录执行：

```powershell
./scripts/test-semantic-scheduler.ps1 -DevEcoHome 'E:/DevEco/DevEco Studio'
```

脚本检查 HAR 不含购物业务引用，使用 DevEco 的 ArkTS/Hypium 原生测试链，校验报告是本次生成，声明用例数与实际运行数一致，无失败、错误或忽略。测试完整输出为 [semantic-test-result.txt](semantic-test-result.txt)。

构建使用 DevEco Studio 自带 Node/Hvigor，设置 `DEVECO_SDK_HOME`、`JAVA_HOME` 和 JBR PATH，在 `apps/harmony` 执行：

```text
hvigorw --mode module -p module=scheduler@default -p product=default assembleHar --no-daemon
hvigorw --mode module -p module=entry@default -p product=default -p requiredDeviceType=phone -c properties.enableSignTask=false assembleHap --no-daemon
```

最终结果：`Tests run: 117, Failure: 0, Error: 0, Pass: 117, Ignore: 0`。包括原 65 项、恢复的 9 项执行安全测试及新增 43 项闭环测试。独立 HAR 和不签名 HAP 构建均成功，`git diff --check` 通过。

| 产物 | 大小（字节） | SHA-256 |
|---|---:|---|
| `apps/harmony/scheduler/build/default/outputs/default/scheduler.har` | 167011 | `BCE65862DF695CAD06D8279201FF0960F93D839904136B45474B553E09797BE9` |
| `apps/harmony/entry/build/default/outputs/default/entry-default-unsigned.hap` | 11896136 | `329891481D0B9603C5E189C02B11EE2A0C013246986DA3A7A9D9F8AE6DF2F478` |

保留既有数据库/模型 API 异常处理提示及弃用 UI API 警告；本轮新 Preferences Provider 的异常向 Service 传播，由其停用优化并继续保守调度。未配置签名，构建跳过签名。

`hdc list targets` 返回 `[Empty]`。本轮没有手机或模拟器可执行安装、截图、真实推理耗时或功耗实验。未签名 HAP 只能证明构建成立，不能代替设备验收。

## 关键验证覆盖

- 旧模板兼容及执行器命名空间；不透明输入不会进入 JSON 审计。
- 非法 workerCount、重复配置、未知档位、无效转移和能力不匹配策略被拒绝或回退。
- OBSERVE 执行默认；SHADOW 留下不同建议但不将其传给执行器；零分流比例不执行试验。
- 高质量、热保护、低电量、内存压力、状态未知/过期、前后台可执行性、出队前重评估。
- 冷启动、冷却、版本不可变、过期策略、试验期限、ACTIVE 宿主确认和真实质量底线。
- 策略版本在任务执行中切换时，旧任务使用旧版本失败阈值；测试用执行启动门闩同步，避免把排队阶段的合法重评估当作运行中版本变更。
- 实际配置缺失/不一致、执行器不支持、连续错误、处理组错误率超阈值时局部熔断并使用合法回退。
- 不可中断调用取消后保持槽位；超时、温度保护和失效结果不返回有效输出；超过取消确认等待时间只记录异常，不伪称停止。
- 反馈需要显式启用、结果展示、匹配 taskRunId/选项/有效期，重复答案不覆盖；页面离开、后台和预览/批任务不弹题；按日和能力限频。
- 私有持久化保存熔断与反馈授权摘要；损坏存储不阻断合法任务；审计不包含搜索词。
- 输入规模、模型/契约版本、设备来源与状态、策略版本分层；分块间切换配置/版本/状态的任务标记 MIXED，不纳入单配置非劣比较。
- 恢复 9 项历史执行安全测试；脚本检查所有声明的测试确实运行。

## 真实负载配置

| 节点 | 默认 | 保护回退 | 其他候选与边界 |
|---|---|---|---|
| text_encode | ENCODE_DEFAULT，CPU、同一完整 256 维模型、2 推理线程配置 | ENCODE_SAFE，同模型、1 线程配置 | 不缩减模型前向计算；实际 OS 线程数量未知 |
| vector_retrieve | SEARCH_HIGH，2700 候选、256 维、2 TaskPool 分区 | SEARCH_SAFE，2700 候选、256 维、1 分区 | SEARCH_BALANCED 64 维/2 分区，SEARCH_FAST 16 维/1 分区；降维质量未验收，不能自动放量 |
| index_warmup | WARMUP_128，每块最多 128 条、1 分区 | WARMUP_32，每块最多 32 条、1 分区 | 仅在检查点切换；完整缓存原子发布；分块容量不等于尾批实际条数 |

所有候选数均保留 2700。较小分区数减少并发压力，不保证更快；降维仅减少向量评分计算，不缩短完整 Embedding 前向推理。`qualityValidated` 由 App 声明：等价完整计算标记可用，降维候选标记 false；该标记不是 HAR 自动生成的质量证明。

## 本地存储和隐私

App 侧 `LocalPolicyStore` 使用私有 Preferences，HAR 只依赖 `PolicyStateStore` 接口。保存内容限于策略版本、熔断原因、停用开关、反馈同意与限频摘要。任务输入、图片、Embedding、商品结果与检查点内容不进入该存储；资源预测、滚动任务统计仍在进程内。

默认无网络和遥测上传。调试面板策略用于当次运行；下次启动仍加载宿主固定基线，保存版本与宿主版本不一致时停用优化。没有实现云端签名、下载、自动策略发布或跨用户先验。未来网络 Provider 必须先在 HAR 外完成授权与可信性校验。

反馈按每安装实例而非用户身份限频，UTC 日最多 2 次，同能力/任务类型最多 1 次，间隔 30 分钟，邀请 2 分钟过期。多用户 App 应分开实例/存储。窗口比较只比较同种反馈，不把“偏慢”和“不准确”合成同一种质量结论。

## 下一步真机验收

1. 安装签名 App，检查电量、热状态、内存字段来源和时间戳；确认无法读取时展示未知，10 秒过期不会当作正常状态。
2. 固定模型/数据/设备与版本，分别测完整 1/2 分区的搜索，记录查询集合、Top-K 质量、P50/P95、错误/取消率、热状态；单独记录冷启动与预热后。
3. 在无后台、128 条预热、32 条预热三组条件下重复采样，检查前台让出效果与后台完成代价；MIXED 样本单列。
4. OBSERVE/SHADOW 使用相同基线配置，确认影子建议不会改变真实输出。统计候选合法率、覆盖率和预测误差，不报告反事实“提速”。
5. 在结果展示后体验单题反馈，检查忽略、返回、重复输入、切换后台不会错误弹出或更新旧页面；检查关闭开关与重新启动后的限频。
6. 根据实测结果填写版本化试验的 baseline、rolloutPercent、minimumSampleCount、窗口、最大期限和非劣阈值，先对后台分块开展 CANARY；故意引入错误/延迟验证本地停止。
7. 完成质量与稳定性验收后，宿主才能提供 ACTIVE 批准；普通手机搜索仍默认保留完整质量回退。

当前模型水平：可解释成本先验、有限 EWMA、窗口分位数和有界反馈偏好。没有训练调度神经网络，也没有未来温度物理预测。局部试验停止是工程保护阈值，不是完成统计显著性检验的证明。
