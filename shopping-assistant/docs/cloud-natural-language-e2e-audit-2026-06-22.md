# 自然语言与图片筛选双模式云端验收报告

审计日期：2026-06-22  
云端 API：`https://apiserver.zeabur.app`  
最终部署提交：`ee20755`  
部署状态：`RUNNING`

## 1. 结论

17 类自然语言问题修复已通过本地门禁和云端公开 API 验收：

| 验收项 | `current_ann_then_refine` | `light_tag_ann_fusion` |
|---|---:|---:|
| 初始路由 | 35/35 | 35/35 |
| 单轮意图与筛选 | 90/90 | 90/90 |
| 受控多轮工作流 | 16/16 | 16/16 |
| 状态安全 | 6/6 | 6/6 |
| 输入边界 | 6/6 | 6/6 |
| **合计** | **153/153** | **153/153** |

双模式合计 `306/306`，语义通过率 100%。云端 5xx、超时和模型非法 JSON 均为 0；回复与实际状态不一致为 0。

## 2. 链路一致性

验收只调用用户实际使用的公开 HTTP 边界：

1. 每次运行生成独立设备 UUID、随机密码和 `mobile-<uuid>@shopping-assistant.local` 账户。
2. 经过与 Flutter 相同的注册、Bearer Token、文本建会话、提交轮次和候选读取流程。
3. 文本初始输入调用 `POST /api/v1/sessions/text`。
4. 多轮输入调用 `POST /api/v1/sessions/:sessionId/turns`。
5. 图片流程调用 multipart `POST /api/v1/assets/images`、`POST /api/v1/sessions`、`PATCH /api/v1/sessions/:sessionId/profile` 和自然语言轮次接口。
6. 请求显式携带当前 `searchPipelineMode`，并逐条断言响应中的模式没有漂移。
7. 每个单轮用例使用独立会话，避免前一条用例污染后一条。

没有使用本地 API、mock HTTP、直接 Service 调用或共享移动端账户补齐云端结果。

## 3. 云端统计

| 指标 | 纯 ANN 后细化 | 轻标签 + ANN 融合 |
|---|---:|---:|
| 平均用例时延 | 4.716 s | 4.747 s |
| P50 | 6.097 s | 6.092 s |
| P95 | 7.542 s | 8.005 s |
| 最大时延 | 10.594 s | 11.208 s |
| 超过 30 秒 | 0 | 0 |
| `local_semantic_v2` | 104 | 101 |
| 云模型解析 | 2 | 5 |
| 云异常 | 0 | 0 |

绝大多数筛选由确定性 V2 语义层完成；型号、参数或普通聊天等少量输入仍可进入云模型，但最终状态继续经过相同校验器。

## 4. 图片工作流

使用仓库真实 smoke 图片 `user_image_sample.jpg` 经过公开 API 验证：

| 模式 | 初始候选 | `只看阿迪` 后候选 | 品牌结果 | 画像 PATCH/自然语言一致 |
|---|---:|---:|---|---|
| `current_ann_then_refine` | 0 | 4 | 全部为 Adidas | 通过 |
| `light_tag_ann_fusion` | 8 | 7 | 全部为 Adidas | 通过 |

附加断言：

- 返回候选 `finalScore >= 0.55`。
- 显式品牌筛选后没有 Nike/耐克标题冲突商品。
- PATCH 将画像品牌设为 Nike 后，后台识别任务不能覆盖用户编辑。
- “品牌不限”同时清除品牌硬筛选和有效画像品牌。
- 后续“只看阿迪”覆盖识别品牌约束，模式保持不变并执行完整重搜。
- 两种模式的详细标签在首屏阶段均可能仍为 `running`；融合模式仍先返回 8 个视觉候选。
- 标签失败回退纯视觉 ANN 由强制单元测试模拟 `profile=null` 验证。生产云端未通过破坏标签供应商来制造故障，因此本轮没有伪造“云端标签失败已发生”的结论。

## 5. 云端发现并修复的问题

全量审计不是只做通过性证明，实际发现并修复了以下问题：

1. clarification 会话按要求不创建候选快照，但响应装配仍读取快照，导致 404。
2. 只给预算或平台、未给商品主体时，回复声称条件已应用但状态未保留。
3. “鞋不看了，换手机”的新类目被旧类目画像覆盖回 shoe。
4. 销量/新品不支持说明被搜索守卫强制改成 `refine_filter`。
5. “新品优先”误命中“排除二手平台”。
6. 后台图片识别完成较晚时覆盖用户刚 PATCH 的画像。
7. 图片融合回填和纯 ANN 快速路径仍沿用 0.38 门槛，绕过 0.55 结果门槛。
8. 云端图片审计脚本最初使用了错误的上传 `sourceType`，已改为 Flutter/API 合法值 `camera`。

上述问题均增加了回归测试或公开 API 断言。

## 6. 本地门禁

| 命令 | 结果 |
|---|---:|
| `npm run api:build` | 通过 |
| `npm run api:test:ci` | 129/129 单元测试、7/7 E2E、两个 smoke 通过 |
| `npm run api:audit:natural-language:local` | 137/137 |
| `flutter analyze` | 通过 |
| `flutter test` | 21/21 |

Prisma 的 major version 升级提示只是信息提示，不计为错误，也不是任何一次 NestJS 崩溃原因。

## 7. 可复现资产

- 本地固定语料：`services/api-server/scripts/natural-language-robustness-audit.ts`
- 云端双模式语义审计：`services/api-server/scripts/cloud-natural-language-e2e-audit.ts`
- 云端图片工作流：`services/api-server/scripts/cloud-image-semantic-workflow.ts`
- 纯 ANN JSON：`artifacts/qa/cloud-natural-language-e2e-audit-current_ann_then_refine.json`
- 融合模式 JSON：`artifacts/qa/cloud-natural-language-e2e-audit-light_tag_ann_fusion.json`
- 图片工作流 JSON：`artifacts/qa/cloud-image-semantic-workflow.json`

执行命令：

```powershell
npm run api:audit:natural-language:both
npm run api:audit:image-semantic:cloud
```
