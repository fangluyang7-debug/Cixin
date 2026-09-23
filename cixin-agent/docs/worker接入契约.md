# 模型 Worker 接入契约 v1

本契约位于 `src/plugins/process-worker.ts`，用于隔离 Node Runtime 与各板型号的 NOE/GPU/CPU SDK。当前仓库只提供协议宿主，不提供未知版本 NOE SDK 的伪实现。

## Manifest

从应用注册的 ToolDescriptor 和本板可执行的 TaskTemplate 生成 manifest：

```json
{
  "protocolVersion": 1,
  "descriptor": {
    "toolId": "image.embedding",
    "version": "1.0.0",
    "description": "已验证模型的图像向量工具",
    "inputType": "image.preinstalled-ref.v1",
    "outputType": "image.embedding.v1",
    "preconditions": ["板端允许访问的输入引用"],
    "postconditions": ["输出维数与索引匹配"],
    "quality": { "minimumScore": 0.9 },
    "constraints": { "privacy": "internal", "locality": "local_preferred", "allowLocal": true, "allowCloud": false },
    "resourceHints": { "computeClass": "neural_inference", "estimatedMemoryMb": 512 },
    "execution": { "supportsPause": false, "supportsRetry": false, "maxAttempts": 1, "compensationActions": [] },
    "defaultWeights": { "latency": 0.5, "quality": 0.3, "energy": 0.1, "reliability": 0.1 }
  },
  "template": {
    "capability": "image.embedding", "concurrentSafe": false,
    "taskType": "USER_INITIATED", "inferenceLocation": "LOCAL_DEVICE",
    "interruptibility": "CANCEL_RESTART", "duplicatePolicy": "KEEP_ALL", "privacyPolicy": "LOCAL_ONLY",
    "timeoutMs": 10000,
    "resourceHints": { "modelVersion": "实际模型版本", "expectedMemoryMb": 512 },
    "qualityLevels": [{
      "id": "validated", "modelTier": "HIGH_ACCURACY", "estimatedLatencyMs": 100,
      "estimatedMemoryMb": 512, "supportedBackends": ["NPU"], "supportedThreadCounts": [1]
    }],
    "manifest": {
      "defaultProfileId": "noe-validated", "fallbackProfileId": "noe-validated", "profileTransitions": [],
      "profiles": [{
        "id": "noe-validated", "qualityLevelId": "validated", "modelTier": "HIGH_ACCURACY",
        "backend": "NPU", "workerCount": 1, "allowWarmup": false,
        "supportsForeground": true, "supportsBackground": true,
        "estimatedQualityLevel": "HIGH_ACCURACY", "safeUnderPressure": false,
        "qualityValidated": true, "lowRisk": true
      }]
    }
  },
  "model": { "path": "embedding.bin", "sha256": "替换为该板模型文件的64位小写SHA256" },
  "runtime": { "name": "noe", "version": "实际SDK版本" }
}
```

此示例说明结构，**数值、质量验证、模型版本和路径都不是已经取得的测试结论**，不可直接用作上线配置。`qualityValidated`、`minimumScore`、内存和耗时必须由工具开发者按实际模型验证后填写。单个进程 Worker 当前只允许一个 execution profile；多个档位可实现单独的代码插件，不得让 Worker 忽略传入配置。

## 探测请求

宿主先校验模型文件 SHA-256，再启动固定程序，向 stdin 写入单个 JSON（以 EOF 结束）：

```json
{
  "protocolVersion": 1, "operation": "probe",
  "modelPath": "/opt/models/embedding.bin", "modelSha256": "<实际摘要>",
  "runtime": { "name": "noe", "version": "<实际版本>" }, "backend": "NPU"
}
```

Worker 应实际检查 SDK、驱动、模型可加载性和所需算子，不能根据请求中的 backend 直接回显“可用”。stdout：

```json
{
  "protocolVersion": 1, "available": true, "backend": "NPU",
  "modelSha256": "<实际摘要>", "runtimeVersion": "<实际版本>"
}
```

探测最多 3 秒，成功结果最多缓存 1 秒；模型文件大小/修改时间/变更时间改变时重新算哈希。探测失败不会注册为可用 NPU。

## 执行请求与回执

执行请求保留上述公共字段，`operation=execute`，增加 `input` 和完整 `profile`。Worker 负责验证业务输入及允许的文件引用，按 profile 执行 SDK 推理。输入中的路径不是任意文件访问授权。

stdout 返回：

```json
{
  "protocolVersion": 1,
  "modelSha256": "<实际摘要>", "runtimeVersion": "<实际版本>",
  "quality": 0.95,
  "result": {
    "output": { "embedding": [0.1, 0.2], "dimension": 2, "modelVersion": "<实际版本>" },
    "telemetry": {
      "profileId": "noe-validated", "actualBackend": "NPU", "actualModelTier": "HIGH_ACCURACY",
      "actualThreads": 1, "workerCount": 1, "executionPath": "noe_native"
    }
  }
}
```

上面的向量和质量分仅为格式示例。质量指标必须与逻辑 ToolDescriptor 的度量定义相同，不能把分类 confidence 随意当成检索召回率。SDK 若回退 CPU，应如实返回实际后端，宿主会拒绝这次 NPU 配置匹配，而非训练错误的 NPU 样本。

只允许单个 JSON 回执写 stdout；诊断信息写 stderr。stdout 限 1 MiB，结果输出限 512 KiB，超时或取消会结束子进程。Worker 必须同步持有真实工作，不得把任务交给脱离生命周期的后台进程；同一 attempt 的额外业务副作用需由插件自行避免。

运行时版本、执行模型、维度/归一化等逻辑语义变化时，更新 manifest 的工具版本/模型摘要，在所有参与板和索引上重新确认兼容性。模型、索引、驱动不可互换时应返回不可用。
