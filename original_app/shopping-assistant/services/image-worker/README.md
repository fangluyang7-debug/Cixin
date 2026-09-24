# Local Image Worker

本地 GPU 图像处理服务，负责商品主体提取和本地图片 embedding。主 NestJS 后端通过 HTTP 调用本服务。

## Setup

```powershell
cd services/image-worker
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

如需 CUDA 版 PyTorch，请按本机 CUDA 版本从 PyTorch 官方源安装对应 wheel，再安装其余依赖。

## Run

```powershell
$env:IMAGE_WORKER_HOST="127.0.0.1"
$env:IMAGE_WORKER_PORT="7800"
$env:IMAGE_WORKER_DEVICE="auto"
$env:IMAGE_WORKER_DETECTION_MODEL="yolov8s-world.pt"
$env:IMAGE_WORKER_DETECTION_CLASSES="shoe,sneaker,boot,sandal,camera,headphones,earphones,earbuds,headset,watch,smartwatch,cell phone,mobile phone,smartphone,laptop,computer,tablet,keyboard,computer keyboard,computer mouse,mouse,electronics,digital device"
$env:IMAGE_WORKER_QUERY_DETECTION_CLASSES="shoe,camera,headphones,smartwatch,mobile phone,laptop,tablet,keyboard,computer mouse,electronics"
$env:IMAGE_WORKER_WARMUP_DETECTOR="true"
$env:IMAGE_WORKER_DETECTION_CONF="0.08"
$env:IMAGE_WORKER_QUERY_DETECTION_CONF="0.02"
$env:IMAGE_WORKER_EMBEDDING_MODEL="ViT-B-32"
$env:IMAGE_WORKER_EMBEDDING_PRETRAINED="laion2b_s34b_b79k"
python -m app.main
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:7800/v1/health
```

## API

- `GET /v1/health`
- `POST /v1/images/extract-subject`
- `POST /v1/images/embed`
- `POST /v1/images/extract-and-embed`

`extract-subject` 会返回商品主体裁剪图的 base64。检测失败时返回原图标准化结果，并标记 `usedOriginalImage=true`。
