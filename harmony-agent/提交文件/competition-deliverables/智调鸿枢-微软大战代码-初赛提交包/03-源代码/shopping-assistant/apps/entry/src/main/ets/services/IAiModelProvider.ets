import { ExecutionPlan, LocalExecutionPlan } from 'scheduler';
import { Product } from '../models/Product';
import { AiInferenceResult, ChatIntentResult } from './LocalAiModelEngine';

export type ModelProviderType = 'LOCAL_TENSOR' | 'MINDSPORE_LITE' | 'ONNX_NATIVE' | 'REMOTE_CLOUD';

export interface IAiModelProvider {
  readonly providerId: string;
  readonly providerName: string;
  readonly providerType: ModelProviderType;

  supportsCapability(capability: string): boolean;
  runVectorInference(query: string, candidates: Product[], plan?: LocalExecutionPlan): Promise<AiInferenceResult>;
  resolveChatIntentAndAnswer(prompt: string, plan?: ExecutionPlan): Promise<ChatIntentResult>;
}
