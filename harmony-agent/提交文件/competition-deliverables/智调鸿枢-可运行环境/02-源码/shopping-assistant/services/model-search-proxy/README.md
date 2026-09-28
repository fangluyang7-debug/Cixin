# Model Search Proxy

这个目录是 HarmonyOS App 和外部大模型之间的本地代理层。

## 为什么需要这一层

不要把真实 API key 写进 ArkUI / HAP 包里。App 安装包可以被反编译，直接放 key 不安全。

当前链路是：

```text
ArkUI 页面输入需求
-> ModelSearchService 请求本地代理
-> 本地代理读取 .env 中的模型配置
-> 大模型把自然语言转成检索关键词
-> App 把关键词交给 Scheduler 调度层
-> Scheduler 执行本地商品库检索
```

## .env 配置

在项目根目录的 `.env` 中填写：

```env
MODEL_SEARCH_PROXY_PORT=3010
MODEL_SEARCH_PROVIDER=openai_compatible
MODEL_SEARCH_BASE_URL=https://api.example.com/v1
MODEL_SEARCH_MODEL=your-model-name
MODEL_SEARCH_API_KEY=your-api-key
MODEL_SEARCH_TIMEOUT_MS=12000
```

如果 `MODEL_SEARCH_*` 没填，代理会自动尝试复用旧配置：

```env
CHAT_MODEL_BASE_URL=
CHAT_MODEL_NAME=
CHAT_MODEL_API_KEY=
```

如果模型配置仍然不完整，代理不会报废，而是退回本地关键词规则。

## 启动方式

在项目根目录运行：

```bash
npm run model-search:proxy
```

启动后接口地址是：

```text
POST http://127.0.0.1:3010/api/model-search/text
```

请求示例：

```json
{
  "query": "我想买一双适合通勤的男鞋",
  "limit": 20
}
```

返回示例：

```json
{
  "ok": true,
  "source": "model",
  "provider": "openai_compatible",
  "query": "我想买一双适合通勤的男鞋",
  "normalizedKeyword": "男鞋",
  "keywords": ["男鞋", "通勤鞋"],
  "intent": "text_search",
  "answerHint": "",
  "limit": 20
}
```

## 模拟器访问说明

鸿蒙端当前在 `ModelSearchService.ets` 中默认访问：

```text
http://10.0.2.2:3010
```

这个地址用于模拟器访问电脑本机服务。如果真机测试访问不到，需要把它改成电脑在同一 Wi-Fi 下的局域网 IP，例如：

```text
http://192.168.1.23:3010
```
