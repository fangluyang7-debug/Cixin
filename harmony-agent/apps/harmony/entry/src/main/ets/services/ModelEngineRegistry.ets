// offline_diagnostic: local model self-tests only; not the product search entry.
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
/** @deprecated Formal cloud work must go through ShoppingTaskService and its selected executor. */
export class CloudModelProxyProvider implements IAiModelProvider {
  public readonly providerId: string = 'cloud_proxy';
  public readonly providerName: string = 'Use cloud-shopping-api';
  public readonly providerType: ModelProviderType = 'REMOTE_CLOUD';
  public supportsCapability(capability: string): boolean { return false; }
  public async runVectorInference(query: string, candidates: Product[], plan?: LocalExecutionPlan): Promise<AiInferenceResult> {
    throw new Error('SCHEDULED_CLOUD_TASK_REQUIRED');
  }
  public async resolveChatIntentAndAnswer(prompt: string, plan?: ExecutionPlan): Promise<ChatIntentResult> {
    throw new Error('SCHEDULED_CLOUD_TASK_REQUIRED');
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
