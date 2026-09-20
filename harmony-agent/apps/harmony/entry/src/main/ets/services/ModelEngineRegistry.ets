import {
  Backend,
  ExecutionPlan,
  InferenceLocation,
  LocalExecutionPlan,
  ModelTier
} from 'scheduler';
import { Product } from '../models/Product';
import { IAiModelProvider, ModelProviderType } from './IAiModelProvider';
import { AiInferenceResult, ChatIntentResult, LocalAiModelEngine } from './LocalAiModelEngine';
import hilog from '@ohos.hilog';
import { http } from '@kit.NetworkKit';

/**
 * 1. Default Native Local Tensor Engine Provider
 */
export class LocalTensorEngineProvider implements IAiModelProvider {
  public readonly providerId: string = 'local_tensor';
  public readonly providerName: string = 'MindSpore Lite Neural Embedding + TaskPool Engine';
  public readonly providerType: ModelProviderType = 'LOCAL_TENSOR';

  public supportsCapability(capability: string): boolean {
    return capability === 'local_product_search' ||
      capability === 'text_product_embedding_search' ||
      capability === 'image_product_embedding_search' ||
      capability === 'chat_intent_reasoning';
  }

  public async runVectorInference(
    query: string,
    candidates: Product[],
    plan?: LocalExecutionPlan
  ): Promise<AiInferenceResult> {
    return LocalAiModelEngine.getInstance().runVectorInference(query, candidates, plan);
  }

  public async resolveChatIntentAndAnswer(
    prompt: string,
    plan?: ExecutionPlan
  ): Promise<ChatIntentResult> {
    return LocalAiModelEngine.getInstance().resolveChatIntentAndAnswer(
      prompt,
      plan !== undefined && plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE ?
        plan as LocalExecutionPlan : undefined
    );
  }
}

/**
 * 2. MindSpore Lite (.ms) ArkTS Runtime Provider
 */
export class MindSporeLiteProvider implements IAiModelProvider {
  public readonly providerId: string = 'mindspore_lite';
  public readonly providerName: string = 'MindSpore Lite ArkTS 神经模型引擎 (.ms)';
  public readonly providerType: ModelProviderType = 'MINDSPORE_LITE';

  public supportsCapability(capability: string): boolean {
    return true;
  }

  public async runVectorInference(
    query: string,
    candidates: Product[],
    plan?: LocalExecutionPlan
  ): Promise<AiInferenceResult> {
    return LocalAiModelEngine.getInstance().runVectorInference(query, candidates, plan);
  }

  public async resolveChatIntentAndAnswer(
    prompt: string,
    plan?: ExecutionPlan
  ): Promise<ChatIntentResult> {
    return LocalAiModelEngine.getInstance().resolveChatIntentAndAnswer(
      prompt,
      plan !== undefined && plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE ?
        plan as LocalExecutionPlan : undefined
    );
  }
}

/**
 * 3. Pluggable Cloud LLM / Remote Proxy Provider Stub
 */
export class CloudModelProxyProvider implements IAiModelProvider {
  public readonly providerId: string = 'cloud_proxy';
  public readonly providerName: string = '云端 HTTP/LLM 大模型代理引擎';
  public readonly providerType: ModelProviderType = 'REMOTE_CLOUD';

  public supportsCapability(capability: string): boolean {
    return capability === 'chat_intent_reasoning';
  }

  public async runVectorInference(
    query: string,
    candidates: Product[],
    plan?: LocalExecutionPlan
  ): Promise<AiInferenceResult> {
    const res = await LocalAiModelEngine.getInstance().runVectorInference(query, candidates, plan);
    return {
      topProducts: res.topProducts,
      vectorDimension: res.vectorDimension,
      inferenceDurationMs: res.inferenceDurationMs,
      accuracyScore: res.accuracyScore,
      modelName: res.modelName,
      sourceInfo: '本地向量检索（云端 Provider 不参与）',
      passCount: res.passCount,
      recommendDegrade: res.recommendDegrade,
      activeThreads: res.activeThreads,
      activeBackend: res.activeBackend
    };
  }

  public async resolveChatIntentAndAnswer(
    prompt: string,
    plan?: ExecutionPlan
  ): Promise<ChatIntentResult> {
    // Get local intent parsing first as a base
    const localRes = await LocalAiModelEngine.getInstance().resolveChatIntentAndAnswer(
      prompt,
      plan !== undefined && plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE ?
        plan as LocalExecutionPlan : undefined
    );

    // Attempt real HTTP call to local model-search proxy /api/model-search/chat
    interface ChatProxyRequest { prompt: string; context: string; }
    interface ChatProxyResponse { ok: boolean; answer: string; source: string; }
    const contextSummary: string = localRes.topProducts.slice(0, 3)
      .map((p: Product) => `${p.title}（${p.price}）`)
      .join('、');
    const requestPayload: ChatProxyRequest = { prompt: prompt, context: contextSummary };
    const requestHeader: Record<string, string> = { 'Content-Type': 'application/json' };
    const requestOptions: http.HttpRequestOptions = {
      method: http.RequestMethod.POST,
      header: requestHeader,
      extraData: JSON.stringify(requestPayload),
      connectTimeout: 2500,
      readTimeout: 12000
    };
    const urlsToTry: string[] = ['http://10.0.2.2:3010', 'http://127.0.0.1:3010'];
    for (let i = 0; i < urlsToTry.length; i++) {
      const baseUrlStr = urlsToTry[i];
      const httpRequest: http.HttpRequest = http.createHttp();
      try {
        const response: http.HttpResponse = await httpRequest.request(
          `${baseUrlStr}/api/model-search/chat`,
          requestOptions
        );
        if (response.responseCode >= 200 && response.responseCode < 300) {
          const proxyResponse: ChatProxyResponse = JSON.parse(String(response.result)) as ChatProxyResponse;
          if (proxyResponse.ok && proxyResponse.answer.length > 0) {
            httpRequest.destroy();
            return {
              intent: localRes.intent,
              extractedBrand: localRes.extractedBrand,
              extractedCategory: localRes.extractedCategory,
              maxBudget: localRes.maxBudget,
              extractedKeywords: localRes.extractedKeywords,
              generatedAnswer: proxyResponse.answer,
              confidenceScore: localRes.confidenceScore,
              modelName: `CloudProxy(${proxyResponse.source})`,
              inferenceDurationMs: localRes.inferenceDurationMs,
              topProducts: localRes.topProducts
            };
          }
        }
      } catch (err) {
        hilog.warn(0x0000, 'CloudModelProxy', `Chat proxy request at ${baseUrlStr} failed: ${JSON.stringify(err)}`);
      } finally {
        httpRequest.destroy();
      }
    }

    // Fallback to local result if proxy unavailable
    return {
      intent: localRes.intent,
      extractedBrand: localRes.extractedBrand,
      extractedCategory: localRes.extractedCategory,
      maxBudget: localRes.maxBudget,
      extractedKeywords: localRes.extractedKeywords,
      generatedAnswer: localRes.generatedAnswer.length > 0 ? localRes.generatedAnswer : `为您找到了${localRes.topProducts.length}个相关商品，请参考上方列表。`,
      confidenceScore: localRes.confidenceScore,
      modelName: 'CloudProxy-LocalFallback',
      inferenceDurationMs: localRes.inferenceDurationMs + 50,
      topProducts: localRes.topProducts
    };
  }
}

/**
 * Central Decoupled Model Engine Registry & Hot-Swapper
 */
export class ModelEngineRegistry {
  private static instance: ModelEngineRegistry | null = null;
  private readonly providers: Map<string, IAiModelProvider> = new Map<string, IAiModelProvider>();
  private activeProviderId: string = 'mindspore_lite';

  private constructor() {
    this.registerProvider(new LocalTensorEngineProvider());
    this.registerProvider(new MindSporeLiteProvider());
    this.registerProvider(new CloudModelProxyProvider());
  }

  public static getInstance(): ModelEngineRegistry {
    if (ModelEngineRegistry.instance === null) {
      ModelEngineRegistry.instance = new ModelEngineRegistry();
    }
    return ModelEngineRegistry.instance;
  }

  public registerProvider(provider: IAiModelProvider): void {
    this.providers.set(provider.providerId, provider);
    hilog.info(0x0000, 'ModelEngineRegistry', `Registered model provider: ${provider.providerId} (${provider.providerName})`);
  }

  public switchProvider(providerId: string): boolean {
    if (this.providers.has(providerId)) {
      this.activeProviderId = providerId;
      hilog.info(0x0000, 'ModelEngineRegistry', `Switched active model provider to: ${providerId}`);
      return true;
    }
    return false;
  }

  public getLocalVectorProvider(): IAiModelProvider {
    const active = this.providers.get(this.activeProviderId);
    if (active !== undefined && active.providerType !== 'REMOTE_CLOUD' &&
      active.supportsCapability('text_product_embedding_search')) {
      return active;
    }
    const local = this.providers.get('mindspore_lite');
    if (local !== undefined) {
      return local;
    }
    return new LocalTensorEngineProvider();
  }

  public getRemoteProvider(): IAiModelProvider {
    const provider = this.providers.get('cloud_proxy');
    if (provider !== undefined) {
      return provider;
    }
    return new CloudModelProxyProvider();
  }

  public getActiveProvider(): IAiModelProvider {
    const provider = this.providers.get(this.activeProviderId);
    if (provider !== undefined) {
      return provider;
    }
    return new LocalTensorEngineProvider();
  }

  public getRegisteredProviders(): IAiModelProvider[] {
    const list: IAiModelProvider[] = [];
    this.providers.forEach((p) => {
      list.push(p);
    });
    return list;
  }
}
