# API Server

NestJS API 服务，承载当前智能比价助手的主要后端逻辑。

## 核心技术

- Node.js + NestJS
- SQLite + Prisma
- 当前不引入 Redis
- 国内对象存储通过 provider-neutral storage adapter 接入，当前默认腾讯云 COS
- 商品主链路为 `ProductPool + ANN + 标签召回`
- 聚合搜索 API 仅保留为后续可选适配层

## 本地启动

```powershell
npm install
$env:DATABASE_URL="file:./dev.db"
$env:OBJECT_STORAGE_PROVIDER="mock"
npm --workspace services/api-server run prisma:generate
npm --workspace services/api-server run db:init
npm run api:dev
```

## 当前接口

- `POST /api/v1/assets/images`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions/{sessionId}`
- `GET /api/v1/health`
- `GET /api/v1/sessions/{sessionId}/search-events`
- `POST /api/v1/sessions/{sessionId}/subject-selection`
- `POST /api/v1/sessions/{sessionId}/turns`
- `GET /api/v1/sessions/{sessionId}/candidates`
- `POST /api/v1/sessions/{sessionId}/candidates/more`
- `GET /api/v1/candidates/{candidateItemId}`
- `GET /api/v1/sessions/{sessionId}/suggestions`
- `POST /api/v1/product-pool/import`
- `GET /api/v1/product-pool/products`
- `GET /api/v1/product-pool/products/{productId}`
- `PATCH /api/v1/product-pool/products/{productId}`
- `POST /api/v1/product-pool/products/delete`
- `GET /api/v1/product-pool/batches`
- `GET /api/v1/product-pool/batches/{batchId}`
- `POST /api/v1/product-pool/batches/{batchId}/retry`
- `POST /api/v1/product-pool/batches/delete`
- `POST /api/v1/product-pool/embeddings/rebuild`
- `POST /api/v1/product-pool/ann/diagnose`
- `GET /api/v1/product-pool/stats`

完整前端联调契约以 `docs/16-前端联调接口契约.md` 为准。

## 基础联调口径

当前图片接口兼容两种调用：

- `application/json`：只做图片资源语义登记，适合 mock 和前端早期联调。
- `multipart/form-data`：字段名 `file`，服务端中转到当前 storage adapter；本地 mock 会生成对象引用，腾讯云 COS 环境变量齐全时会实际上传。

本地基础联调默认使用：

```powershell
$env:DATABASE_URL="file:./dev.db"
$env:OBJECT_STORAGE_PROVIDER="mock"
```

完整主链路：

1. `GET /api/v1/health`
2. `POST /api/v1/assets/images` 获取 `data.assetId`
3. `POST /api/v1/sessions` 获取 `data.session.sessionId`
4. `GET /api/v1/sessions/{sessionId}`
5. `GET /api/v1/sessions/{sessionId}/candidates`
6. `GET /api/v1/sessions/{sessionId}/search-events`

候选列表 `items[]` 至少包含：`title`、`platformName`、`price`、`shopName`、`shopType`、`stockStatus`、`productUrl`、`coverImageUrl`、`matchSummary`、`normalizedAttributes`、`rawPayload`、`decisionTags`、`decisionSupport`。

自动 smoke：

```powershell
.\scripts\api-smoke-day1.ps1 -BaseUrl http://localhost:3000
```

云端完整 smoke：

```powershell
npm run api:smoke:cloud -- `
  -BaseUrl https://apiserver.zeabur.app `
  -ImagePath D:\shopping-assistant\user_image_sample.jpg
```

## 商品池与相似搜索

当前后端已合并商品池链路：把清洗后的平台商品数据导入 `product-pool`，服务端会完成图片入库、鞋款标签化、embedding 生成与候选检索。拍照识别后的会话搜索通过 `PRODUCT_DATA_PROVIDER=local_product_pool` 使用这些已入库商品。

当前云端状态：

- 早期伪造 50 条商品数据已清理。
- 首批 30 条八爪鱼清洗后的淘宝/天猫鞋类商品已导入。
- 30 条商品图 embedding 已生成。
- 云端 smoke 已验证用户图裁剪、query embedding、ANN + 标签召回和候选返回链路。

本地启用：

```powershell
$env:PRODUCT_DATA_PROVIDER="local_product_pool"
$env:SEARCH_PROVIDER="local_product_pool"
npm run api:dev
```

导入样例数据的接口见 `test/product-pool-flow.http`，样例数据在 `samples/product-pool/seed-products.json`。

商品池导入接口现在是异步接口。`POST /api/v1/product-pool/import` 会先创建 `ProductImportBatch`，立即返回 `batchId/status=queued`，实际图片入库、标签化、embedding 生成会在后台执行。前端或运维脚本应通过批次接口轮询状态。

商品池管理接口：

- `GET /api/v1/product-pool/products?limit=100&offset=0&platform=taobao&tagStatus=verified&batchId=...&keyword=...&hasEmbedding=true`
- `GET /api/v1/product-pool/products/{productId}`
- `PATCH /api/v1/product-pool/products/{productId}`，需 `x-maintenance-token`
- `POST /api/v1/product-pool/products/delete`，需 `x-maintenance-token`，支持 `{ productIds, batchId, dryRun }`
- `GET /api/v1/product-pool/batches`，需 `x-maintenance-token`
- `GET /api/v1/product-pool/batches/{batchId}`，需 `x-maintenance-token`
- `POST /api/v1/product-pool/batches/{batchId}/retry`，需 `x-maintenance-token`

批次接口会返回商品数、可检索商品数、已生成 embedding 的商品数、embedding 行数和覆盖率，方便大批量入库后检查质量。

命令行导入脚本默认提交后立即返回；如需等待批次完成：

```powershell
node scripts/import-product-pool.mjs --file input.json --base-url https://apiserver.zeabur.app --env-file .env --wait
```

Flutter 移动端前端验证统一使用 Android Emulator。默认连接已部署后端：

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter run -d emulator-5554 --dart-define=ENABLE_BACKEND=true --dart-define=API_BASE_URL=https://apiserver.zeabur.app
```

完整设备策略见 `../../docs/23-Mobile前端开发链路.md`。

## 商品价格采集适配层

当前已新增 `marketplace` search provider，用来承接淘宝、抖音、拼多多、得物、京东等平台的商品价格来源。它不做绕登录、绕风控或抓 App 私有接口；首版提供本地 fixture 数据，后续用各平台官方开放平台/联盟接口替换适配器即可。

本地启用：

```powershell
$env:SEARCH_PROVIDER="marketplace"
$env:PRODUCT_DATA_PROVIDER="marketplace"
$env:MARKETPLACE_SEARCH_MODE="fixture"
$env:MARKETPLACE_ENABLED_PLATFORMS="taobao,douyin,pdd,dewu,jd"
npm run api:dev
```

授权 API 模式：

```powershell
$env:SEARCH_PROVIDER="marketplace"
$env:PRODUCT_DATA_PROVIDER="marketplace"
$env:MARKETPLACE_SEARCH_MODE="official_with_fixture"
$env:MARKETPLACE_TAOBAO_API_BASE_URL="https://your-authorized-api.example.com/taobao"
$env:MARKETPLACE_TAOBAO_API_KEY="your-token"
```

独立测试搜索：

```powershell
curl -X POST http://localhost:3000/api/v1/search/shoes `
  -H "Content-Type: application/json" `
  -d "{\"keywords\":[\"Nike\",\"Pegasus 40\",\"black\"],\"filters\":{\"priceMax\":\"500\"}}"
```
