# 可选图像 Worker

复制自此芯项目的 Python 图像服务，供开发机／服务端运行；未携带模型、Python 环境或设备适配。不是鸿蒙原生推理实现。

在根目录运行 `npm run image-worker:dev`，会读取本项目 `.env`，默认监听 `127.0.0.1:7801`。启动前安装 `requirements.txt` 及符合本机条件的推理依赖，配置模型并验证健康状态。

接口保持 `/v1/health`、`/v1/images/extract-subject`、`/v1/images/embed`、`/v1/images/extract-and-embed`。模型与索引兼容性须验证后才能用于实际检索。
