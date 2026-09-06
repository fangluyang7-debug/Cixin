import { ConfigService } from "@nestjs/config";
import { ToolPlugin } from "./runtime.contracts";

export function createShoppingPlugin(config: ConfigService): ToolPlugin {
  const embeddingModel = optionalString(
    config.get<string>("embedding.modelName"),
  );
  const visionModel = optionalString(
    config.get<string>("modelProviders.vision.modelName"),
  );
  const chatModel = optionalString(
    config.get<string>("modelProviders.chat.modelName"),
  );

  return {
    pluginId: "shopping-assistant-test-plugin",
    version: "1.0.0",
    tools: [
      {
        toolId: "image.quality_check",
        version: "1.0.0",
        description: "评估输入商品图片是否满足后续识别和检索要求",
        inputType: "ImageRegion",
        outputType: "ImageQualityReport",
        preconditions: ["inputRef 指向可读取的图像资源"],
        postconditions: ["输出清晰度、主体可见性和裁剪建议"],
        quality: { requiresConfidence: true, minimumConfidence: 0.75 },
        constraints: {
          privacy: "high",
          locality: "local_preferred",
          allowLocal: true,
          allowCloud: true,
          maxLatencyMs: 500,
        },
        resourceHints: {
          computeClass: "neural_inference",
          estimatedMemoryMb: 256,
          modelId: visionModel,
        },
        execution: {
          supportsPause: false,
          supportsRetry: true,
          maxAttempts: 2,
          compensationActions: ["降低输入分辨率", "请求用户重新上传图片"],
        },
        defaultWeights: {
          latency: 0.45,
          quality: 0.3,
          energy: 0.1,
          reliability: 0.15,
        },
      },
      {
        toolId: "image.crop",
        version: "1.0.0",
        description: "根据图像主体位置生成标准化检索区域",
        inputType: "ImageRegion",
        outputType: "ImageRegion",
        preconditions: ["输入图片已上传"],
        postconditions: ["输出区域满足目标尺寸和格式要求"],
        quality: { requiresConfidence: false },
        constraints: {
          privacy: "high",
          locality: "local_only",
          allowLocal: true,
          allowCloud: false,
        },
        resourceHints: { computeClass: "general_cpu", estimatedMemoryMb: 96 },
        execution: {
          supportsPause: false,
          supportsRetry: true,
          maxAttempts: 2,
          compensationActions: ["使用原图继续处理"],
        },
        defaultWeights: {
          latency: 0.4,
          quality: 0.3,
          energy: 0.15,
          reliability: 0.15,
        },
      },
      {
        toolId: "image.embedding",
        version: "1.0.0",
        description: "将商品图片转换为检索向量",
        inputType: "ImageRegion",
        outputType: "Embedding",
        preconditions: ["输入图片已经标准化"],
        postconditions: ["输出带模型和维度信息的向量"],
        quality: { requiresConfidence: true, minimumConfidence: 0.75 },
        constraints: {
          privacy: "high",
          locality: "local_preferred",
          allowLocal: true,
          allowCloud: true,
          maxLatencyMs: 300,
        },
        resourceHints: {
          computeClass: "neural_inference",
          estimatedMemoryMb: 512,
          modelId: embeddingModel,
        },
        execution: {
          supportsPause: false,
          supportsRetry: true,
          maxAttempts: 2,
          compensationActions: ["降低输入分辨率", "更换已探测模型", "请求用户补充图片"],
        },
        defaultWeights: {
          latency: 0.4,
          quality: 0.3,
          energy: 0.15,
          reliability: 0.15,
        },
      },
      {
        toolId: "text.embedding",
        version: "1.0.0",
        description: "将用户文字要求转换为检索向量",
        inputType: "Text",
        outputType: "Embedding",
        preconditions: ["文本已经通过长度和编码校验"],
        postconditions: ["输出带模型和维度信息的向量"],
        quality: { requiresConfidence: true, minimumConfidence: 0.75 },
        constraints: {
          privacy: "sensitive",
          locality: "local_preferred",
          allowLocal: true,
          allowCloud: true,
          maxLatencyMs: 300,
        },
        resourceHints: {
          computeClass: "neural_inference",
          estimatedMemoryMb: 256,
          modelId: embeddingModel,
        },
        execution: {
          supportsPause: false,
          supportsRetry: true,
          maxAttempts: 2,
          compensationActions: ["使用结构化筛选条件继续检索", "请求用户改写要求"],
        },
        defaultWeights: {
          latency: 0.3,
          quality: 0.4,
          energy: 0.1,
          reliability: 0.2,
        },
      },
      {
        toolId: "catalog.vector_search",
        version: "1.0.0",
        description: "在应用提供的商品向量索引中检索候选商品",
        inputType: "Embedding",
        outputType: "CandidateProducts",
        preconditions: ["商品池索引已初始化", "输入向量维度与索引一致"],
        postconditions: ["输出带相似度和来源信息的候选列表"],
        quality: { requiresConfidence: true, minimumScore: 0.55 },
        constraints: {
          privacy: "sensitive",
          locality: "local_only",
          allowLocal: true,
          allowCloud: false,
        },
        resourceHints: { computeClass: "storage", estimatedMemoryMb: 256 },
        execution: {
          supportsPause: true,
          supportsRetry: true,
          maxAttempts: 2,
          compensationActions: ["降低候选数量", "切换到结构化标签召回"],
        },
        defaultWeights: {
          latency: 0.3,
          quality: 0.4,
          energy: 0.1,
          reliability: 0.2,
        },
      },
      {
        toolId: "catalog.price_query",
        version: "1.0.0",
        description: "查询已授权商品来源的当前价格和库存信息",
        inputType: "ProductReferences",
        outputType: "PriceSnapshot",
        preconditions: ["商品来源已授权", "候选商品包含可查询的来源标识"],
        postconditions: ["输出带采集时间和来源的价格快照"],
        quality: { requiresConfidence: false },
        constraints: {
          privacy: "public",
          locality: "cloud_preferred",
          allowLocal: true,
          allowCloud: true,
          maxLatencyMs: 2000,
        },
        resourceHints: { computeClass: "network", estimatedMemoryMb: 64 },
        execution: {
          supportsPause: true,
          supportsRetry: true,
          maxAttempts: 3,
          compensationActions: ["返回商品池已有价格并标记过期", "移除不可访问来源"],
        },
        defaultWeights: {
          latency: 0.3,
          quality: 0.35,
          energy: 0.05,
          reliability: 0.3,
        },
      },
      {
        toolId: "answer.generate",
        version: "1.0.0",
        description: "根据检索结果和用户目标生成可解释回答",
        inputType: "AnswerContext",
        outputType: "AssistantAnswer",
        preconditions: ["候选结果和用户目标已经准备完成"],
        postconditions: ["回答只引用输入上下文中的可验证信息"],
        quality: { requiresConfidence: true, minimumConfidence: 0.75 },
        constraints: {
          privacy: "sensitive",
          locality: "cloud_preferred",
          allowLocal: true,
          allowCloud: true,
          maxLatencyMs: 3000,
        },
        resourceHints: {
          computeClass: "neural_inference",
          estimatedMemoryMb: 512,
          modelId: chatModel,
        },
        execution: {
          supportsPause: false,
          supportsRetry: true,
          maxAttempts: 2,
          compensationActions: ["返回结构化结果", "请求用户缩小问题范围"],
        },
        defaultWeights: {
          latency: 0.25,
          quality: 0.45,
          energy: 0.1,
          reliability: 0.2,
        },
      },
    ],
  };
}

function optionalString(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
