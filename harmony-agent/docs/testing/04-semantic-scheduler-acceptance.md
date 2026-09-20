# AI 任务语义调度：实现与验收记录

日期：2026-09-19。范围：`harmony-agent/apps/harmony`；2026-09-20 已同步到 Cixin 仓库 `harmony/mobile-scheduler` 分支。

最终复核：2026-09-20，已在 `harmony-agent/apps/harmony` 重新执行语义测试、独立 HAR 构建和不签名 HAP 构建，产物与当前分支代码一致。

依据：[07-AI任务语义调度件工作要求](../07-AI任务语义调度件工作要求.md)。接入文档：[08-AI任务语义调度SDK-接入与实现](../08-AI任务语义调度SDK-接入与实现.md)。

## 1. 结论

主要语义调度代码和应用解耦已实现，65 项 Hypium 测试通过。应用 ArkTS 编译及不签名的完整 `assembleHap` 成功。当前不能宣称所有最低验收条件已完成：没有连接真实手机，三类场景的真机功能和性能实验尚未执行；原签名证书已过期，普通签名构建失败。

该版本是可测试的语义调度基线。资源预测仍为先验加本地 EWMA，尚无真机标定的能耗、热预测曲线、违约概率或新训练的调度神经网络。

## 2. 逐条核验

| 要求 | 当前实现 | 验证与边界 |
|---|---|---|
| 统一 SDK 入口及三层契约 | `SchedulerClient`、`TaskTemplate`、`TaskContext`、`TaskSignal/TaskTelemetry` | 模板快照、参数校验、Client 执行器隔离通过测试 |
| 应用接口解耦 | `SchedulerRuntime` 与 `WorkloadExecutor` 接口；应用侧 `ShoppingTaskService` 注册业务画像 | SDK 主代码不存在购物能力名判断或 entry 导入；模型权重与数据库留在应用 |
| 多节点任务图 | 文本整理、MindSpore 编码、向量检索；通用 DAG、依赖输出与失败策略 | 图执行、环检测、分支失败、工作流取消测试通过；真实模型手机执行本轮未验收 |
| 输入替代与仅保留最新 | 同能力和去重键的旧工作流失效；页面用请求代次防止旧结果覆盖 | 排队/运行中替代、迟到结果丢弃通过测试 |
| 同类合并 | 显式等价键加相同实例约束，复用一个工作流 | 等价合并与不同质量不合并通过；共享句柄取消语义需接入方理解 |
| 过期丢弃 | 排队定时过期、出队校验、每个节点及最终交付校验 | 全局暂停时过期、运行中超时/过期通过；非合作执行器要等底层返回 |
| 真正分块检查点 | 每块最多 128 条向量；保存游标和部分范数，末块发布完整缓存 | 检查点暂停恢复不重复、交互插队、保护后恢复通过；仅支持同进程恢复 |
| 出队重评估 | 每次选取任务前重评估全部排队项；执行器接收最新计划 | 设备状态变化、当前计划与实际传参一致通过；不改写已经运行的计划 |
| 动态业务优先级 | 类型先验、截止压力、新鲜度、等待/可见、重要度、预测成本及老化 | 等待中的后台任务优先于无用户价值的前台先验任务，通过测试 |
| 硬约束 | 临界温度/内存、低电量保护、隐私、网络、质量底线 | 本地隐私禁止远端、脱敏声明、网络默认拒绝、质量冲突、临界设备停止通过 |
| 预测反馈及审计 | 本地 EWMA、结构化输入成本、预测/实际误差、分块遥测、结果消费、JSON 导出 | 取消样本不训练、成本随输入变化、消费反馈、日志快照隔离通过 |
| 遥测完整性 | 真实设备状态适配器、SDK 时延、执行器模型/后端/配置报告 | 每任务峰值内存和实际能耗仍未自动测量，不生成虚假数据 |
| 真机三场景验证 | 已具备本地搜索、输入替代与后台预热代码路径；镜头仍为占位演示 | **未完成**：`hdc list targets` 返回空列表；无本轮真机截图、功耗或时延结论 |

## 3. 自动化测试

通过真实 DevEco Hvigor/Hypium 工具链编译并执行 scheduler 测试，不是仅做 TypeScript 转译。

```text
Tests run: 65, Failure: 0, Error: 0, Pass: 65, Ignore: 0
```

- 36 个既有策略/状态/执行管线用例完成回归，其中业务名称硬编码预期已改为通用能力行为。
- 新增 29 个语义契约、工作流、设备/质量/隐私保护、取消竞态、检查点和预测反馈用例。
- 完整测试结果：[semantic-test-result.txt](semantic-test-result.txt)。
- 可重复执行脚本：`scripts/test-semantic-scheduler.ps1`，同时检查 Hvigor 退出状态和测试结果中的 Failure/Error，防止测试断言失败却被构建成功提示掩盖。
- 本轮没有新增或声称完成 entry UI 自动化、MindSpore 真机数值精度和能耗回归。

```powershell
# 在 harmony-agent 目录中执行，路径替换为本机安装位置。
./scripts/test-semantic-scheduler.ps1 -DevEcoHome 'E:/DevEco/DevEco Studio'
```

测试生成的构建日志位于 `docs/testing/semantic-unit-build.log`，受现有日志忽略规则管理。

## 4. 应用构建与签名

工具链使用本机 `E:/DevEco/DevEco Studio` 的 Node、Hvigor、SDK 和 JBR，未改变系统级环境变量或项目签名材料。

普通 `assembleHap`：ArkTS 编译、PackageHap 成功，SignHap 失败。工具报告现有证书 `NotAfter: Sun Aug 09 23:11:35 CST 2026`，原因是证书过期。

使用 Hvigor 支持的命令行配置 `-c properties.enableSignTask=false` 执行不签名构建，完整 `assembleHap` 成功。注意 `-p enableSignTask=false` 是额外属性，不能替代此内部配置开关。

```powershell
$env:DEVECO_SDK_HOME='E:/DevEco/DevEco Studio/sdk'
$env:JAVA_HOME='E:/DevEco/DevEco Studio/jbr'
$env:Path='E:/DevEco/DevEco Studio/jbr/bin;' + $env:Path
# 工作目录：harmony-agent/apps/harmony
& 'E:/DevEco/DevEco Studio/tools/node/node.exe' `
  'E:/DevEco/DevEco Studio/tools/hvigor/bin/hvigorw.js' `
  --mode module -p module=entry@default -p product=default `
  -c properties.enableSignTask=false assembleHap --no-daemon
```

未签名产物：`apps/harmony/entry/build/default/outputs/default/entry-default-unsigned.hap`。它用于构建验证，不能被描述为已完成可安装真机交付。构建仍有既有数据库异常处理、废弃 UI API 等警告。

独立 `assembleHar` 构建也已通过。检查 HAR 包目录后，确认包含 `SchedulerClient` 和语义策略的公开声明，不包含购物模型 `.ms` 或 Product/Shopping 业务实现。

| 产物 | 大小 | SHA-256 |
|---|---:|---|
| `apps/harmony/scheduler/build/default/outputs/default/scheduler.har` | 114060 字节 | `3226EAF9E05CFFA10001EDCF8C146D441FE5E2B6A14ECEC294420ED4ABD3AE1C` |
| `apps/harmony/entry/build/default/outputs/default/entry-default-unsigned.hap` | 11682958 字节 | `81323385F2760D0C03FE0B1420A7EE61BFF6843C1701F2AE59FA55969EC48D4F` |

本次实际生成的 HAR 约 111 KiB，模型部署属于接入应用的职责。构建日志分别为 `semantic-har-build.log` 与 `semantic-hap-unsigned-build.log`，不修改工程的正常签名配置。

## 5. 真机验收待办

1. 更新 DevEco 调试签名并连接授权测试手机，重新构建安装；记录设备、系统版本、模型版本及实验起始状态。
2. 实时交互：连续修改/替换输入、离开页面，确认旧输出不覆盖新请求，记录取消响应时间和过期比例。镜头占位不能作为真实图像推理验证。
3. 主动搜索：运行真实三节点文本搜索，对比固定性能、固定省电、自适应；记录队列时延、端到端 P50/P95、各档 Top-K 质量与预测误差。
4. 后台预热：在真实索引上暂停/恢复并同时发起搜索，确认游标连续、前台在块间获得执行机会、最终缓存与完整重建一致。
5. 设备保护：用可复现的合法状态注入检查策略，用真实可公开设备状态验证集成；区分模拟保护结果与真实温度/功耗测量。
6. 根据真机样本校正先验，再决定是否训练轻量预测模型；目前不能宣称已有量化的性能或节能提升。

## 6. 本轮不应宣称的能力

- 自动理解任意应用业务或自动扫描其他应用 AI 操作。
- 真实图像商品识别、新的多模型调度网络、NPU/GPU 实测切换。
- 操作系统线程抢占、杀死其他应用、跨进程快照恢复或任意业务自动回滚。
- 经过标定的焦耳能耗、未来温度轨迹、准确的截止违约概率。
- 整图联合最优调度、节点并行、多设备调度和自动端云迁移。

以上边界不影响本轮已实现的应用内业务语义调度，但必须与后续研究目标分开记录。
