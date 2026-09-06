# API Tests

## Automated suites

- `unit/`：确定性业务规则测试，不启动 HTTP 服务或访问外部服务。
- `e2e/`：启动完整 Nest 应用，使用临时 SQLite 数据库通过 Supertest 验证 HTTP 契约。
- `helpers/create-test-app.ts`：复用生产应用的 body parser、CORS 和异常过滤器配置。
- `global-setup.cjs` / `global-teardown.cjs`：创建、初始化并清理 `prisma/test.db`。

本地运行：

```powershell
npm run api:test:unit
npm run api:test:e2e
npm run api:test:ci
```

`api:test:ci` 会依次执行单元测试、API E2E、缓存 smoke 和会话路由 smoke。
测试环境不会读取生产数据库，也不会调用未显式配置的云模型、对象存储或外部 API。

依赖外部网络、模型、共享数据或付费资源的联调必须由操作者显式提供配置，不属于默认测试套件。

## Day 1 P0

- `day1-p0-flow.http`：给前端和接口调试工具使用的主链路请求示例。
- `../../scripts/api-smoke-day1.ps1`：本地自动 smoke，覆盖 health、图片登记、会话创建、会话读取、候选列表、详情、建议、多轮筛选、fallback 和两个错误契约。
