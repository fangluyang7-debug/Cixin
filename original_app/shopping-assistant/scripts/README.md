# Scripts

本目录用于后续放：

- 本地开发辅助脚本
- 样例数据导入脚本
- APK 构建辅助脚本
- Prisma 初始化脚本

## 当前脚本

- `api-smoke-day1.ps1`：Day 1/2 后端主链路 smoke。需要先启动 API 服务。
- `cloud-smoke-full.ps1`：云端真实链路 smoke。默认验证 health、商品池统计、样例图上传、创建 session、用户图预处理、候选读取、SSE 事件，不执行商品导入和 embedding 重建。
- `normalize-octoparse-taobao.mjs`：清洗淘宝/天猫原始 JSON/JSONL，输出后端 `ProductPool` 标准导入 JSON、首批文件、拒绝行和报告。
- `normalize-collected-products.mjs`：清洗 `data/` 中淘宝/天猫、苏宁、唯品会、闲鱼等本地采集 JSON/JSONL，输出后端 `ProductPool` 标准导入 JSON、首批文件、拒绝行和报告。
- `verify-product-links.mjs`：验证清洗后的 `productUrl` 与 `imageUrl` 当前可访问，输出只包含有效商品的导入 JSON。
- `import-product-pool.mjs`：将标准导入 JSON 提交到后端商品池，后端负责入库、图片入 COS、预处理、生成 embedding。
- `split-product-pool-payload.mjs`：将较大的标准导入 JSON 按固定条数拆成多个小批次文件。

```powershell
.\scripts\api-smoke-day1.ps1 -BaseUrl http://localhost:3000
```

```powershell
npm run api:smoke:cloud -- `
  -BaseUrl https://apiserver.zeabur.app `
  -ImagePath D:\shopping-assistant\user_image_sample.jpg
```

如需额外验证用户手动调整框选范围，可显式加 `-RunSubjectAdjustment`。这会额外触发一次 query crop 和 embedding。

```powershell
npm run api:smoke:cloud -- `
  -BaseUrl https://apiserver.zeabur.app `
  -ImagePath D:\shopping-assistant\user_image_sample.jpg `
  -RunSubjectAdjustment
```

如需验证 ANN 诊断接口，可显式加 `-RunAnnDiagnose`。脚本会从 `.env` 读取 `MAINTENANCE_API_TOKEN`，不会打印 token。

## 淘宝/天猫数据入库流水线

原始爬取结果必须先清洗和验链，再交给商品池导入。不要直接把爬虫原始 JSON/JSONL 导入数据库。

```powershell
npm run product-pool:normalize:taobao -- `
  --file artifacts\product-pool\taobao-test-formal-sample.jsonl `
  --batch-source taobao_tmall_shoes_20260602 `
  --limit 50
```

如果采集文件来自当前项目根目录的 `data/` 文件夹，且混有淘宝/天猫、苏宁、唯品会、闲鱼等平台，优先使用统一清洗脚本。当前主链路仍以鞋类相似检索为核心，首次联调建议先加 `--only-shoes` 小批量验证：

```powershell
npm run product-pool:normalize:collected -- `
  --dir ..\data `
  --batch-source collected_shoes_20260605 `
  --only-shoes `
  --limit 80
```

全品类也可以转换为标准商品池格式，但相似检索质量取决于后续标签和 embedding 能力：

```powershell
npm run product-pool:normalize:collected -- `
  --dir ..\data `
  --batch-source collected_all_20260605 `
  --limit 80
```

如只想看统计、不写出大文件，可加 `--dry-run`。

生成全量标准文件后，不建议一次导入。先按 100 条左右拆批：

```powershell
npm run product-pool:split -- `
  --file samples\product-pool\generated\collected_shoes_market_20260605-full.json `
  --chunk-size 100
```

```powershell
npm run product-pool:verify-links -- `
  --file samples\product-pool\generated\taobao_tmall_shoes_20260602-full.json `
  --out-valid samples\product-pool\generated\taobao_tmall_shoes_20260602-verified.json `
  --concurrency 6 `
  --timeout-ms 10000
```

```powershell
node scripts\import-product-pool.mjs `
  --file samples\product-pool\generated\taobao_tmall_shoes_20260602-verified.json `
  --base-url https://apiserver.zeabur.app `
  --env-file .env `
  --wait
```
