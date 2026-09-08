# Agentic Runtime 本地端云协同操作文档

更新日期：2026-09-07

## 1. 当前项目定位

当前阶段暂时没有此芯开发板在手，因此先用电脑同时承担开发板和显示器的角色：

```text
电脑 = 临时开发板 + 本地 API 服务 + 调度盘显示器 + 开发调试环境
```

但项目架构不能写死为电脑本地能力。电脑只是一种临时 Edge Platform，后续需要能够平滑替换或扩展为：

```text
此芯 CIX 开发板
HarmonyOS 设备
Linux 开发板
其他 CPU/GPU/NPU 边缘设备
云端模型资源
云端向量检索资源
云端数据库资源
```

项目核心不是做一个公网购物应用，而是验证一个可解耦的 Agentic Runtime：

```text
Shopping Assistant = 业务测试应用
Agent = 目标理解和任务拆解
Scheduler = 资源感知调度
Platform Adapter = 平台能力抽象
Executor = 具体执行器
Telemetry = 真实性能记录
Runtime Monitor = 调度盘和轨迹展示
```

## 2. 推荐演示形态

最终面向评委的演示不一定需要线上公网访问。更合适的形态是本地现场演示：

```text
电脑浏览器 / Flutter 界面
  -> 本地 NestJS Runtime API
  -> 当前电脑 Host Adapter 或未来此芯开发板 Adapter
  -> 本地缓存 / 云端 PostgreSQL / COS / 云模型
  -> 调度盘实时展示底层调度过程
```

电脑当前临时代替开发板；后续接入此芯开发板时，电脑主要负责显示 UI 和调度盘。

## 3. 当前部署建议

### 3.1 当前无开发板阶段

```text
NestJS API：运行在电脑本地
Runtime Monitor：运行在电脑本地 Web 页面
PostgreSQL：可以本地 Docker，也可以云端托管
对象存储：腾讯云 COS 或本地文件存储适配器
向量检索：本地小索引优先，云端大索引作为可选能力
模型 API：按供应商配置，必须有健康检查和模型探测
开发板：暂时由电脑 Host Adapter 代替
```

### 3.2 后续有此芯开发板阶段

```text
电脑：显示 UI、调度盘、开发控制台
此芯开发板：提供真实 CPU/GPU/NPU、模型运行时、内存、温度和执行器
NestJS API：可继续跑在电脑本地，也可迁移到开发板
云端 PostgreSQL：保存大商品池、长期运行轨迹和性能样本
腾讯云 COS：保存图片、裁剪图、演示素材和 APK
```

### 3.3 多开发板扩展阶段

每新增一种开发板，只新增对应的 Platform Adapter 和 Executor，不改购物业务逻辑：

```text
CixP1PlatformAdapter
HarmonyPlatformAdapter
LinuxBoardPlatformAdapter
AndroidDevicePlatformAdapter
CloudPlatformAdapter
```

Scheduler 只依赖统一协议，不直接依赖具体开发板 SDK。

## 4. 云端 PostgreSQL 的作用

PostgreSQL 可以放云端，但它不是替代 NestJS API，也不是替代 COS。它主要承担数据仓库和轨迹仓库：

```text
大规模商品池
商品 embedding 元数据
Runtime 调度轨迹
Telemetry 历史样本
跨设备性能档案
端云协同状态同步
实验结果复现
```

云端 PostgreSQL 的价值：

```text
支撑更大商品数据量
长期保存每次运行轨迹
体现端云协同参赛要求
让不同设备共享统一数据仓库
后续便于接 pgvector 或独立向量库
```

需要注意：现场演示不能完全依赖云端网络。必须保留降级策略：

```text
云数据库不可达 -> 使用本地演示数据缓存
云向量检索超时 -> 使用本地小索引
COS 不可达 -> 使用本地预缓存图片
Telemetry 写云失败 -> 先写本地队列，网络恢复后同步
```

## 5. NestJS API 的作用

NestJS API 当前建议继续本地运行。它负责：

```text
Runtime API
Agent 任务图入口
Scheduler 调度
Platform Adapter 聚合
Executor 调用编排
Telemetry 写入
调度盘事件流
购物业务接口
商品池接口
图片上传和预处理接口
```

API 不需要为了演示而部署公网。只有在需要远程访问、多人测试或线上评审入口时，才考虑部署到 Zeabur、云服务器或其他 PaaS。

当前更合理的口径是：

```text
API 本地运行
数据库可以云端
对象存储可以云端
模型能力可以云端
开发板作为端侧执行资源
```

## 6. 必须预留的解耦接口

### 6.1 Platform Adapter

每个设备或云平台必须通过统一接口暴露能力：

```text
getStaticProfile()
getRuntimeState()
discoverExecutors()
probeModel()
```

至少提供：

```text
平台 ID
操作系统和架构
CPU 核数和内存
GPU/NPU 是否存在
执行器列表
模型支持探测结果
当前 CPU/内存/温度/网络状态
缺失能力原因
```

### 6.2 Executor

Executor 负责真正执行任务，不负责理解购物业务。

可执行工具示例：

```text
image.quality_check
image.crop
image.embedding
text.embedding
catalog.vector_search
catalog.price_query
answer.generate
```

执行器必须返回：

```text
执行状态
输出引用
实际延迟
峰值内存
质量指标
失败原因
是否 fallback
```

### 6.3 Cloud Resource Adapter

云端资源也必须被当作一种可调度资源，而不是写死调用：

```text
CloudPostgresAdapter
CloudObjectStorageAdapter
CloudEmbeddingAdapter
CloudVectorSearchAdapter
CloudModelAdapter
```

每个云资源必须支持：

```text
配置读取
健康检查
能力探测
超时控制
失败降级
Telemetry 记录
```

## 7. 调度盘要求

调度盘用于证明 Agentic Runtime 的真实运行过程，而不只是展示搜索结果。

第一版可以轮询 API：

```text
GET /api/v1/runtime/snapshot
POST /api/v1/runtime/plan
POST /api/v1/runtime/telemetry
POST /api/v1/runtime/verify
```

第二版升级为 SSE：

```text
GET /api/v1/runtime/events
```

调度盘至少展示：

```text
当前 runId
用户 goal
Agent 生成的 taskGraph
每个任务的依赖关系
每个候选执行器的 accepted/rejected 状态
被拒绝的硬约束原因
最终 executionPlan
CPU/内存/网络/温度/GPU/NPU 状态
Telemetry 实际耗时和质量指标
Verify 结果
Replan 事件
端侧/云侧资源切换原因
```

## 8. Runtime 轨迹存储要求

为了支持回放和审计，后续应把 Runtime 运行轨迹写入数据库：

```text
runtime_run
runtime_task
runtime_task_graph
runtime_execution_plan
runtime_candidate_evaluation
runtime_platform_snapshot
runtime_telemetry
runtime_performance_sample
runtime_verification
runtime_replan
```

这些表共同回答：

```text
用户想做什么
Agent 拆成了哪些任务
当时平台状态如何
Scheduler 评估了哪些执行器
为什么选择或拒绝某个执行器
实际执行效果如何
结果是否达标
是否发生重规划或降级
```

## 9. 向量检索和模型切换要求

更换向量模型时，不能只改模型名。必须同步处理：

```text
embedding provider
model name
dimension
embedding kind
向量归一化方式
商品池向量重建
旧向量版本隔离
查询向量与商品向量一致性
模型健康检查
真实性能样本采集
```

推荐方向：

```text
本地演示小索引：保证现场稳定
云端 PostgreSQL + pgvector 或独立向量库：承接大规模商品池
Scheduler 根据隐私、延迟、网络状态和质量要求决定本地检索还是云端检索
```

## 10. 当前优先级

### P0：本地 Runtime Monitor

```text
电脑本地启动 NestJS API
新增调度盘页面
轮询 runtime snapshot
展示 blocked / ready / evaluation / telemetry
把图片搜索操作和 runtime plan 关联起来
```

### P1：Runtime 轨迹持久化

```text
设计 runtime_* 表
把 plan、evaluation、snapshot、telemetry 写库
支持按 runId 查询和回放
```

### P2：云端 PostgreSQL

```text
迁移 Prisma datasource
保留本地 dev 数据库方案
云数据库只作为数据和轨迹仓库
API 继续本地运行
```

### P3：开发板适配接口

```text
已定义 Edge Adapter 与开发板心跳注册机制
已实现电脑 Host Adapter 和 CIX/Linux 通用采集代理
CIX NPU/GPU 厂商 SDK 通过 profile/metrics 探针接入
后续补充真实执行器时不改购物业务代码
```

### P4：端云协同调度

```text
本地执行器和云端执行器同时进入候选池
Scheduler 根据真实资源和性能样本选择
云不可达时可降级到本地缓存
端侧资源不足时可转云端处理低隐私任务
```

## 11. 当前运行口径

本地运行：

```powershell
cd E:\learning_resource\Harmony_Creation\HarmonyOS\Cixin\Cixin\shopping-assistant
npm ci
Copy-Item .env.example .env
npm --workspace services/api-server run prisma:generate
npm --workspace services/api-server run db:init
npm run api:dev
```

Web 调试入口：

```powershell
npm run web:dev
```

当前 `.env` 可以先保持本地 API：

```env
PUBLIC_API_BASE_URL=http://localhost:3000
RUNTIME_PLATFORM_ADAPTER=auto
```

如果先使用云端 PostgreSQL，则只替换数据库地址：

```env
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>
```

API 本身仍然可以继续在本机运行。

## 12. 验收标准

当前阶段通过以下标准验收：

```text
没有开发板时，电脑 Host Adapter 可以完整跑 Runtime 协议测试
调度盘能展示真实平台状态和缺失能力
Scheduler 不伪造 GPU/NPU/云端能力
有 telemetry 样本时，能展示执行计划和评分
没有 telemetry 或模型探测时，能明确 blocked 原因
数据库能按 runId 回放一次用户请求的完整调度轨迹
后续接入 CIX 开发板时，只新增 Adapter/Executor，不重写购物业务
```

一句话原则：

```text
当前用电脑代替开发板，但工程结构必须把电脑也当成一种可替换 Edge Platform。
云端不是应用主入口，而是 Agentic Runtime 可以调度的数据、模型和长期记忆资源。
```
