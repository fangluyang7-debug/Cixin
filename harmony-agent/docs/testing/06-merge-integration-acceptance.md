# 拉取冲突整合验收记录

日期：2026-09-21。分支：`harmony/mobile-scheduler`。范围仅限 `harmony-agent`，不修改开发板主线或外层旧鸿蒙工作区。

历史范围：本页对应第一次合并 `4e409af` 的 122 项回归与当时产物；新拉取 `cc12ad4` 的第二轮整合见 [当前验收](07-resource-experiment-integration.md)。共享 semantic-test-result.txt 随最新验证更新。

## 来源与要求

用户要求：整合当前分支新拉取的文件并提交。本次继续已有 Git merge，不重新拣选、重置或覆盖任一分线历史。

| 来源 | 提交 | 内容 |
|---|---|---|
| 共同基线 | `d7c1a2ef98f1da55cb8eb92c1102fa4fd53a0917` | 语义调度 SDK |
| 本地 | `f77b8115ec4cf1c58d8e924914c7239a59f73320` | 受约束策略闭环 V1、配置/反馈/本地存储、117 项回归 |
| 拉取 | `a46d07e0b864987a1dac6d8f40e174afac0634b0` | 包含 `4ccaa19` 执行安全整合、76 项回归及功能缺口核查 |

保留本地 manifest、影子/试验约束、隐私边界、完整质量回退和审计，同时接入上游停止状态、保护重评估、面板状态与共享测试门禁。新拉取的规划及核查文件保留；历史证据不伪装成当前构建结果。

## 重点解决的问题

- 取消、超时、过期、保护与关闭统一发出 STOP_REQUESTED，保持首次停止原因和 stopRequestedAt；等待真实执行结束才输出终态。
- 取消确认看门狗适配 STOP_REQUESTED。超过 2 秒只记录未确认并熔断，不伪装已终止、不提前释放槽位；关闭期间也可读取内部状态快照。
- 全局暂停期间继续检查队列保护，但不开始执行；手动暂停语义不变。
- 支持检查按最终计划从注册表重新寻找执行器，避免把提交时绑定实例当成唯一实现；受约束配置不支持时重评估合法 fallback，保持质量和资源边界。
- 去掉自动合并造成的 ExecutionSafety 重复导入和重复注册；测试脚本委托共享门禁，保留业务解耦扫描与结果归档。
- 对历史核查增加范围更新：新 manifest 路径补齐的能力与旧兼容路径剩余缺口分别说明。

## 测试结果

在 `harmony-agent` 执行：

```powershell
./scripts/test-semantic-scheduler.ps1 -DevEcoHome 'E:/DevEco/DevEco Studio'
```

结果：`Tests run: 122, Failure: 0, Error: 0, Pass: 122, Ignore: 0`。

构成为闭环分线 117 项、上游新增 2 项、本次新增 3 项。最新原始报告：[semantic-test-result.txt](semantic-test-result.txt)。报告新鲜度、声明/执行数量与失败/错误/忽略门禁通过；额外比较源码和报告中的用例名称，122 项一一对应，无重复或遗漏；核心业务依赖扫描通过。

新增用例：`selectsAnotherRegisteredExecutorAfterQueuedPlanChanges`、`queuedUnsupportedProfileTripsCircuitAndUsesLegalFallback`、`criticalStateRejectsQueuedProfileWhileSchedulerRemainsPaused`。原有取消看门狗用例改为核对 STOP_REQUESTED、停止时间及尚未终结。

首轮有 1 项旧断言失败，门禁未归档该失败报告为通过结果。其测试同时设置低电量和高温，却沿用了仅高温的 2 线程预期；按现有策略修正为 1 线程并验证提交时原为 4 线程。单独高温仍由其他用例核对为 2 线程。随后全量重跑通过，没有修改策略来迁就测试。

## 构建证据

使用 DevEco Studio 自带 Node/Hvigor，设置 SDK、JAVA_HOME 和 JBR PATH，在 `apps/harmony` 依次执行：

```text
hvigorw --mode module -p module=scheduler@default -p product=default assembleHar --no-daemon
hvigorw --mode module -p module=entry@default -p product=default -p requiredDeviceType=phone -c properties.enableSignTask=false assembleHap --no-daemon
```

两项均为 BUILD SUCCESSFUL；产物于 2026-09-21 13:59（本机 +08:00）核验：

| 产物 | 大小（字节） | SHA-256 |
|---|---:|---|
| `apps/harmony/scheduler/build/default/outputs/default/scheduler.har` | 168460 | `CF47A1ECE57CA76D560411663921562980D5A584CE8FB6F2F89AF465965DA99C` |
| `apps/harmony/entry/build/default/outputs/default/entry-default-unsigned.hap` | 11901075 | `1721D6FD44A3F94899B77CEA58D2D1E0842D7128ABB785B5146FF8C85DB311AA` |

保留既有数据库/模型 API 异常处理及弃用 UI API 警告；本机没有签名配置，HAP 未签名。构建产物和本地日志不纳入 Git，提交代码、说明及测试报告。

## 尚未验证与剩余缺口

`hdc list targets` 返回 `[Empty]`，未做手机安装、ArkUI 交互、传感器、真实模型耗时/质量或能耗验证。主机替身测试只能证明覆盖的调度逻辑。

本次不扩展为完整补齐 [功能核查清单](../10-手机验证前功能核查与缺口清单.md) 的开发任务。旧面板模拟数据、App 审计文件导出/实验会话、后台公平性和真正的限流预算、查询硬约束等仍未完成。受约束闭环不是神经网络调度器，未实现云端策略发布或系统内核调度。

历史 `verification/stage4-*` 与 [05 闭环验收](05-constrained-policy-acceptance.md) 保留各自分线的结果和哈希；本页才是这次合并的当前验证范围。
