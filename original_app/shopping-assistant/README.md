# 智能比价助手

面向评委可自行体验的智能比价助手。当前版本聚焦鞋类：用户拍照或上传鞋图，系统返回已接入平台范围内的低价候选，并支持用自然语言在同一会话里继续收敛结果。

口号：`Just say the word.`

## 当前目录

```text
apps/
  mobile-flutter/       # Android Flutter 客户端，当前已完成前端首版演示链路
  judge-entry-web/      # 评委入口静态页
services/
  api-server/           # NestJS + Prisma + SQLite 后端
docs/                   # 权威规划、接口、进度与 TODO 文档
samples/                # 商品池样例、导入样本与本地调试数据入口
scripts/                # 本地辅助脚本说明
infra/zeabur/           # Zeabur 部署说明和配置草案
```

## 进度入口

当前项目进度持续记录在：

- `docs/13-项目进度跟踪.md`

当前概况：

- 前端 Flutter 安卓端已完成首版首页、拍照/相册入口、语音入口、结果页跳转、流式商品卡、多轮筛选、建议卡片和商品详情本地 demo。
- 后端主路线已调整为 `ProductPool 商品池 + 多平台数据注入 + ANN 相似检索`，聚合搜索 API 仅作为后续可选适配路线。
- 用户实时链路必须在云端完成；本地 GPU 只用于商品图离线预处理、embedding 批量生成和商品池重建。
- 云端后端主链路已通过 smoke 验证：COS 上传、豆包识图、用户图裁剪、豆包 embedding、ANN + 标签召回、候选返回和 SSE 进度事件均可用。
- 当前线上商品池已清除早期伪造数据，使用首批 30 条八爪鱼清洗后的淘宝/天猫鞋类商品，并已生成 30 条商品图 embedding。
- 当前仍守住鞋类主链路，不扩展到非鞋类、历史价格真实链路或应用商店分发。

## 本地启动顺序

1. 后端：

```powershell
npm install
Copy-Item .env.example .env
npm --workspace services/api-server run prisma:generate
npm --workspace services/api-server run db:init
npm run api:dev
```

2. 评委入口页：

```powershell
npm run web:dev
```

3. Flutter 客户端：

在 `apps/mobile-flutter/` 内运行：

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter devices
flutter run -d emulator-5554
```

如需连接已部署后端，默认使用 Android Emulator：

```powershell
cd D:\shopping-assistant\apps\mobile-flutter
flutter run -d emulator-5554 --dart-define=ENABLE_BACKEND=true --dart-define=API_BASE_URL=https://apiserver.zeabur.app
```

不加 `ENABLE_BACKEND=true` 时，Flutter 会继续使用本地 demo 数据，适合只看前端界面。

移动端前端开发和截图验证统一使用 Android Emulator，详见 `docs/23-Mobile前端开发链路.md`。

## 当前已落地骨架

- `GET /api/v1/health`
- `POST /api/v1/assets/images`
- `POST /api/v1/sessions`
- `GET /api/v1/sessions/{sessionId}`
- `GET /api/v1/sessions/{sessionId}/search-events`
- `POST /api/v1/sessions/{sessionId}/subject-selection`
- `POST /api/v1/sessions/{sessionId}/turns`
- `GET /api/v1/sessions/{sessionId}/candidates`
- `GET /api/v1/candidates/{candidateItemId}`
- `GET /api/v1/sessions/{sessionId}/suggestions`
- `POST /api/v1/product-pool/import`
- `GET /api/v1/product-pool/products`
- `GET /api/v1/product-pool/stats`

完整前端联调契约以 `docs/16-前端联调接口契约.md` 为准。

商品来源建议：优先把爬虫、授权 API、半自动整理或手工样本导入 `product-pool`，再用 `PRODUCT_DATA_PROVIDER=local_product_pool` 做相似检索；`marketplace` provider 只作为可切换适配层。

图像处理边界：用户上传图的主体定位、裁剪标准化和豆包 embedding 必须走云端；本地 `services/image-worker/` 只服务商品池离线准备，不是线上实时依赖。

图片与 APK 文件存储改为国内对象存储，代码层通过 provider-neutral storage adapter 接入，当前默认腾讯云 COS。

线上部署基线改为 `Zeabur + 腾讯云 COS`：Zeabur 承载 NestJS API、评委静态页和 SQLite Volume，腾讯云 COS 承载图片与 APK 文件。

## 云端 smoke 验证

后端云端主链路可用以下脚本验证：

```powershell
npm run api:smoke:cloud -- `
  -BaseUrl https://apiserver.zeabur.app `
  -ImagePath D:\shopping-assistant\user_image_sample.jpg
```

脚本会依次验证 health、图片上传、创建 session、读取候选和搜索进度事件。它不会导入商品，也不会重建商品 embedding。
