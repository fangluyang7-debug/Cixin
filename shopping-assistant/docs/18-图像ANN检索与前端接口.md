# 18-图像 ANN 检索与前端接口

本文件聚焦图像 ANN 与 bbox 交互设计。前端实际联调时，以 `docs/16-前端联调接口契约.md` 为主接口文档；如果两处字段描述不一致，以 `16` 为准。

## 1. 当前链路

用户上传图片后，后端主链路为：

```text
POST /api/v1/assets/images
-> POST /api/v1/sessions
-> 豆包视觉识图
-> 云端用户图主体定位
-> 返回 bbox 给前端展示亮框
-> 云端按当前有效 bbox 裁剪 / 标准化
-> 豆包图片 embedding 生成用户图向量
-> 标签召回 + ANN 召回
-> 全局候选融合排序
-> 并发视觉复核
-> CandidateSnapshot / CandidateItem 落库
```

后端不按平台切分候选、不做平台配额。`platformName` 只作为展示字段返回，前端自行分组。

实时用户图链路必须全部在云端完成，不依赖本地 GPU Worker。本地 GPU Worker 只用于商品池离线准备和商品图 embedding 重建。

## 2. 图片上传

```text
POST /api/v1/assets/images
Content-Type: multipart/form-data
```

字段：

```text
file=<图片文件>
variantType=compressed_recognition
sourceType=demo | camera | album
isPrimaryRecognitionAsset=true
```

返回重点：

```json
{
  "assetId": "asset_xxx",
  "assetGroupId": "asset_group_xxx",
  "imageRef": {
    "provider": "tencent_cos",
    "bucketGroup": "compressed-recognition",
    "objectKey": "..."
  }
}
```

## 3. 创建搜索会话

```text
POST /api/v1/sessions
```

请求：

```json
{
  "assetId": "asset_xxx",
  "entrySource": "android_app",
  "categoryHint": "shoe"
}
```

返回重点：

```json
{
  "session": {
    "sessionId": "sess_xxx",
    "status": "ready",
    "stage": "candidate_ready"
  },
  "productProfile": {},
  "queryImagePreprocess": {
    "preprocessSnapshotId": "query_pre_xxx",
    "assetId": "asset_xxx",
    "status": "ready",
    "selectedBox": {
      "x": 0.22,
      "y": 0.36,
      "width": 0.25,
      "height": 0.32,
      "confidence": 0.78,
      "label": "shoe"
    },
    "detectedBoxes": [
      {
        "boxId": "box_1",
        "label": "shoe",
        "confidence": 0.78,
        "x": 0.22,
        "y": 0.36,
        "width": 0.25,
        "height": 0.32
      }
    ],
    "selectionSource": "auto",
    "imageSize": {
      "width": 1280,
      "height": 1707
    },
    "embedding": {
      "provider": "volcengine_doubao_vision",
      "model": "doubao-embedding-vision",
      "dimension": 1024,
      "vectorHash": "sha256..."
    },
    "cropImageRef": {
      "bucketGroup": "demo-assets",
      "objectKey": "embedding-inputs/queries/..."
    }
  },
  "candidateSummary": {
    "candidateSnapshotId": "cand_snap_xxx",
    "candidateCount": 30
  }
}
```

`queryImagePreprocess.selectedBox` 用于前端绘制默认亮框。坐标是相对原图的 `0-1` normalized 坐标，前端必须按当前图片展示尺寸自行换算像素。

## 3A. 用户调整框选范围

如果用户认为系统框选不准，前端可以提交新的框选范围：

```text
POST /api/v1/sessions/:sessionId/subject-selection
```

请求：

```json
{
  "assetId": "asset_xxx",
  "box": {
    "x": 0.2,
    "y": 0.34,
    "width": 0.3,
    "height": 0.36
  },
  "selectionSource": "user_adjusted"
}
```

后端处理：

```text
保存 effectiveSelectedBox
-> 云端按新 bbox 裁剪 / 标准化
-> 调豆包图片 embedding 重新生成用户图向量
-> 重新执行标签召回 + ANN 召回 + 视觉复核
-> 写入新的 CandidateSnapshot
```

返回结构与 `POST /sessions` 的候选摘要保持一致。前端用最新 `candidateSnapshotId` 覆盖旧结果。

返回体还会包含：

```json
{
  "subjectSelection": {
    "preprocessSnapshotId": "query_pre_xxx",
    "candidateSnapshotId": "cand_snap_xxx"
  }
}
```

## 4. 搜索进度 SSE

```text
GET /api/v1/sessions/:sessionId/search-events
Accept: text/event-stream
```

当前实现为基于已落库 session 的事件回放，便于前端统一使用进度事件模型。后续如改为异步搜索任务，可保持同一事件契约。

事件类型：

```text
search_started
profile_ready
subject_detected
subject_selection_updated
embedding_ready
recall_completed
verify_progress
candidate_batch
search_completed
```

`subject_detected` 示例：

```json
{
  "type": "subject_detected",
  "sessionId": "sess_xxx",
  "data": {
    "selectedBox": {
      "x": 0.22,
      "y": 0.36,
      "width": 0.25,
      "height": 0.32
    },
    "detectedBoxes": [],
    "selectionSource": "auto",
    "imageSize": {
      "width": 1280,
      "height": 1707
    }
  }
}
```

`subject_selection_updated` 示例：

```json
{
  "type": "subject_selection_updated",
  "sessionId": "sess_xxx",
  "data": {
    "preprocessSnapshotId": "query_pre_xxx",
    "selectionSource": "user_adjusted",
    "status": "ready"
  }
}
```

`candidate_batch` 示例：

```json
{
  "type": "candidate_batch",
  "sessionId": "sess_xxx",
  "data": {
    "candidateSnapshotId": "cand_snap_xxx",
    "items": [
      {
        "candidateItemId": "item_xxx",
        "title": "Nike Air Zoom Pegasus 40",
        "platformName": "taobao",
        "price": {
          "amount": "399.00",
          "currency": "CNY"
        },
        "stockStatus": "in_stock",
        "coverImageUrl": "https://...",
        "productUrl": "https://...",
        "matchSummary": {
          "sameProduct": true,
          "sameColorway": true,
          "annScore": 0.87,
          "tagMatchScore": 0.76,
          "visualMatchConfidence": 0.82,
          "finalScore": 0.83
        }
      }
    ]
  }
}
```

## 5. 读取候选结果

```text
GET /api/v1/sessions/:sessionId/candidates
```

该接口仍是候选结果的稳定读取入口，适合页面刷新、SSE 断线恢复、详情页回退。

候选关键字段：

```json
{
  "candidateItemId": "item_xxx",
  "title": "",
  "platformName": "taobao",
  "price": {
    "amount": "399.00",
    "currency": "CNY"
  },
  "shopName": "",
  "shopType": "flagship",
  "stockStatus": "in_stock",
  "coverImageUrl": "",
  "productUrl": "",
  "matchSummary": {
    "sameProduct": true,
    "sameColorway": true,
    "annScore": 0.87,
    "tagMatchScore": 0.76,
    "visualMatchConfidence": 0.82,
    "finalScore": 0.83
  },
  "normalizedAttributes": {
    "productId": "product_xxx",
    "styleId": "style_xxx"
  },
  "rawPayload": {
      "productPoolSource": {
        "provider": "local_product_pool",
        "productId": "product_xxx",
        "styleId": "style_xxx",
        "annProvider": "sqlite_vec",
        "embeddingProvider": "local_gpu_worker | volcengine_doubao_vision",
        "embeddingId": "product_emb_xxx",
        "recallSources": ["tag", "ann"]
      }
  }
}
```
