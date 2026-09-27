# 2700 条商品上传 Zeabur 与 COS

## 数据与链路

上传来源仅为当前项目 `DataInitService.ets` 中列出的 22 个 rawfile JSON，共 2700 条。没有读取 original_app 商品、旧数据库或手机内置模型向量。

参考 original_app 的 `import-product-pool.mjs`、`upload-product-pool-group.ps1` 与服务端导入实现，采用：

本机读取商品与下载原始图片 → 缩放为 480×480 JPEG → 携带维护令牌调用 Zeabur 导入接口 → 服务端把图片存入 COS → 用 COS 签名地址打标/生成向量 → Zeabur `/data/harmony-agent.db` 保存商品、图片元数据和索引。

`local_product_pool` 是“当前服务数据库中的自有商品池”的提供商名称；部署在 Zeabur 时读取的是 Zeabur 持久卷，不是电脑或手机数据库。

2700 条中有 204 条重复身份记录。脚本复用服务端 `parsePlatformProductReference` 规则，按平台和商品 ID 合并，保留清单中最后一次记录，最终准备 2496 件商品、100 个批次（每批至多 25 件）。重复关系和源文件 SHA256 写入 manifest。云端按同一身份 upsert，已有同身份商品可能被更新，其他商品不会被清空。

## 配置

本地 `.env` 被 Git 忽略，仅由工具在本机读取，不上传整个文件。

- `API_BASE_URL=https://cixin.zeabur.app`。
- `MAINTENANCE_API_TOKEN` 填当前 Zeabur API 服务中同名变量的值，不是模型 API Key。
- 三个模型 Key 分别是 `VISION_MODEL_API_KEY`、`EMBEDDING_API_KEY`、`CHAT_MODEL_API_KEY`。前两者可使用有对应模型权限的同一方舟 Key；聊天使用 DeepSeek Key。
- 本地 `.env` 也列出云端参考配置。编辑本地文件不会修改 Zeabur 环境变量：模型名称、Key、场景覆盖与 `CLOUD_MODEL_MODE=required` 需在 Zeabur 服务设置中配置。保留云端已有 JWT、COS 区域、三个桶与访问凭证，不用本地空值覆盖它们。
- 保持 `/data` 持久卷、`DATABASE_URL=file:/data/harmony-agent.db`、`PRODUCT_EMBEDDING_KINDS=visual,multimodal`、`EMBEDDING_DIMENSION=1024`。图片检索用 visual，文本检索用 multimodal。
- 默认/打标/品类/查询图识别使用 Lite，候选复核使用 Pro，具体 ID 已写在私有 `.env` 中。服务端仍会在已有来源属性足够时沿用来源标签，而非强制对每件商品调用视觉模型。
- 本轮服务端场景路由和向量探测维度修复需要部署到 Zeabur 后才生效；`.env.zeabur.example` 是无密钥参考模板。不要把本机 `.env` 放进镜像或 HAP。

## 终端操作

在 `harmony-agent` 根目录依次执行：

```powershell
npm run data:prepare
npm run data:upload -- --check-only
npm run data:upload
```

`data:prepare` 不联网、不调用模型，只生成清单与待上传批次。`--check-only` 校验维护令牌以及数据库/COS/视觉/Embedding 可用性，不导入商品；云端模型探测可能产生少量调用费用。空商品池导致 readiness 为 503 不会阻止首次导入，但模型 deferred、COS 不可用等会阻止上传。

正式上传会下载当前商品图片并产生 COS 与模型费用；这批历史采集数据的远程图片可能已失效。脚本遇到图片失败会停止并报告，不把缺图商品伪装成已上传。商品价格、库存和原始链接仍是采集时数据，上传不等于重新抓取验证。

## 进度与验收

结果均位于被 Git 忽略的 `artifacts/cloud-upload/`：

- `manifest.json`：本次权威批次清单、2700 条来源记录和重复关系。不要手动上传目录中所有 JSON。
- `progress.json`：批次 ID、提交状态和验收结果；重跑同一命令跳过成功批次，继续查询已提交批次。
- `cloud-result.json`：全部批次通过后的云端就绪状态和商品池统计。

脚本逐批等待完成。批次内单条商品导入或模型生成失败时，服务端记录失败并跳过该条，脚本记录告警后继续后续批次；只有批次未处理完全部条目或处于失败状态时才会停止。服务端最终就绪检查仍会校验 visual 与 multimodal 两个索引空间。

提交前先写进度。如果网络断开发生在服务端收件后、客户端拿到 batchId 前，脚本会停止为“提交结果不确定”，不会自动重复 POST。按输出的 batchSource 在云端批次接口查询，确认 batchId 后补入 progress.json 对应记录；不要直接删除进度重跑。批次未处理完或状态为 `failed` 时，查 `/api/v1/product-pool/batches/{batchId}/quality`；普通的 `completed_with_errors`、单条失败或向量缺失会被记录并跳过，不需要重新导入整批。

正常退出自动释放 `upload.lock`；强制杀进程留下锁时，确认没有上传进程后才移除该锁。不要删除 progress.json。原数据目录不会被修改。

如果前置检查通过、正式运行时再次出现 `Cloud import dependencies unavailable`，先不要重传。模型探测有短暂超时可能；上传脚本现已对 readiness 重试 3 次。服务端 readiness 探测同时关闭视觉模型深度思考并把探测输出上限设为 16 token，需随 API 服务重新部署后才生效。

2026-09-28 核查：当前 Zeabur 数据库与 COS 探测通过，模型为 deferred。用户明确本轮仅准备脚本，凭证仍在配置/申请，因此没有执行正式上传。
