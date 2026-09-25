# Zeabur 数据库、COS 与云任务调度接入

更新：2026-09-25。此文记录本次代码边界；商品数据尚未上传，Zeabur 的持久卷、变量和公网域名仍需以登录后的实际服务页面为准。

## 数据链路

```text
鸿蒙手机 App（本地调度与本地演示数据）
    │ HTTPS /api/v1/...（需要云端业务时）
    ▼
Zeabur api-server（NestJS + Agent Runtime）
    ├─ Prisma → /data/harmony-agent.db（Zeabur 持久卷中的 SQLite）
    ├─ 图片元数据 → SQLite 的 ImageAsset / Product 等表
    ├─ 图片内容 → 腾讯 COS（服务端签名与上传）
    └─ 云模型/API → 已配置并经过真实探测后才可参与调度
```

## 当前完成度

截至 2026-09-25，本轮修改达到的是“云端持久化与云任务可感知”阶段：

| 验收项 | 状态 | 说明 |
| --- | --- | --- |
| Zeabur 容器启动与端口适配 | 已完成 | 读取 `PORT`，监听 `0.0.0.0`，启动前检查生产配置 |
| Zeabur 持久卷保存服务端数据库 | 已完成代码准备 | 当前 Prisma provider 仍为 SQLite，必须把卷挂载到 `/data` |
| COS 图片上传与私有读取 | 已完成代码准备 | 服务端上传、签名读取、超时与错误码已接通；尚未上传正式商品图片 |
| 商品结果返回可展示图片 | 已完成代码准备 | 商品列表、详情、搜索和诊断优先返回短期签名地址 |
| 云任务链路进入调度决策 | 已完成接口 | `cloudRoutes` 会校验驻留、授权、传输、对象存储、排队、费用和有效期 |
| 云任务真实模型探测与远端派发 | 尚未完成 | 供应商探测和手机端 HTTP 派发仍保持阻断，避免伪造可用性 |
| 鸿蒙原生 App 切换到云商品库 | 尚未完成 | 当前仍保留本地商品库作为离线演示；商品数据上传后再做切换验收 |

因此，当前版本可以安全部署并验证服务端云链路，但还不能把它描述为“手机已经把任务自动发往云模型”。

手机不能直接挂载 `/data` 或持有数据库/COS 密钥。原生 App 自带 SQLite 商品库仍用于离线演示与手机调度基准；云端业务数据应经 HTTPS API 访问。本次未把手机本地检索切换成云搜索，因为云库尚无数据，这样切换会使当前示例不可用。这里修改的是服务端开发数据库到 Zeabur 持久卷的**部署链路**，不是假称已完成手机至云端的远程执行。

## Zeabur 部署配置

1. 在 Zeabur 将此仓库分支设为 `codex/cixin-multi-device-runtime`，服务根目录设为 `harmony-agent`。该目录的 `zbpack.json` 负责安装依赖、生成 Prisma Client、构建 NestJS；启动时先检查配置，再执行幂等的初始 SQLite 建表 SQL 和兼容性补丁。
2. 为同一 API 服务挂载**持久卷**到 `/data`，设置 `DATABASE_URL=file:/data/harmony-agent.db`。不能使用 `.env.example` 中的 `file:./harmony-dev.db` 作为云端数据库；容器重建可能丢失未挂载目录的数据。
3. 按 `.env.zeabur.example` 在 Zeabur 环境变量中填写 JWT/维护令牌、COS 地域、三个桶名与服务端密钥。密钥只保存在 Zeabur，不写进 Git、浏览器公开变量或 HAP。可以先配置数据库和令牌启动 API、检查数据库状态；COS 未配置时 readiness 仍返回 503，图片功能不可用。当前 COS 适配器使用标准 `{bucket}.cos.{region}.myqcloud.com` 域名；`OBJECT_STORAGE_ENDPOINT` 不是其生效配置。
4. 连接检测：`GET /api/v1/health` 只证明进程活着；`GET /api/v1/health/readiness` 对 SQLite 执行只读 `SELECT 1`，并确认 COS 配置齐全。返回 `configured_not_probed` **不代表 COS 网络权限或桶 ACL 已验证**。COS 实际读写需等允许的测试对象或正式数据就绪后另测。
5. Zeabur 对外域名确定后，让调用方配置 HTTPS API 基址。`localhost:3100` 仅用于开发机，不是手机或网页可访问的云地址。

代码侧已修正容器监听：API 读取 Zeabur 注入的 `PORT`，绑定 `0.0.0.0`；新建或清空过的 `/data` 卷会由初始建表 SQL 加补丁创建当前 schema。`npm run api:test:cloud-db` 会验证 26 个 Prisma 模型字段和重复启动保留数据。当前 schema 的历史迁移文件仅作版本记录，不在生产启动时与兼容补丁混用。

现有 Prisma schema 与补丁脚本均为 SQLite 专用。如果后续在 Zeabur 新建的是 PostgreSQL/MySQL 实例，而非给 SQLite 挂载持久卷，不能只替换 `DATABASE_URL`；应另做 schema、迁移、查询兼容与回归测试。

## Agent 云任务额外输入与反馈

现有任务画像主要描述模型、算力、质量和隐私；对云端任务还要分清**数据在哪里、怎样抵达执行器，以及链路是否可用**。`TaskIntent.cloudRoutes[]` 现在可按候选执行器提供：

| 字段组 | 用途 |
| --- | --- |
| `inputResidence`、`outputDestination`、`accessMode`、`transferAuthorized` | 区分手机、Zeabur 卷、COS 或外部 API 的输入和结果去向；未明确授权时不选云端 |
| `inputBytes`、`outputBytes` | 估算上下行传输，不把图片和短文本当作同样大小 |
| `roundTripMs`、`uploadMbps`、`downloadMbps`、`storageReadMs`、`storageWriteMs`、`queueMs` | 形成完整链路开销；COS 输入按云端读取计算，不误算为手机上传；输出留在云端时计入存储写入而非手机下行。观测超过 30 秒不使用 |
| `estimatedFeeMinorUnits` | 有任务费用上限时作硬约束；费用未知则不越过上限 |
| `accessExpiresAt` | COS 签名读取元数据，防止计划使用即将过期的链接；任务图**不携带签名 URL 本身** |

云候选的预计完成时间 = 已测云执行段 P95 + 当前链路开销；仅当样本口径为 `execution_only` 时，才可直接用总 P95 作为执行段。历史样本若只包含 `end_to_end` 总时长且没有执行分段，不足以随网络变化重新估算，因此阻断云候选。缺路由、过期链路或未授权传输也会阻断云候选。托管模型 API 不要求读取其不可见的硬件空闲内存，但仍须经执行器可用性、模型探测、真实性能样本和质量条件。当前 `CloudPlatformAdapterService` 尚无提供商专用健康/模型探测，因此仍保守标记云执行器不可用；此接口升级不会自动启动远端任务。

真实执行后，Agent 应上报 `TelemetryRecord.latencyScope` 和 `cloud` 分段反馈：上传、COS/对象读写、排队、执行、下载、输入/输出字节数、费用与提供商状态。取消、失败、超时必须如实标记；失败样本不进入成功时延分位数。仅有 CPU/内存/温度画像无法解释云链路慢、COS URL 失效或 API 限流，也无法区分“模型快但上传慢”和“模型本身慢”。

## 尚待实际接通的边界

- Zeabur 服务的登录后配置、部署根目录、持久卷、环境变量和真实域名不能由仓库代码代替验证；上线后必须检查 `/api/v1/health` 与 `/api/v1/health/readiness`。
- 当前 API 已支持私有 COS 的上传和签名读地址；上传响应及商品/资产展示结果会优先使用短期签名 URL。直写 `imagePublicUrl` 不能作为私有桶展示地址；需要长期展示时应重新获取商品/会话结果，暂不向未认证调用方开放按资产 ID 刷新签名的接口。
- 原生 App 的远端放置仍处于 Shadow，缺实际 HTTP 派发、目标准入/拒绝、epoch 去重、取消确认和手机端授权界面；不能把本次服务端接口等同于两级调度闭环。
- 现有 COS 适配器已有上传与签名读取能力，图片存量迁移、桶访问权限、CORS 和私有桶展示链路须在数据上传阶段验收。
- 链路观测需由实际客户端/服务端采集，不能把声明值伪装成测量值；云端真机/真实网络实验要单独记录 P95、错误率和费用。
