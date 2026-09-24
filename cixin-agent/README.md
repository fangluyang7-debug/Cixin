# Cixin Agent：此芯多开发板调度 Runtime

面向 CIX P1 主控及多型号此芯开发板，将 `harmony-agent` 的 ArkTS 调度策略迁移为独立 TypeScript/Node.js 核心。应用沿用 Cixin 的 ToolDescriptor / TaskGraph 分层，执行位置由 Runtime 与各板的本地调度器共同决定。

**完整架构说明：[迁移后的 Cixin 项目架构](docs/迁移后的Cixin项目架构.md)。**

## 本次交付

- 23 个调度核心文件：受约束策略、在线成本预测、DAG 剩余耗时、边际收益、干扰模型、公平队列、取消与配置审计。
- P1/Linux ARM64 采集与多板设备画像；Windows/Linux 开发机采用 `host` 模式。
- LOCAL_ONLY / SHADOW / ACTIVE 全局放置；目标准入、真实 HTTP 执行、幂等记录、取消与断联对账。
- 本地执行轨迹和策略状态持久化；独立模型 Worker 契约；一个真实 CPU 精确向量检索插件。
- 沿用 `harmony-agent/调度盘` 机架式设计的电脑调度盘，连接真实本地/远端快照与执行回执；独立 Web 演示 App 负责提交任务。
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

## 调度盘与演示 App

在本目录执行 `npm run console`，终端显示访问令牌和地址。默认入口：

- 调度盘：<http://127.0.0.1:3200/dashboard/>
- 演示 App：<http://127.0.0.1:3200/demo/>

分别输入终端中的令牌。在演示 App 导入 [vector-task.json](examples/vector-task.json)，提交后可在调度盘查看同一 runId 的真实决策、执行节点和耗时。样例里的向量是公开测试输入，计算与回执来自真实执行。页面没有随机遥测或预置成功记录；温度、NPU、功耗、云数据库未接入时如实显示缺失状态。

该入口是独立的任务测试 App，不需要 DevEco。现有购物 App 的完整拍照、Embedding、商品查询流程仍需通过业务适配器接入 Cixin Runtime；新入口不代表该迁移已经完成。手机也可以访问运行节点的 Web 服务，但默认仅监听电脑本机。

详细说明：[调度盘与演示App接入测试](docs/调度盘与演示App接入测试.md)。数据库调整分为购物业务库迁移与调度审计同步，见 [云端数据库改造方案](docs/云端数据库改造方案.md)。本次没有迁移或上传现有数据库。
