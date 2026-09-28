# 源码说明

`shopping-assistant/apps` 是比赛演示系统的HarmonyOS NEXT工程：

- `entry`：ArkUI/ArkTS演示应用，包含本地商品库、MindSpore Lite Embedding、图片/文字检索、调度显示和实验控制台。
- `scheduler`：独立HAR模块，包含公共类型、系统状态控制器、调度策略、防震荡、优先队列、执行器注册、取消/超时、日志和指标。

`shopping-assistant/services/model-search-proxy` 是可选的OpenAI兼容代理。端侧本地检索和调度不依赖该代理。

源码快照未包含：

- `.env`、API密钥、证书、私钥或签名Profile。
- `build`、`.test`、`.hvigor`、`oh_modules`、IDE设置和本地SDK路径。
- 历史Android/Capacitor资产、大规模样本池、模拟训练CSV和过程日志。

依赖可由OHPM根据 `apps/oh-package-lock.json5` 恢复。构建与测试方法见 `../04-测试环境/02-测试环境与运行说明.md`。
