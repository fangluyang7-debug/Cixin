# Shopping Assistant Web Test Console

Vite 多页面前端，当前承载：

- `/`：测试入口，包含运行状态、核心链路和体验路径。
- `/catalog.html`：真实商品池只读展示页。
- `/debug.html`：Web 图片上传与搜索诊断入口。
- `/product-pool.html`：商品池运维中心。
- `/runtime.html`：基于 `控制台/code.html` 设计的 Agentic Runtime 调度监控台，使用 Runtime snapshot 轮询和 SSE 状态事件更新，不使用随机模拟遥测。

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
http://localhost:5173/runtime.html
```

调度监控页的 Tailwind 样式在启动/构建时生成到 `public/runtime-tailwind.css`，运行时不依赖 Tailwind CDN。Google Fonts 加载失败时会回退到系统字体，不影响布局和数据更新。

## Deployment Variables

```env
PUBLIC_API_BASE_URL=http://localhost:3000
```

外部 API 地址必须由部署者显式配置。
