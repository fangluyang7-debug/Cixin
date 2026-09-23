# Cixin Agent：此芯多开发板调度 Runtime

面向 CIX P1 主控及多型号此芯开发板，将 `harmony-agent` 的 ArkTS 调度策略迁移为独立 TypeScript/Node.js 核心。应用沿用 Cixin 的 ToolDescriptor / TaskGraph 分层，执行位置由 Runtime 与各板的本地调度器共同决定。

**完整架构说明：[迁移后的 Cixin 项目架构](docs/迁移后的Cixin项目架构.md)。**

## 本次交付

- 23 个调度核心文件：受约束策略、在线成本预测、DAG 剩余耗时、边际收益、干扰模型、公平队列、取消与配置审计。
- P1/Linux ARM64 采集与多板设备画像；Windows/Linux 开发机采用 `host` 模式。
- LOCAL_ONLY / SHADOW / ACTIVE 全局放置；目标准入、真实 HTTP 执行、幂等记录、取消与断联对账。
- 本地执行轨迹和策略状态持久化；独立模型 Worker 契约；一个真实 CPU 精确向量检索插件。
- 保留原 `shopping-assistant` 和 `harmony-agent` 全部内容，仅新增同级目录 `cixin-agent`。

P1 配置不是实机认证。当前已验证宿主机代码和双节点 HTTP 链路，尚无 P1/NOE 真机性能数据。NOE/GPU 执行器需连接实际 SDK Worker 并通过探测后才会被使用；未连接时明确列出缺失能力。

## 快速验证

需要 Node.js 22 或更新版本。在本目录运行：

```sh
npm ci
npm test
npm run demo
npm run migration:verify
```

`demo` 在本机临时启动两个 HTTP 节点，执行真实 CPU 向量检索并清理临时数据。它使用真实主机资源采集，但为了测试网络链路将远端样本门槛设为 0；不代表两块板的性能基准。

## 启动一个节点

PowerShell：

```powershell
$env:CIXIN_NODE_TOKEN = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
npm run build
npm start -- config/host.example.json
```

P1 上使用 Linux ARM64 的 Node.js，设置同名环境变量后运行：

```sh
export CIXIN_NODE_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm ci
npm run build
npm start -- config/p1.example.json
```

另开终端，通过 HTTP `POST /api/v1/runtime/tasks` 发送 [向量检索任务](examples/vector-task.json)，请求头携带 `Authorization: Bearer <token>`，再查询返回的 `runId`。多板配置、接口、Worker 协议与部署说明见架构文档。

项目只使用自身依赖、配置和数据目录，不读取旧项目 `.env`、数据库、模型权重或凭据。
