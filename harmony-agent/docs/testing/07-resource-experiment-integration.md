# 第二轮整合：受约束策略与资源实验能力

日期：2026-09-21。分支：harmony/mobile-scheduler。仅修改 harmony-agent。

## 用户要求与来源

用户再次拉取代码后要求继续整合，并强调此前 MD 的策略必须保留或与新创新结合。合并父版本为本地 `4e409af83e35538d8e3de9b53a867636fa0ed5c2` 和拉取的 `cc12ad40e023b6e4e86e089a33464fe9c9290f26`，共同基线 `a46d07e`。没有单侧整文件覆盖或删除双方实现。

以 [受约束策略闭环方案](../09-HarmonyOS受约束策略闭环实施方案.md) 为主框架，第 14 节逐项记录本次结合方式。新文件补齐应用实验工具与通用资源治理，不替换已有受约束策略。

## 保留与结合

| 范围 | 合并后实现 |
|---|---|
| 主策略 | ConstrainedPolicy 继续管理完整 manifest、合法转移、质量下限、四阶段模式、冷启动/冷却、版本与试验停止 |
| 业务解耦 | 品牌价格解析、固定测试语料、模型、导出 UI 均在 App；HAR 不依赖购物对象或文件选择器 |
| 状态 | 公共 sampledAt/TTL 与原来源/known/observedAt 共同保留；CPU/内存 3 秒失效，电池/温度 30 秒失效，闭环原 10 秒观测保护不放宽 |
| 公平与稳定 | 旧语义路径新增升档稳定窗口；manifest 的配置保持/相邻切换不变；公平准入不越过暂停，不抢占不可中断调用 |
| 一致性与停止 | 保留 STOP_REQUESTED、真实结束前占槽、看门狗与熔断；分区失败等待其他工作；严格检索禁止隐式串行替代；serial_fallback 不得冒充一致配置 |
| 真实负载 | Top-K 前品牌/价格规则过滤，保持 2700 件扫描和完整质量默认/保护配置；未经质量验收的降维配置仍不可自动放量 |
| 反馈与存储 | 原结构化反馈、同意与限频、局部熔断、停用、Preferences 接口全部保留；没有新增实时云决策或模型部署依赖 |
| 实验 | 新增真实负载采样、取消、文件选择器导出、CSV 与可选质量统计；分组追踪实际策略/配置/模型/组别/执行路径及前后台来源 |

旧 PolicyMode 的三档标签不是受约束配置的三个处理组。采样工具不会自动批准 CANARY/ACTIVE，不能只按 mode 标签计算闭环提速收益。默认导出 schemaVersion=2，使用固定 queryId，不含搜索原文/结果 ID；显式启用质量评测后才输出固定公共语料的结果 externalId。HAR 审计保持无业务输入输出；所有导出由用户操作 App 完成本地保存，没有自动上传。

## 验证

在 harmony-agent 执行：

```powershell
./scripts/test-semantic-scheduler.ps1 -DevEcoHome 'E:/DevEco/DevEco Studio'
python ./scripts/test-phone-summary.py
```

| 测试 | 结果 | 证据 |
|---|---|---|
| scheduler / Hypium | 137 通过，0 Failure/Error/Ignore | [原始报告](semantic-test-result.txt) |
| entry / Hypium | 12 通过，0 Failure/Error/Ignore | [原始报告](entry-test-result.txt) |
| Python 汇总 | 9 通过 | scripts/test-phone-summary.py，可重复运行 |

两个原生模块均检查报告新鲜度、全部声明用例数和终态；额外核对用例名称一一对应、无重复。前一版 45 项闭环测试全部保留，现在共 47 项，包含 OBSERVE/SHADOW、CANARY/ACTIVE 门槛、质量与隐私底线、回退、反馈、本地存储、运行版本及取消协议。业务依赖扫描通过。

本次交叉回归重点：旧模式不覆盖 manifest 基线；回报字段相同但实际串行回退仍拒绝；部分调试覆盖不能恢复过期真实数据；观测元数据快照不外泄可变引用；内存红线不向上舍入；默认不导出质量结果；版本/配置/执行路径不同不混算；后台注入和缺失后台证据不标记 REAL；无质量授权不伪算零召回。

## 构建

使用 DevEco SDK/JBR 环境，在 apps/harmony 执行：

```text
hvigorw --mode module -p module=scheduler@default -p product=default assembleHar --no-daemon
hvigorw --mode module -p module=entry@default -p product=default -p requiredDeviceType=phone -c properties.enableSignTask=false assembleHap --no-daemon
```

两项 BUILD SUCCESSFUL，2026-09-21 本机核验：

| 产物 | 字节 | SHA-256 |
|---|---:|---|
| apps/harmony/scheduler/build/default/outputs/default/scheduler.har | 172187 | `3080B43DCED183D4464149DC9B33046CCEAD0F4F1A839585FE0A8A829451787C` |
| apps/harmony/entry/build/default/outputs/default/entry-default-unsigned.hap | 11940568 | `55B4BAA895A407F42485CEF0DA4FBC743706710211379132372DDA9BAABA497D` |

构建保留数据库、模型和文件 API 异常提示及弃用 UI API 警告。实验文件异常向页面调用方传播并显示失败；没有把构建成功等同于文件选择器真机成功。产物与本地日志不提交 Git。verification/stage5-* 为新拉取分线的历史证据，不覆盖为本轮结果。

## 尚未完成

hdc list targets 返回 `[Empty]`，未进行真机安装、传感器采样、完整 54 条会话、系统文件选择器、质量召回/功耗或受控试验验证。软件测试中的执行器替身和合成实验记录不能证明手机效果。当前预测仍为可解释先验、EWMA 和有限窗口统计，不是训练后的神经调度模型；无物理温度预测、云端策略签名发布或内核控制。

手机验证按 [操作手册](../11-手机验证操作手册与结果回传.md) 进行；明确区分主机验证、真实配置采样与正式受控试验。
