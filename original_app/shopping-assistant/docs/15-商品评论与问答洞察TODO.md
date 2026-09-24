# 15-商品评论与问答洞察 TODO

> 本文档已整合进 `docs/17-后续能力TODO总表.md`。
> 后续 TODO 维护以 17 文档为准，本文只保留评论与问答洞察的历史入口。

## 1. 目标

用户选择某件商品后，可以继续追问商品评论和问答信息，例如：

- 这个商品有什么差评？
- 买家主要吐槽什么？
- 有没有人说尺码偏大或偏小？
- 问大家里有没有关于质量、物流、退换货的问题？

本功能不进入当前采集版本，只预留数据和接口方向。

## 2. 后续能力

- 读取商品评论列表。
- 支持按差评、中评、追评、带图评价筛选。
- 读取商品问答或“问大家”内容。
- 将评论和问答交给 LLM 总结主要吐槽点、尺码反馈、质量风险、物流风险、售后风险。
- 输出可解释的风险摘要，不直接替用户下结论。

## 3. 预留接口

```text
POST /api/v1/products/:productId/review-insights
GET /api/v1/products/:productId/review-insights/:insightId
```

## 4. 预留数据对象

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

## 5. 当前不做

- 不批量抓取所有商品评论。
- 不绕过登录、验证码、滑块或风控。
- 不将评论内容混入商品基础 JSON。
- 不在采集阶段调用 LLM 生成评论总结。
