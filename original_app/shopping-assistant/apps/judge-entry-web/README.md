# Judge Entry Web

Vite 多页面前端，当前承载：

- `/`：评委展示入口，包含项目说明、线上状态、APK 下载位、核心截图和体验路径。
- `/catalog.html`：真实商品池只读展示页。
- `/debug.html`：Web 图片上传与搜索诊断入口。
- `/product-pool.html`：商品池运维中心。

本目录不承载核心业务 API。页面默认连接 Zeabur API：

```text
https://apiserver.zeabur.app
```

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
PUBLIC_API_BASE_URL=https://apiserver.zeabur.app
PUBLIC_APK_DOWNLOAD_URL=
```

`PUBLIC_APK_DOWNLOAD_URL` 为空时，首页会保留 APK 下载位并提示待配置。
