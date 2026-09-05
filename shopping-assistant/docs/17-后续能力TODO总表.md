# 17-后续能力 TODO 总表

## 1. 文档定位

本文档集中记录当前已经确定要预留、但暂不实现的后续能力。

维护规则：

- 新的后续能力统一写入本文档。
- 旧的单独 TODO 文档只保留为历史入口，不再作为唯一信息源。
- TODO 中的接口只代表预留方向，除非后续任务明确要求，否则不视为已实现接口。

## 当前下一步目标（2026-06-02）

### 目标结论

下一步不再继续扩展新功能，优先把“真实商品数据规模化入库”跑稳。

当前后端主链路、用户图预处理、ANN、候选返回已经具备可用基础；真正限制结果质量的是商品池规模、商品字段质量、商品图 embedding 覆盖率和数据批次管理。

同时新增一个架构硬要求：后续所有数据接入和功能入口必须走 adapter-first。也就是说，真实商品数据规模化入库不是让功能继续依赖八爪鱼或爬虫字段，而是让这些来源先转换成标准 ProductPool 导入契约，再进入商品池和搜索链路。

当前权威方案：

- `docs/21-Adapter分层与数据功能解耦方案.md`
- `services/api-server/src/core/contracts/`

### P0 目标：真实商品批量入库稳定化

本阶段目标：

```text
爬虫/八爪鱼产出淘宝/天猫 JSONL
-> 清洗脚本标准化
-> 验链脚本过滤坏链接
-> 小批量导入云端商品池
-> 图片转存 COS
-> 商品图 embedding 生成
-> 商品进入 ANN 可检索池
-> 云端完整图片搜索 smoke 验证候选可返回
```

已完成：

- 淘宝/天猫清洗脚本：`scripts/normalize-octoparse-taobao.mjs`
- 商品链接与图片链接验链脚本：`scripts/verify-product-links.mjs`
- 使用说明文档：`docs/20-淘宝天猫商品数据清洗验链与入库说明.md`
- 样例数据验证：3187 行原始数据可清洗为 1740 个去重商品；首批 30 条验链全部通过。

待完成：

1. 按品牌/关键词继续整理真实淘宝、天猫商品数据。
2. 每批先清洗、验链，再导入 verified JSON，禁止直接导入原始爬虫数据。
3. 每批控制在 30-100 条，避免在线 embedding 成本和失败范围过大。
4. 每批导入后检查：
   - `totalProducts`
   - `searchableProducts`
   - `embeddingCount`
   - 导入批次状态
   - 失败商品原因
5. 每完成一个有效批次，跑一次云端 smoke：
   - 上传样例图
   - 创建 session
   - 检查 `productProfile`
   - 检查 `queryImagePreprocess`
   - 检查候选数量和 `annScore`
   - 检查 `search-events`

### P1 目标：详情页 SKU 与服务字段补齐

列表页数据只能提供标题、价格、店铺、主图、商品链接等基础字段，无法稳定提供完整 SKU、库存、尺码、款式、店铺评分、发货时间、退换货服务。

下一阶段需要补充详情页数据采集或人工结构化补充：

- 店铺评分
- 预计发货时间
- 预计送达时间
- 是否免运费
- 是否七天无理由退货
- 是否有退货宝/运费险
- 款式列表
- 尺码列表
- 款式 + 尺码维度的价格和库存
- 图集中的款式展示图
- 参数信息标准化字段

### 暂缓事项

以下事项先不作为下一步主目标：

- 评论/问答洞察
- 历史价格
- 配送时效
- 抖音小程序
- 多品类扩展
- 本地离线 embedding provider 完整替换

这些仍保留在后续 TODO 中，但当前不抢真实商品数据入库的优先级。

## 2. 查看更多候选商品

### 2.1 当前状态

后端已实现。

当前能力：

- `CandidatePaginationCursor` 独立游标表已落库。
- 首屏候选写入 `rank/pageIndex/productPoolKey`。
- 用户点击“查看更多”时，后端复用当前 session、当前筛选、最新 query embedding 和已返回商品集合继续全局检索。
- 追加结果写回同一个最新 `CandidateSnapshot`，旧候选 `candidateItemId` 不会被覆盖。
- 新接口不重新识图，不重新生成 query embedding，不按平台分配名额。
- 游标在候选快照、筛选状态、query preprocess snapshot 变化后自动失效。
- cursor 创建、筛选哈希、过期校验、快照绑定校验和 cursor 响应视图已进入 `CandidateCursorAdapter`，后续替换分页存储时不改候选业务编排。

待验证：

- 真实商品池规模达到数百条后，验证第 31-60 条、第 61-90 条排序质量。
- 云端真实商品导入批次扩大后，补一轮完整 smoke。

### 2.2 目标

首屏候选结果默认只返回全局 Top 30。用户如果不满意当前结果，或希望继续查看更多商品，可以在前端点击“查看更多”，由后端继续返回下一批全局排序候选。

该能力用于扩展候选池，不改变当前 session、不重新识图、不重建查询状态。

### 2.3 接口

```text
POST /api/v1/sessions/:sessionId/candidates/more
```

请求：

```json
{
  "cursor": "cand_cursor_xxx",
  "limit": 30
}
```

返回：

```json
{
  "candidateSnapshotId": "cand_snap_xxx",
  "cursor": {
    "nextCursor": "cand_cursor_next_xxx",
    "hasMore": true,
    "returnedRange": {
      "from": 31,
      "to": 60
    }
  },
  "items": []
}
```

### 2.4 实现要求

- 必须复用同一个 `QuerySession`。
- 必须复用已有 `ProductProfileSnapshot`、用户图 embedding、当前有效 `FilterSnapshot`。
- 不重新调用识图模型。
- 不按平台切分候选，不做平台配额。
- 返回第 31-60、第 61-90 等后续全局排序结果，具体数量由 `limit` 控制。
- 前端如果要按平台展示，应基于 `platformName` 自行分组。
- 无更多结果时返回 `hasMore=false`。

### 2.5 当前不做

- 不为平台设置配额。
- 不在“查看更多”时重新触发用户图识别。
- 不在“查看更多”时改写当前筛选条件。

## 3. 商品评论与问答洞察

### 3.1 目标

用户选择某件商品后，可以继续追问商品评论和问答信息，例如：

- 这个商品有什么差评？
- 买家主要吐槽什么？
- 有没有人说尺码偏大或偏小？
- 问大家里有没有关于质量、物流、退换货的问题？

### 3.2 后续能力

- 读取商品评论列表。
- 支持按差评、中评、追评、带图评价筛选。
- 读取商品问答或“问大家”内容。
- 将评论和问答交给 LLM 总结主要吐槽点、尺码反馈、质量风险、物流风险、售后风险。
- 输出可解释的风险摘要，不直接替用户下结论。

### 3.3 预留接口

```text
POST /api/v1/products/:productId/review-insights
GET /api/v1/products/:productId/review-insights/:insightId
```

### 3.4 预留数据对象

```json
{
  "productId": "product_xxx",
  "platform": "taobao",
  "reviewFilter": {
    "rating": "negative",
    "withImagesOnly": false,
    "keywords": ["尺码", "质量", "物流"]
  },
  "summary": {
    "negativePoints": [],
    "sizeFeedback": [],
    "qualityRisks": [],
    "logisticsRisks": [],
    "afterSalesRisks": []
  },
  "rawEvidence": []
}
```

### 3.5 当前不做

- 不批量抓取所有商品评论。
- 不绕过登录、验证码、滑块或风控。
- 不将评论内容混入商品基础 JSON。
- 不在采集阶段调用 LLM 生成评论总结。

## 4. 商品池导入与管理增强

### 4.1 当前状态

商品池基础管理能力已完成：

- `POST /api/v1/product-pool/import` 已改为异步导入，提交后返回 `batchId/status=queued`。
- 导入批次可通过 `GET /api/v1/product-pool/batches` 和 `GET /api/v1/product-pool/batches/:batchId` 查询。
- 导入失败批次支持 `POST /api/v1/product-pool/batches/:batchId/retry`。
- 商品列表、详情、编辑、删除、批次删除、统计接口已可用。
- 导入按 `platform + externalId` 做 upsert，避免同一平台同一外部商品重复写入。
- 商品池统计已能展示商品总量、可检索商品量和 embedding 覆盖情况。
- 早期伪造 50 条商品数据已从云端清理，当前线上商品池使用八爪鱼首批清洗后的淘宝/天猫真实列表页数据。
- 淘宝/天猫原始 JSON/JSONL 已有正式清洗、去重、验链脚本，入库前必须先生成 verified JSON。

### 4.2 本轮已完成

- 增加按批次变更日志和回滚能力：记录本次新增/更新前后的商品及 embedding 快照，支持回滚预检、冲突拦截和执行结果记录。
- 增加导入批次质量报告：覆盖导入成功率、可检索率、图片可用率、商品链接完整率、visual/multimodal embedding 覆盖率、失败原因 Top N 和审核状态分布。
- 增强商品池统计：增加平台分布、标签状态分布和 visual/multimodal embedding 覆盖率。
- 增加可视化运维界面 `/product-pool.html`，支持：
  - 批次筛选、分页、质量详情、失败重试、回滚预检与执行、批次删除。
  - 商品筛选、分页、详情编辑、批量删除。
  - verified JSON 文件导入和 embedding 重建。
  - API 地址与维护 Token 本地配置、桌面和移动端响应式布局。
- 运维入口和后端仍遵循 adapter-first：质量计算、批次视图、回滚快照转换和状态序列化均由 adapter 负责。

### 4.3 仍需后续增强

- 当 `externalId` 缺失或不可靠时，补充更强的 `productUrl`、标题、店铺、图片指纹综合去重。
- 增加导入冲突审计：价格、标题、主图、店铺变化明显时记录差异，必要时进入人工确认。
- 增加大批量导入限速、队列并发和在线 embedding 成本预算，避免单批任务占满 provider 配额。
- 对旧批次补充可回滚基线；本轮变更日志只覆盖迁移上线后新发生的导入。

## 5. 真实图像 embedding、用户图云端预处理与 ANN

### 5.1 当前状态

用户实时搜索链路的云端基础能力已完成：

- 用户上传图的实时处理全部在云端完成，前端不依赖开发机是否开机。
- `POST /api/v1/sessions` 会返回 `queryImagePreprocess`，其中包含 normalized bbox、裁剪状态、embedding 元数据和裁剪图引用。
- 用户图 bbox 当前来自豆包视觉识图结果中的 `subjectDetection`，后端会校验范围，非法或低置信时标记为需要用户选择。
- 后端会按当前有效 bbox 裁剪、补边、标准化，并将裁剪图上传到 COS `demo-assets/embedding-inputs/queries/...`。
- 用户图 embedding 使用云端在线 embedding provider，当前云端验证基线为 `volcengine_doubao_vision / doubao-embedding-vision-251215 / 1024`。
- `POST /api/v1/sessions/:sessionId/subject-selection` 已支持用户多次调整 bbox，每次调整都会生成新的预处理快照和候选快照。
- ANN 召回与标签召回已参与候选融合排序，不按平台配额切分。
- 当前线上首批 30 条淘宝/天猫商品已生成对应商品图 embedding，并通过云端 smoke flow 验证候选可返回。

### 5.2 仍需后续增强

- 商品池规模扩大后，需要持续验证 ANN 排序质量，而不只验证链路可用性。
- 当前 bbox 主要来自识图模型输出，仍需补充更轻量、更稳定的独立主体定位能力。
- 商品图离线预处理仍需加强，避免商家宣传图中的背景、文字、模特裤子等干扰向量。
- 本地 embedding provider 仍需作为离线大批量入库方案继续完善，降低全平台商品入库成本。
- 候选视觉复核质量仍需单独评估，避免相似款误判为严格同款。
- 商品款式图应优先绑定向量；尺码不生成向量。当前列表页数据不足以覆盖完整 SKU/款式图，需等待详情页采集或人工补充。

### 5.3 云端用户图主体定位增强

云端主体定位只负责“快速框出大概商品范围”，不追求像素级精确分割。

当前已实现：

- `POST /api/v1/sessions` 返回默认自动框。
- `POST /api/v1/sessions/:sessionId/subject-selection` 接收前端调整后的 normalized bbox。
- 后端只信任最新有效 bbox，并据此重新裁剪、重新生成用户图 embedding、重新检索。

后续可增强：

- 增加独立轻量鞋主体检测模型或视觉定位服务，不完全依赖识图 prompt。
- 输入压缩识别图或 COS signed URL。
- 输出 `imageWidth`、`imageHeight`、`selectedBox`、`detectedBoxes`、`confidence`、`provider`、`model`。
- 坐标统一使用 normalized 格式，范围为 `0-1`。
- 若检测不到鞋主体，返回明确错误或低置信状态，不伪造 bbox。
- 前端展示亮框并允许用户调整；后端只信任最新有效 bbox。

预留接口：

```text
POST /api/v1/assets/images/:assetId/subject-detection
```

已实现接口：

```text
POST /api/v1/sessions/:sessionId/subject-selection
```

### 5.4 商品离线 embedding 模型切换

当前用户实时链路可使用豆包图片 embedding 模型，但后续全平台、全品类商品图入库如果全部调用在线模型，成本不可接受。

后续需要保留并完善 embedding provider 切换能力：

- `EMBEDDING_PROVIDER` 继续作为统一切换入口。
- 新增本地图片 embedding provider 时，不改商品池导入和 ANN 检索主链路。
- 本地 provider 默认只服务商品池离线准备，不作为用户实时搜索链路依赖。
- 支持通过配置在“在线豆包 embedding”和“本地 embedding 服务/模型”之间切换商品图 embedding 生成方式。
- 本地模型输出维度、归一化方式、相似度算法必须与 ANN 层记录在 metadata 中，避免不同 provider 的向量混用。
- 后续重建向量时，必须支持按 provider/model 批量清理旧 embedding 后重建。

### 5.5 embedding 前鞋图预处理

平台商品图通常是商家宣传图，可能包含裤子、背景、文字、模特姿态等干扰信息。直接对整张图生成 embedding 会降低同款检索准确性。

后续需要在生成 embedding 前增加鞋图预处理：

- 商品展示仍保留商家原图。
- 向量生成使用预处理后的“鞋主体图”。
- 预处理可选方案包括：鞋主体检测框、轻量分割、中心主体裁剪、规则化留白。
- 预处理结果需要记录策略、置信度、裁剪框或失败原因。
- 商品图离线预处理失败时可回退原图，但必须记录 `usedOriginalImage=true`，便于后续评估。
- 用户上传图实时链路不依赖本地预处理服务；云端需要复用同类裁剪、padding、正方形补边和尺寸标准化逻辑。
- 当前代码已预留 `IMAGE_EMBEDDING_PREPROCESSOR` 扩展点，主要用于商品图离线处理。

## 6. 候选视觉复核质量验证

### 6.1 目标

验证 `verifyCandidateVisualMatch` 的真实模型效果，确保不会把相似款误判为严格同款。

### 6.2 后续要求

- 构建正样本、相似款负样本、不同品牌负样本。
- 记录 `sameProduct`、`sameColorway`、`confidence`。
- 设置最低置信阈值。
- 低置信结果不展示或明确降权。

## 7. 历史价格

### 7.1 目标

为候选商品提供价格趋势参考，帮助用户判断当前价格是否值得下单。

### 7.2 预留接口

```text
GET /api/v1/candidates/:candidateItemId/price-history
```

### 7.3 当前不做

- 不接入真实历史价格源。
- 不承诺价格趋势准确性。

## 8. 配送时效

### 8.1 目标

结合用户城市、商家发货地、发货时间和平台物流信息，推测预计送达时间。

### 8.2 预留接口

```text
GET /api/v1/candidates/:candidateItemId/delivery-eta
```

### 8.3 当前不做

- 不保存完整收货地址。
- 不做精确物流预测。

## 9. 抖音小程序入口

### 9.1 目标

后续增加抖音小程序作为第二前端入口，与 APK/Flutter 共用同一套后端业务逻辑。

### 9.2 当前不做

- 不确定小程序前端技术路线。
- 不实现小程序登录、支付或平台专属接口。

## 10. 多平台真实采集器完善

### 10.1 目标

后续逐步补齐淘宝、天猫、京东、得物、拼多多、抖音电商等平台的数据采集能力。

### 10.2 后续要求

- 采集器输出必须符合商品池 JSON 契约。
- 难采集平台允许先空置或手工补样本。
- 采集过程不得写入长期用户隐私数据。
- 浏览器 profile、调试缓存、采集临时结果不进入 GitHub 仓库。

## 11. 多品类扩展

### 11.1 目标

首版聚焦鞋类，后续可扩展到包、服饰、数码等品类。

### 11.2 后续要求

- 每个品类拥有独立商品画像 schema。
- 每个品类拥有独立 prompt 和标签规则池。
- 主查询链路、候选池、用户记忆、多轮筛选逻辑尽量复用。
