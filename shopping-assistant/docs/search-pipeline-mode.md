# 商品检索链路模式

本项目只保留两种可切换检索链路：

- `current_ann_then_refine`
- `light_tag_ann_fusion`

不再扩展四种 search mode，也不实现“图片 + 标签混合 embedding 后检索”的路线。当前题目要求明确采取方案二，因此本地 `.env` 和 `.env.example` 默认配置为：

```env
SEARCH_PIPELINE_MODE=light_tag_ann_fusion
```

## 模式一：current_ann_then_refine

这是兼容当前链路的对照模式：

1. 用户上传图片并框选主体。
2. 后端裁剪主体图，生成纯图 query embedding。
3. 先走 fast ANN，快速返回相似款预览。
4. 后台继续识别详细商品标签和 profile。
5. 详细 profile ready 后，前端可调用 `/candidates/refine` 刷新正式推荐。

该模式保留原有 fast ANN、后台详细识别、candidate snapshot、pagination cursor 和 `/candidates/refine` 行为。

## 模式二：light_tag_ann_fusion

这是项目答辩推荐展示的方案二：

1. 用户上传图片并框选主体。
2. 后端生成纯图 query embedding。
3. 后端在 `SEARCH_INITIAL_DETAILED_PROFILE_WAIT_MS` 时间内尽量快速生成轻量商品标签和 profile；超时则立即退化为纯图 ANN。
4. Route A 使用标签/关键词做 tag recall。
5. Route B 使用纯图 embedding 做 ANN recall。
6. 两路候选合并去重，综合排序后返回 Top K。
7. 前端只展示用于搜索的核心标签，并允许用户修改。
8. 用户保存修改后，后端写回 `ProductProfileSnapshot` 并用修改后的 profile 重新融合检索。

该模式允许轻量标签识别失败时退化为纯图 ANN，不允许让识别失败中断整条搜索链路。

核心标签规则：

- 鞋类：只展示品牌、主色、鞋型（如板鞋、跑鞋、篮球鞋、休闲鞋等）。
- 其他品类：只展示品牌、主色、品类/型号中的核心项。
- 不展示 `keywords`、`styleTags`、`sceneTags` 里的泛化描述词。
- 品牌和鞋型会写入实际搜索 filter，用作商品召回约束；主色暂作为匹配信号，避免颜色误识别直接筛空结果。
- 前端展示中文标签，例如 `Puma` 显示为“彪马”，`lifestyle` 显示为“休闲鞋”。
- 识别出品牌后，ANN 的 `productIds` 只从该品牌商品集合中生成；标题包含冲突品牌的脏数据会被排除。
- 图片搜索结果必须达到 `SEARCH_RESULT_MIN_SCORE` 才返回，默认阈值为 `0.55`。

首屏默认超时：

```env
SEARCH_INITIAL_DETAILED_PROFILE_WAIT_MS=1500
SEARCH_DETAILED_PROFILE_TIMEOUT_MS=30000
VISUAL_VERIFY_TIMEOUT_MS=5000
SEARCH_RESULT_MIN_SCORE=0.55
```

## 为什么不做混合 embedding

暂不启用“图片 + 标签 -> 混合 embedding -> 向量库检索”，原因是：

- 混合 embedding 的语义贡献不容易解释。
- 用户修改标签后，检索结果变化不如显式 tag recall 可控。
- 自然语言筛选和答辩展示更需要可解释的召回来源。
- 当前商品池已经支持 tag recall、ANN recall 和候选融合，无需引入第三条 Route C。

允许的方案是：

```text
tags / keywords -> tag recall
image embedding -> visual ANN recall
merge -> rerank -> topK
```

禁止的方案是：

```text
image + tags -> multimodal embedding -> ANN search
```

## 切换方式

环境变量：

```env
SEARCH_PIPELINE_MODE=current_ann_then_refine
```

或：

```env
SEARCH_PIPELINE_MODE=light_tag_ann_fusion
```

请求级覆盖优先级更高：

```json
{
  "filters": {
    "searchPipelineMode": "light_tag_ann_fusion"
  }
}
```

优先级为：

```text
filters.searchPipelineMode > SEARCH_PIPELINE_MODE > current_ann_then_refine
```

## 前端入口

Flutter 结果页会显示：

- 当前检索链路。
- 后端识别出来、实际用于搜索的核心商品标签。
- “修改”按钮，用于编辑品牌、颜色、鞋型/品类型号。
- “当前链路 / 方案二”分段切换。

保存标签或切换模式后，前端调用：

```http
PATCH /api/v1/sessions/{sessionId}/profile
```

后端会写回 profile snapshot，并用当前主体图 embedding 和修改后的标签重新生成候选。

## 答辩推荐表述

我们将商品检索链路抽象成两种可切换模式。默认演示模式采用方案二：轻量标签 + ANN 融合。系统先快速生成商品标签和关键词，同时进行纯图向量召回，之后将标签召回结果与 ANN 召回结果合并去重并综合排序取 Top K。前端会展示识别出来的搜索标签，并允许用户修改；修改后后端会用新的标签重新检索。这样既能展示“识别关键词驱动检索”的能力，也保留了视觉相似度召回的稳定性。当前暂不启用图片与标签混合 embedding 检索，避免黑盒向量结果影响属性修正和自然语言筛选的可控性。
