# Shopping payload v1

`schemas.json` 是本仓库的受限校验描述格式（不是标准 JSON Schema）。16 个业务家族从同一来源生成 TypeScript / ArkTS 接口与已知字段校验器。运行 `npm run contracts:generate` 后，两个生成文件必须完全一致。服务端额外校验有限 JSON、深度、大小与保留键。

| 家族 | 对应业务 |
|---|---|
| query | 文字、图片引用、会话、主体、筛选与操作 |
| image / preprocess / quality | 图像元数据、主体框、预处理与实际尺寸检查 |
| profile / embedding | 品类及可空画像、向量与兼容元数据 |
| product / candidate | 原始商品、候选身份、金额、commerceMeta、sortSignals、decisionSupport |
| candidate-set / price-stock | 快照、过滤、候选池与价格库存来源 |
| filters | 原有 set/remove/reset 与全部排序规则 |
| session / pagination | 会话状态、版本、轮次和分页游标 |
| answer / user-context / result | 回答、用户上下文、完整业务结果 |

金额保留源字符串（例如 `123.4500`），不把 ID 相互替代。未知值保留 null，不假造模型版本、外部价格时间或评分。额外字段放入服务端私有 `__extensionsV1`，解码恢复原形；它不属于遥测或设备目录。`__proto__` 等保留键拒绝。

`fixtures.json` 包含各家族全部已声明字段。自动化同时验证：双端生成文件相同、生成校验器、服务端 encode/decode 无损、既有过滤字段、实际 HTTP 候选响应（包含支付方式对象）。当前 schema 必填最小集服务于渐进兼容，不表示所有业务操作都允许任意缺字段；具体 DTO 和执行器仍负责操作校验。

App 的 `ShoppingResult.payload` 提供生成的类型视图；`payloadJson` 保留兼容快照。旧 Product[] API 是明确的投影。非商品结果的 products 为 null，不能解释为检索成功但没有商品。
