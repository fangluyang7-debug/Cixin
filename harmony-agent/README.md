# Harmony Agent：鸿蒙参赛项目工作区

**云端闭环改造（2026-09-26）：** 正式手机搜索已改为云端任务；服务端新增 Runtime Runner、真实健康探测和 12 阶段图片工作流。代码与本地回归、云端/真机待验项见 [改造与验收记录](docs/17-云端调度闭环改造与验收记录.md)。公开域名当前返回 Caddy 404，尚未认定线上接通。

**云链路核查（2026-09-25）：** 已修正 Zeabur `PORT`/容器监听、COS 上传超时、私有桶签名图片返回与数据库初始化自测；手机端远程执行派发仍未完成，详见 [数据库、COS 与云任务调度接入](docs/16-Zeabur数据库COS与云任务调度接入.md)。

**Zeabur/COS 云链路准备（2026-09-24）：** [数据库、COS 与云任务调度接入](docs/16-Zeabur数据库COS与云任务调度接入.md) 说明持久卷 SQLite、服务端图片存储与新增云任务链路画像。云服务配置和数据尚待实际接通。

**算法研究资料（2026-09-22）：** [调度算法源码导读与跨设备、跨内核适配](docs/15-调度算法源码导读与跨设备内核适配.md) 提供实际源码入口、调用链、约束/评分/预测公式、执行与反馈边界，以及跨设备适配建议。明确区分已实现的手机调度与文档 14 的待审核多设备方案。

**电脑端实时调度监控（2026-09-22）：** 独立 Node 监控服务在电脑开启 `8765` 端口，网页通过配对码查看手机 Scheduler 遥测；手机端只有连接地址、配对码及推送开关，没有内嵌调度仪表盘。使用 `npm run monitor:dev` 启动。撤销内部参数、温度、内存和卡顿问卷；只在相关迹象出现时询问等待容忍度或结果需求。详见 [监控架构与操作](docs/13-实时调度仪表盘与提问诊断.md)。

**原生 UI 与反馈链路（2026-09-21）：** 三份 HTML 设计已转换为 ArkUI 首页、搜索结果和商品详情组件，保留调度控制台；反馈增加接收/校准回执，按同配置、同维度有界更新效用权重，不绕过原策略。页面映射、能力边界及验收见 [原生页面与反馈参数链路](docs/12-原生页面转换与反馈参数链路.md)。

**手机验证入口（2026-09-21）：** 请按 [手机验证操作手册与结果回传](docs/11-手机验证操作手册与结果回传.md) 签名安装、采样真实负载并导出 JSON。保留文档 09 的受约束策略作为主框架，结合新增状态 TTL、公平排队和实验工具；旧三档模式标签不等于三种闭环配置。当前验证及方案保留核对见 [第二轮整合验收](docs/testing/07-resource-experiment-integration.md)。主机测试与手机结论分开记录。

**当前作品定位（2026-09-19）：面向鸿蒙手机 AI 任务的资源感知调度中间件，通过任务优先级、推理线程配置、计算档位和后台任务让出机制，改善前台响应与资源使用效率。**

团队请先阅读 [作品说明与开发基线 V1.0](docs/02-作品说明与开发基线-鸿蒙手机资源感知调度中间件.md)。该文档明确功能范围、目标架构、旧作品现状、实现方法及验收标准，替代此前以通用端云 Runtime 为主的产品定位。

手机实现的主要来源是旧初赛目录 `C:\Users\17321\Desktop\harmonyOS\HarmonyOS--\shopping-assistant\apps` 中的原生应用与 scheduler HAR。**旧原生代码已迁入 `apps/harmony`，并已同步最新语义调度 SDK 改造（2026-09-20），开发与验证见 [阶段记录](docs/03-分阶段开发与验证记录.md)**；下述 Node/Web/Python 环境属于此前迁移资产，不是手机核心的必需运行环境。无需部署端侧生成式语言模型，现有轻量 Embedding 模型可作为真实负载。

## 历史迁移资产与运行说明

2026-09-21 已接入手机本地受约束策略闭环 V1：完整执行配置包、观测/影子/受控试验模式、结构化反馈、实际配置审计与本地熔断。购物链路默认全量检索，未开放未经真机验证的自动降质。详见 [实施方案与落地调整](docs/09-HarmonyOS受约束策略闭环实施方案.md)、[验收记录](docs/testing/05-constrained-policy-acceptance.md)。

同日首次整合执行安全修复：统一 STOP_REQUESTED 与闭环取消看门狗，恢复暂停期间保护重评估，配置切换时重新匹配执行器。该次历史证据见 [首次合并验收](docs/testing/06-merge-integration-acceptance.md)，当前状态见上方第二轮整合验收及 [功能核查与范围更新](docs/10-手机验证前功能核查与缺口清单.md)。

创建日期：2026-09-18。由同仓库的 `shopping-assistant` 部分迁移而来，使用独立文件、依赖、配置和数据库；没有引用源项目的符号链接。本目录是后续鸿蒙项目的开发入口。

2026-09-18 首次分离时只建立了服务端开发环境；2026-09-20 已迁入原生 Phone 工程并开始调度正确性修复。比赛为鸿蒙高校创新赛复赛 OS 方向，原生工程使用 HarmonyOS 6.0.2(22)，具体真机兼容性待验证。Node/NestJS 与 Python 仅为可选参考，现有服务端 HarmonyOS Adapter 仍返回不可用状态。

## 目录与边界

```text
apps/test-entry-web/        独立 Web 联调入口、购物示例与 Runtime 控制台
apps/harmony/               鸿蒙 Phone 原生 entry、scheduler HAR 与模型资源
apps/harmony/monitor/       电脑端实时监控页面与轻量配对接收服务
services/api-server/        NestJS 服务、通用 Runtime、购物模块与测试
services/image-worker/      可选 Python 图像服务，运行于开发机／服务端
scripts/                    环境加载与迁移完整性校验
docs/00-鸿蒙项目起点与适配边界.md
docs/01-迁移记录与协作约定.md
docs/reference/cix/         此芯设计及接口资料快照，只作参考
migration-manifest.json     文件来源、源版本与迁移校验信息
```

保留了 Runtime、工具契约、调度与事件代码以及购物后端，方便原生端后续接入。未迁移 Android／Flutter 工程、Capacitor 依赖、模型权重、商品批量数据、旧数据库、`.env` 或缓存。技能编译方案在设计资料中，相关实现尚未完成。

## 本地开发

在本目录使用 Node.js 22 或更高版本。首次安装依赖会生成独立的 `node_modules`：

```powershell
npm ci
Copy-Item .env.example .env
npm --workspace services/api-server run prisma:generate
npm --workspace services/api-server run db:init
npm run api:dev
```

仅在第一次配置且 `.env` 不存在时复制；按实际环境填写模型、存储、认证等配置，不使用此芯项目的 `.env`。`DATABASE_URL=file:./harmony-dev.db` 使用本目录后端 Prisma 目录中的独立数据库。

另一终端同样进入本目录：

```powershell
npm run web:dev
```

| 服务 | 此芯项目常用默认值 | 鸿蒙目录默认值 |
|---|---|---|
| API | 3000 | 3100 |
| Web 开发 | Vite 默认 5173 | 5180，端口占用则报错 |
| Web 预览 | Vite 默认 4173 | 4180 |
| 可选图像 Worker | 7800 | 7801 |

Web 地址为 `http://localhost:5180`，API 默认 `http://localhost:3100`。Vite 读取本目录根 `.env`；仅 `PUBLIC_`／`VITE_` 前缀用于公开前端配置，密钥不得使用这些前缀。真机接入需要填写可访问的开发机地址，不能使用真机自己的 localhost。

未配置真实模型、存储和数据源时，相关任务可能阻断或失败；调试页面存在不表示完整购物链路已经可用。

可选图像服务需单独 Python 环境、依赖和模型文件：

```powershell
python -m pip install -r services/image-worker/requirements.txt
npm run image-worker:dev
```

根据实际运行环境安装推理后端；此命令启动的是服务端 Worker，不代表鸿蒙设备具备 CUDA 或 NOE。仅在真实 Worker 验证后填写 `LOCAL_IMAGE_WORKER_BASE_URL` 并启用对应配置。

## 验证与协作

```powershell
npm run migration:verify
npm run api:build
npm run web:build
npm run api:test:unit -- --runInBand
```

迁移校验检查复制清单、当前文件哈希及 workspace 锁文件一致性；后续正常开发产生哈希变化时会列出漂移，不阻止修改。测试不等于鸿蒙真机验收。

后续鸿蒙开发统一在本目录推进，先按新基线核对并迁移旧原生工程。复制来的契约保留历史 CIX／HarmonyOS 平台标识以兼容现有测试，并不表明设备适配完成。此芯的 P1 主控要求不能直接当作鸿蒙比赛要求。

历史资料：[鸿蒙项目起点与适配边界](docs/00-鸿蒙项目起点与适配边界.md)、[迁移记录与协作约定](docs/01-迁移记录与协作约定.md)。产品与技术范围以 [作品说明与开发基线](docs/02-作品说明与开发基线-鸿蒙手机资源感知调度中间件.md) 为准。

## 网络画像驱动调度

调度前实测网络，结合输入大小和执行历史参与时限判断与选路；网络切换、过期和失败触发失效。接入变化与验收见[网络画像驱动调度](docs/网络画像驱动调度实施与验收.md)。
