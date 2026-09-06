# Shopping Assistant Runtime Test App

这是一个用于验证 Agentic Runtime 的购物业务测试插件。购物能力只负责注册工具、提供业务数据和呈现结果；Agent、Scheduler、Platform Adapter 和 Telemetry 负责通用规划、真实资源匹配与运行反馈。

项目不会假设云端平台、模型 API、授权电商接口或 GPU/NPU 已经存在。缺少的资源会让任务进入 `blocked` 状态，并在运行快照中列出原因。

## 目录

```text
apps/mobile-flutter/       # Android Flutter 测试客户端
apps/test-entry-web/       # Web 测试入口和商品池诊断页
services/api-server/       # NestJS + Prisma + SQLite 后端
docs/                      # 架构、接口、运行状态和资源缺口
samples/                   # 已确认来源的商品池样例和本地调试数据
scripts/                   # 本地辅助脚本
```

## 当前边界

- Runtime 协议、工具注册、任务图校验、硬约束过滤、动态评分、滞回和 Telemetry 已落地。
- Shopping Plugin 已注册图片质量、裁剪、Embedding、向量检索、价格查询和回答生成工具。
- 没有真实性能样本时，Scheduler 不会选择执行器。
- `POST /api/v1/runtime/agent/plan` 在没有真实 Agent Planner 时会明确阻断，不会猜测任务图。
- 真实资源缺口见 [`docs/runtime-resource-gaps.md`](docs/runtime-resource-gaps.md)。

## 本地启动

```powershell
npm ci
Copy-Item .env.example .env
npm --workspace services/api-server run prisma:generate
npm --workspace services/api-server run db:init
npm run api:dev
```

另开终端启动 Web 测试入口：

```powershell
npm run web:dev
```

移动端测试客户端：

```powershell
cd <project>\apps\mobile-flutter
flutter devices
flutter run -d <device>
```

连接已由部署者配置的后端时，必须显式提供地址：

```powershell
flutter run -d <device> --dart-define=ENABLE_BACKEND=true --dart-define=API_BASE_URL=http://<configured-api-host>:3000
```

不加 `ENABLE_BACKEND=true` 时，Flutter 只用于本地界面测试，不代表真实后端资源可用。

## Runtime 接口

- `GET /api/v1/runtime/tools`
- `GET /api/v1/runtime/snapshot`
- `POST /api/v1/runtime/plan`
- `POST /api/v1/runtime/agent/plan`
- `POST /api/v1/runtime/replan`
- `POST /api/v1/runtime/telemetry`
- `POST /api/v1/runtime/verify`

商品来源只能使用已授权 API 或经过确认来源的商品数据；`marketplace` provider 未完成真实平台探测前不可调度。图片、数据库、模型 API、对象存储和电商接口均需由部署者配置，仓库不宣称任何云端地址已经部署，也不在示例文件中放置密钥。
