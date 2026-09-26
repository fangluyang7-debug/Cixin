# Cixin Agent 与 Harmony Agent 共享链路说明

更新日期：2026-09-26。

## 统一边界

两个项目共用 `harmony-agent/apps/harmony` 中的手机 App、调度 SDK 和正式 Zeabur 购物业务链路。`cixin-agent` 不再维护另一套购物 App、商品数据库或云模型代理，它只扩展 Cixin P1 和其他开发板节点的发现、准入、执行与回执。

```text
同一个 Harmony App
  -> 同一套任务画像与手机调度算法
  -> Zeabur harmony-agent Runtime / 购物业务
  -> 可选 Cixin Fleet Runtime
  -> P1 或其他已探测开发板执行器
```

共享部分以 `harmony-agent` 为基准：

- `SchedulerTypes`、`SemanticPolicy` 等通用调度语义；
- TaskGraph 的任务类型、设备画像、网络画像和 `cloudRoutes`；
- 云端执行的客户端分段时延、runId/taskId 关联和执行状态；
- 隐私、截止时间、质量、费用和能源约束的失败关闭原则。

Cixin 独有部分保持不变：

- Linux/ARM64 板卡真实资源采集；
- Cixin P1、其他开发板及 Worker 探测；
- peer Quote、跨板放置、幂等 Attempt、断联对账和取消确认；
- `batteryApplicable=false` 等无电池设备适配；
- 开发板本地执行器及其模型/SDK 契约。

## 本次同步

1. 同步 Harmony 的云端调度语义。远程云模型不再因手机或主控本地发热、低电量、未知后端而被错误降级；临界温度和临界内存仍然阻断任务。
2. 同步 `CloudClientTiming`、`cloudRunId`、`cloudTaskId`，使两个项目使用相同的云执行遥测含义。
3. 同步 Runtime 通用契约：`deviceProfile`、`networkProfile`、`cloudRoutes`、云分段反馈、执行状态与端到端估计字段。
4. Cixin 任务提交可携带共享 App 的 `taskId`，运行记录保存 `clientTaskId`；`POST /api/v1/runtime/runs/:runId/client-telemetry` 可回填请求、上传、下载及字节数。
5. 运行记录继续不保存业务输入，调度盘投影也不展示查询正文、图片、签名 URL 或密钥。

## 当前限制

这次同步没有把 Cixin Fleet 注册为 Zeabur `harmony-agent` 的一个生产执行器，也没有修改 P1/多板协议。要让正式购物任务自动落到 P1，还需在 Zeabur Runtime 增加经过探测的 Cixin 执行器适配器，并为具体购物工具提供板端实现；在此之前，Cixin Runtime 仍只执行自己已注册且探测成功的工具。

同样，`cloudRoutes` 契约对齐不代表 Cixin 已获得数据库、COS 或模型凭据。手机和开发板都不应持有这些密钥，正式业务仍由 Zeabur 服务端访问。
