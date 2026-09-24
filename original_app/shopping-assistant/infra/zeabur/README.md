# Zeabur Deployment

当前线上部署基线：

- 后端：Zeabur Node.js Service
- SQLite：Zeabur Volume，建议挂载到 `/data`，`DATABASE_URL=file:/data/prod.db`
- 评委入口页：Zeabur Static Service
- APK 与图片文件：腾讯云 COS

## Service 1: api-server

建议从 GitHub 仓库创建服务，保留 monorepo 根目录作为构建上下文。

Build command:

```bash
npm ci && npm --workspace services/api-server run prisma:generate && npm run api:build
```

Start command:

```bash
npm --workspace services/api-server run db:init && npm --workspace services/api-server run start
```

必须配置：

```env
DATABASE_URL=file:/data/prod.db
SEARCH_PROVIDER=local_product_pool
PRODUCT_DATA_PROVIDER=local_product_pool
PRODUCT_POOL_RESUME_IMPORT_ON_START=false
PRODUCT_POOL_RESUME_IMPORT_BATCH_LIMIT=1
ANN_SCAN_BATCH_SIZE=500

VISION_PROVIDER=volcengine_ark
VISION_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VISION_MODEL_NAME=
VISION_MODEL_API_KEY=

EMBEDDING_PROVIDER=volcengine_doubao_vision
EMBEDDING_MODEL_NAME=
EMBEDDING_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
EMBEDDING_API_KEY=
EMBEDDING_DIMENSION=1024

OBJECT_STORAGE_PROVIDER=tencent_cos
OBJECT_STORAGE_REGION=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_ACCESS_KEY_SECRET=
OBJECT_STORAGE_BUCKET_COMPRESSED_RECOGNITION=
OBJECT_STORAGE_BUCKET_ORIGINAL_SOURCE=
OBJECT_STORAGE_BUCKET_DEMO_ASSETS=
```

`VISION_MODEL_API_KEY` and `EMBEDDING_API_KEY` must be copied from the same
known-good Ark API Key values used by local smoke tests. If legacy fallback
variables such as `OPENAI_API_KEY_3`, `BASE_URL_3`, or `MODEL_3` are present in
Zeabur, keep them identical to the primary variables or delete them to avoid
debugging stale values.

After changing model or storage variables, redeploy the service and run:

```powershell
npm run api:smoke:cloud -- `
  -BaseUrl https://apiserver.zeabur.app `
  -ImagePath D:\shopping-assistant\user_image_sample.jpg
```

必须挂载 Volume：

```text
/data
```

## Service 2: judge-entry-web

当前线上服务：

```text
Service ID: 6a157869a4dddd8ccbf79a41
Domain: https://judge.zeabur.app
```

Build command:

```bash
npm ci && npm run web:build
```

Static output directory:

```text
apps/judge-entry-web/dist
```

建议配置：

```env
PUBLIC_API_BASE_URL=https://<api-service-domain>
PUBLIC_APK_DOWNLOAD_URL=https://<cos-apk-url>
```

## 交付边界

Zeabur 负责：

- NestJS API 在线运行
- 评委静态入口页
- HTTPS 访问入口
- 环境变量
- 部署日志
- SQLite Volume

腾讯云 COS 负责：

- 压缩识别图
- 原图补传
- demo assets
- APK 下载文件

当前不引入 Nginx、PM2 或自管服务器运维。
