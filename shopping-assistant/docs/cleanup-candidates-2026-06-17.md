# 2026-06-17 清理候选审计报告

## Git 同步状态

- 已执行 `git fetch origin --prune`。
- `main` 与 `origin/main` 当前完全一致：`git rev-list --left-right --count main...origin/main` 返回 `0 0`。
- 远端新增标签 `v1.0.0` 已同步到本地，指向提交 `d7a509a`。
- 本地已有改动均已保留，没有被覆盖。当前仍存在这些未提交内容：
  - 已修改：`apps/judge-entry-web/src/product-pool/admin.ts`
  - 未跟踪：`docs/deliverables/hci-final-report.zip`、`docs/deliverables/hci-final-report/`、`pictures/`、`sample8.jpg`

## 重要主链路结论

不要因为文件名里带 `local` 就直接删除。当前后端仍然把 SQLite 商品池作为默认搜索数据源：

- `services/api-server/src/common/config/configuration.ts` 默认将 `PRODUCT_DATA_PROVIDER` / `SEARCH_PROVIDER` 设为 `local_product_pool`。
- `services/api-server/src/modules/search/search.module.ts` 会把 `local_product_pool` 绑定到 `LocalProductSearchProviderService`。
- `services/api-server/src/app.module.ts` 明确加载 `ProductPoolModule`。
- Zeabur 部署文档仍然使用 `DATABASE_URL=file:/data/prod.db` 和 `PRODUCT_DATA_PROVIDER=local_product_pool`。

所以，Prisma / SQLite 商品池目前不是普通开发残留。除非下一步架构明确改成其它生产数据源，否则不能直接删除。

## A. 高置信可清理候选

这些文件看起来是误创建文件、运行产物或本地缓存，不属于正常源码路径。

| 候选项 | 状态 | 原因 |
| --- | --- | --- |
| `message = 'Hello, Python!'.py` | 已跟踪 | 独立 Python 玩具文件，与项目运行无关。 |
| `{console.error(e)` | 已跟踪 | 0 字节误粘贴文件。 |
| `services/api-server/prisma.$disconnect())` | 已跟踪 | 0 字节误粘贴文件。 |
| `services/api-server/prisma.())` | 已跟踪 | 0 字节误粘贴文件。 |
| 根目录 `api-*.log`、`tmp-*.log`、`judge-entry-web-runtime.log` | 未跟踪 | 运行日志；`.gitignore` 已经忽略 `*.log`。 |
| `docs/deliverables/~$*.docx` | 已跟踪 | Word 临时锁文件，不是真正交付物。 |
| `services/api-server/prisma/dev.db` | 已忽略的本地文件 | 本地 SQLite 运行数据库。只有仍需要这份本地数据时才保留。 |
| `data/browser-profiles/**`、`tools/data-pipeline/data/**` | 已忽略的本地数据 | 浏览器 profile / 爬虫运行状态，不是源码。 |
| `services/image-worker/.venv/**` | 已忽略的本地环境 | Python 虚拟环境，应可重建，不应入库。 |
| `apps/mobile-flutter/build/**`、`apps/mobile-flutter/.dart_tool/**`、`apps/judge-entry-web/dist/**` | 已忽略构建产物 | 生成目录和缓存目录。 |

## B. 大体积样例、截图与课程交付物

这些不属于主代码路径。是否保留取决于它们是否还要作为验收证据、文档素材或测试 fixture 使用。

| 候选项 | 文件数 / 体积 | 原因 / 需要决策 |
| --- | ---: | --- |
| `samples/product-pool/adapt-debugger-batches/**` | 996 个文件，约 260.51 MB | Adapt Debugger 生成的批处理数据；如果商品池导入和调试已经完成，通常可清。 |
| `screenshots/**` | 78 个文件，约 35.21 MB | QA 截图、视频和 UI XML dump。建议只保留当前演示需要的证据，其余移出仓库或精简。 |
| `pictures/**` | 18 个未跟踪文件，约 14.18 MB | 看起来已经复制到 `docs/deliverables/hci-final-report/assets/`，不是核心源码。 |
| `docs/deliverables/hci-final-report.zip` 与 `docs/deliverables/hci-final-report/**` | 未跟踪，`docs/deliverables` 下总计约 55 MB | 课程 / 期末报告包，不属于 App 主链路。需要决定是否放在代码仓库里。 |
| 根目录 `sample2.jpg` 到 `sample6.jpg`、`sample8.jpg` | 有些已跟踪，有些未跟踪 | 临时图片样例；其中 `sample8.jpg` 未跟踪。 |
| 根目录 hash 命名图片 `28f...jpg`、`665...jpg`、`941...jpg`、`logo.jpg` | 已跟踪 | 旧设计 / 参考图，主要被 `docs/22-Stitch...md` 引用，不是运行资源。 |
| `user_image_sample(1).jpg` | 已跟踪 | 看起来像重复样例图。 |
| `user_image_sample.jpg` | 已忽略，但被 smoke 文档 / 脚本引用 | 如果云端 smoke 仍依赖样例图，建议只保留一个 canonical 样例。 |
| `淘宝网-商品列表页采集【网站反爬请查阅注意事项】.json` | 已忽略的本地原始爬虫数据 | 如果规范化后的输出已经足够，可以删除本地原始文件。 |

## C. 用户主链路之外的调试与运维入口

这些是真代码，不是误创建文件。只有当产品决策明确为“只保留移动端用户主流程，不保留本地 / 运维 / 调试入口”时才删除。

| 候选项 | 主要文件 | 为什么可能不属于主链路 |
| --- | --- | --- |
| 图片搜索调试 API | `services/api-server/src/modules/sessions/controllers/search-debug.controller.ts`、`services/api-server/src/modules/sessions/application/search-debug.service.ts` | 暴露 `POST /api/v1/debug/image-search`；供 Web 调试器使用，不是移动端主流程。 |
| 内容搜索调试 API | `services/api-server/src/adapters/content-search/content-search-debug.controller.ts` | 暴露 `GET /api/v1/debug/content-search`；属于诊断接口。 |
| 商品图预处理调试接口 | `services/api-server/src/modules/product-pool/controllers/product-pool.controller.ts` 中的 `debugImagePreprocess` | 暴露 `POST /api/v1/product-pool/debug/image-preprocess`；供 Adapt Debugger 使用。 |
| Adapt Debugger Web UI | `apps/judge-entry-web/src/adapt-debugger.ts`、`apps/judge-entry-web/src/adapt-debugger.css`、`apps/judge-entry-web/src/main.ts` 中的 `/adapt-debugger` 路由 | 本地图像裁剪 / 预处理调试工具。 |
| Adapt Debugger 启动脚本 | `scripts/start-adapt-debugger.ps1` | 同时启动 API、本地 image-worker 和 Web 调试页。 |
| 图片搜索诊断静态工具 | `tools/image-search-diagnostics/**` | 独立诊断 UI，不是 App 运行时。 |
| 商品池运维 Web | `apps/judge-entry-web/src/product-pool/**`、`apps/judge-entry-web/product-pool.html`、`apps/judge-entry-web/src/product-catalog.ts` | 用于导入、批次回滚、商品编辑 / 删除、embedding 重建的维护后台。 |
| 商品池维护 API | `services/api-server/src/modules/product-pool/controllers/product-pool.controller.ts` | 导入、删除、回滚、重试、统计、诊断等接口。搜索仍依赖商品池数据，但这些管理接口可以单独决策。 |
| 商品池导入 / 上传脚本 | `scripts/import-product-pool.mjs`、`scripts/upload-product-pool-*.ps1`、`scripts/prepare-product-pool-*.mjs/.ps1`、`scripts/split-product-pool-*.mjs`、`scripts/export-cloud-product-pool-keys.mjs`、`scripts/cleanup-failed-product-pool-imports.ps1` | 数据运维工具，不是用户运行时。若云端商品池仍要手动维护，则应保留。 |

## D. 替代或遗留 App 栈

| 候选项 | 证据 | 原因 |
| --- | --- | --- |
| 根目录 `android/**` | 独立包名 `com.shopping.assistant`，包含 Capacitor Gradle 文件和 Capacitor 生成注释。 | 当前活跃移动端看起来是 `apps/mobile-flutter/android/**`，包名为 `com.xieluyao.shoppingassistant.shopping_assistant_mobile`。 |
| `capacitor.config.ts` | 引入 `@capacitor/cli`，`appId` 为 `com.shopping.assistant`。 | 属于根目录 Capacitor 壳，不属于 Flutter App。 |
| 根 `package.json` 中的 `@capacitor/android`、`@capacitor/cli`、`@capacitor/core` devDependencies | 除 `apps/judge-entry-web` 外，根目录没有对应 Web App 源码。 | 如果 Capacitor 壳已经废弃，可以移除。 |
| `zbpack.json`、`zbpack.judge-entry-web.json` | 根目录部署打包文件。 | 仅当这些旧部署路径仍使用时保留。 |

## E. 本地 image-worker / 本地 GPU 路径

这是可选的离线 / 本地基础设施。配置默认不启用，但仍被 `ProductPoolModule` 导入。

| 候选项 | 主要文件 | 原因 / 风险 |
| --- | --- | --- |
| `services/image-worker/**` | Python FastAPI worker 和 requirements。 | 只服务本地 worker；云端默认使用 `volcengine_doubao_vision`。 |
| `LocalGpuEmbeddingProviderService` | `services/api-server/src/modules/product-pool/application/local-gpu-embedding-provider.service.ts` | 只有在 `EMBEDDING_PROVIDER=local_gpu_worker` 且 `ENABLE_LOCAL_IMAGE_WORKER=true` 时使用。 |
| `LocalGpuImagePreprocessorService` | `services/api-server/src/modules/product-pool/application/local-gpu-image-preprocessor.service.ts` | 只有在 `IMAGE_EMBEDDING_PREPROCESSOR=local_gpu_worker` 且本地 worker 启用时使用。 |
| `LocalImageWorkerClientService`、`LocalImageWorkerHealthService` | `services/api-server/src/modules/product-pool/application/local-image-worker-*.service.ts` | 本地 worker 的辅助服务。 |
| `docs/19-本地GPU图像处理链路.md` | 文档 | 只有当本地 GPU 处理能力正式放弃时删除。 |

## F. Mock、归档与 fake 数据

| 候选项 | 原因 / 风险 |
| --- | --- |
| `archive/mock-code/**` | 已归档 mock adapter；当前模块没有导入。 |
| `archive/mock-data/**` | 已归档样例 / fallback / mock 数据。 |
| `samples/product-pool/generated/fake-shoe-product-pool-50.json` | fake 商品数据；被 `product-pool:import:fake` 引用。 |
| 根 `package.json` 中的 `product-pool:import:fake` | 如果 fake 导入流程不再需要，可以移除。 |
| `ALLOW_MOCK_PROVIDERS` 相关引用 | 当前配置中 `runtime.allowMockProviders` 固定为 `false`，但文档 / 示例仍有 mock 路径。删除前需确认。 |

## G. 移动端本地 / 演示 fallback 路径

这些逻辑嵌在 Flutter App 里，可能是用户可见的降级行为。只有确认不再需要离线 / 演示模式后再删除。

| 候选项 | 证据 | 风险 |
| --- | --- | --- |
| `LOCAL-` session 模式和本地 prompt 处理 | `apps/mobile-flutter/lib/main.dart` 中大量引用，包括 `_applyPromptLocally` 和 `LOCAL-FIGMA-RESULTS`。 | 删除会改变离线 / 演示行为以及部分 UI fallback 状态。 |
| 本地 JSON 持久化 | `apps/mobile-flutter/lib/core/local/local_json_store.dart`，被会话持久化和截图检测使用。 | 可能是真实客户端状态，不只是调试代码。 |
| 本地偏好 API | `services/api-server/src/modules/user-memory/controllers/user-memory.controller.ts` 中的 `LocalPreferencesController`；移动端调用 `/api/v1/preferences/shoe-size`。 | 只有当所有偏好存储迁移到认证 profile blocks 后才建议删除。 |
| App 帮助本地回答 TODO | `apps/mobile-flutter/lib/main.dart` 中 App 帮助问答路径。 | 当前会返回本地说明，而不是调用 LLM endpoint。 |
| Flutter 中的 `debugPrint(...)` 日志 | 请求和失败日志很多。 | Debug 构建通常无害；生产清理时可统一 gate 或删除。 |

## H. 不建议在没有替代方案时删除

这些看起来可能像本地 / 开发代码，但当前仍属于生产链路或核心数据链路。

| 暂时保留 | 原因 |
| --- | --- |
| `services/api-server/prisma/schema.prisma` 和 Prisma persistence 层 | 当前 session、商品池、购物车、记忆、候选快照、商品数据模型都在这里。 |
| `services/api-server/src/modules/product-pool/application/local-product-search-provider.service.ts` | 默认 `SEARCH_PROVIDER` / `PRODUCT_DATA_PROVIDER` 会走这里。 |
| `ProductPoolModule` 整体 | 搜索、对话筛选、候选展示、TrendOutfit、商品池推荐仍依赖它。管理接口可以单独拆，但模块本身不能直接删。 |
| `CacheModule` 和缓存工具 | 缓存当前是加速层；SQLite 快照仍是状态来源。 |
| `FallbackModule` / fallback snapshots | 当前 MVP 文档和代码都把降级作为显式行为，而不是单纯 mock 残留。 |
| `TrendOutfitModule` | 当前移动端 API client 会调用穿搭推荐接口。 |
| `UserMemoryModule` | 当前移动端 profile 编辑和偏好流程依赖它。 |

## 建议决策顺序

1. 先确认明显清理项：误创建的 tracked 文件、Word 锁文件、未跟踪日志、已忽略 DB / build / cache / runtime 目录。
2. 决定课程 / 报告资产是否应留在代码仓库：`docs/deliverables/hci-final-report*` 和 `pictures/**`。
3. 决定是否在 Git 中继续保留大体积证据数据：`samples/product-pool/adapt-debugger-batches/**` 和 `screenshots/**`。
4. 决定根目录 Capacitor Android 壳是否已经被 Flutter App 完全替代。
5. 决定 debug / ops 入口是保留在当前仓库、迁移到单独 ops 包，还是删除。
6. 决定本地 image-worker / GPU 支持是否仍是正式扩展点。
7. 最后再处理 Prisma / product-pool / search provider 边界；否则主搜索链路会被破坏。
