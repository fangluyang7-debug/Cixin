# 19-本地 GPU 图像处理链路

## 1. 定位

本地 GPU Worker 负责离线商品图鞋主体提取和本地图片 embedding。NestJS 主后端仍负责商品池、COS、数据库、ANN、搜索会话和前端接口。

本链路不部署到 Zeabur，默认在开发机本地运行。

重要边界：

- 本地 GPU Worker 不属于用户实时搜索链路。
- 用户上传图的主体定位、裁剪标准化、豆包 embedding 和 ANN 检索必须全部在云端完成。
- 本地 GPU Worker 只用于商品池离线准备、商品图 embedding 批量生成或重建。
- 开发机未开机时，线上用户仍必须能使用已有商品池完成搜索。

## 2. 服务划分

```text
NestJS API Server / 离线维护脚本
-> Local Image Worker
   -> YOLO-World 鞋主体检测
   -> 标准化裁剪
   -> OpenCLIP 图片向量
-> NestJS 写入 COS / SQLite / ANN
```

## 3. 后端环境变量

```env
ENABLE_LOCAL_IMAGE_WORKER=true
IMAGE_EMBEDDING_PREPROCESSOR=local_gpu_worker
EMBEDDING_PROVIDER=local_gpu_worker
LOCAL_IMAGE_WORKER_BASE_URL=http://127.0.0.1:7800
LOCAL_IMAGE_WORKER_TIMEOUT_MS=60000
EMBEDDING_MODEL_NAME=open_clip:ViT-B-32:laion2b_s34b_b79k
EMBEDDING_DIMENSION=512
```

这些变量只应用于本地离线商品处理或本地验证环境，并且必须显式设置 `ENABLE_LOCAL_IMAGE_WORKER=true` 才会进入 worker 分支。Zeabur 等云端实时服务不得配置为依赖 `LOCAL_IMAGE_WORKER_BASE_URL=http://127.0.0.1:7800`。

## 4. 本地 Worker 启动

```powershell
cd services/image-worker
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m app.main
```

如果需要使用 GPU，必须安装 CUDA 版 PyTorch。当前全局 Python 检查结果显示 `torch` 是 CPU 版，不能代表最终 GPU 运行环境。

## 5. 数据原则

- 商品原图继续用于前端展示。
- 鞋主体裁剪图只用于 embedding。
- 裁剪图上传到 COS `demo-assets/embedding-inputs/...`。
- `ProductImageEmbedding.preprocessJson` 记录裁剪策略、bbox、置信度、是否回退原图。
- 切换 embedding provider 或模型后必须重建向量，不允许混用旧向量。
- 本地生成的商品 embedding 必须能被云端 API 读取和检索。
- 用户图 embedding 当前由云端豆包 embedding 模型实时生成；不得要求用户实时请求访问本地 worker。

## 6. 验收命令

```powershell
Invoke-RestMethod http://127.0.0.1:7800/v1/health
npm --workspace services/api-server run db:init
npm run api:build
```

完整链路验收仍使用：

```text
POST /api/v1/assets/images
POST /api/v1/sessions
GET  /api/v1/sessions/:sessionId/candidates
```
