# API Server

NestJS API 服务，承载购物业务插件和 Agentic Runtime 测试接口。所有外部模型、对象存储、数据库托管和授权商品来源都必须显式配置；未配置时接口返回失败或 Runtime 阻断状态。

## 本地启动

```powershell
npm ci
Copy-Item .env.example .env
npm --workspace services/api-server run prisma:generate
npm --workspace services/api-server run db:init
npm run api:dev
```

默认数据库是本地 SQLite。对象存储、模型 API、云数据库和电商 API 不会由代码自动补齐。

## Runtime 接口

- `GET /api/v1/runtime/tools`
- `GET /api/v1/runtime/snapshot`
- `GET /api/v1/runtime/runs`
- `GET /api/v1/runtime/runs/:runId`
- `POST /api/v1/runtime/plan`
- `POST /api/v1/runtime/agent/plan`
- `POST /api/v1/runtime/replan`
- `POST /api/v1/runtime/telemetry`
- `POST /api/v1/runtime/verify`

Runtime 只在平台能力、模型探测、当前资源状态和真实性能样本都满足要求时生成可执行计划。没有 Agent Planner 时，`/agent/plan` 会返回 `AGENT_PLANNER_NOT_CONFIGURED`。

`/plan`、`/agent/plan` 和图片搜索调试入口都会生成 `runId`。后续的 `/telemetry`、`/verify` 和 `/replan` 可以携带同一个 `runId`，运行快照会聚合对应的 taskGraph、executionPlan、候选评估、真实性能样本、验证结果和重规划事件。当前轨迹保存在进程内，服务重启后清空；持久化属于 P1。

接口字段和请求示例见 [`docs/runtime-api-contract.md`](../../docs/runtime-api-contract.md)。

## 业务接口

- `POST /api/v1/assets/images`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions/{sessionId}/candidates`
- `POST /api/v1/sessions/{sessionId}/turns`
- `GET /api/v1/candidates/{candidateItemId}`
- `POST /api/v1/product-pool/import`
- `GET /api/v1/product-pool/products`
- `GET /api/v1/product-pool/stats`

商品导入脚本要求每条记录包含可验证的商品 URL，不会生成 `example.com` 或其他占位地址。商品池应只包含已确认来源的数据。

## 资源状态

详见 [`docs/runtime-resource-gaps.md`](../../docs/runtime-resource-gaps.md)。
