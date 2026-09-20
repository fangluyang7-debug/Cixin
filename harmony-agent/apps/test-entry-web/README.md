# Harmony Agent Web 调试端

在项目根运行 `npm run web:dev`，默认端口 5180，读取根 `.env` 中的 `PUBLIC_API_BASE_URL`／`VITE_API_BASE_URL`。各调试页面的默认后端为 3100。

页面：`/` 开发入口、`/runtime.html` 运行时控制台、`/debug.html` 购物联调、`/catalog.html` 数据浏览、`/product-pool.html` 数据维护。

这些页面复用了此芯项目的购物示例和调度盘，不是 HarmonyOS 原生界面。原生应用后续在 `apps/harmony` 开发。运行时真实资源未配置时返回阻断是预期行为。
