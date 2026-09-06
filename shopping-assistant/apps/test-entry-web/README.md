# Shopping Assistant Web Test Console

Vite 多页面前端，当前承载：

- `/`：测试入口，包含运行状态、核心链路和体验路径。
- `/catalog.html`：真实商品池只读展示页。
- `/debug.html`：Web 图片上传与搜索诊断入口。
- `/product-pool.html`：商品池运维中心。

本目录不承载核心业务 API。页面默认连接本机 API：

`http://localhost:3000`

## Local

```powershell
npm install
npm run web:dev
```

本地入口：

```text
http://localhost:5173/
http://localhost:5173/catalog.html
http://localhost:5173/debug.html
http://localhost:5173/product-pool.html
```

## Deployment Variables

```env
PUBLIC_API_BASE_URL=http://localhost:3000
```

外部 API 地址必须由部署者显式配置。
