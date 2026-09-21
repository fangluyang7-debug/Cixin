import {
  Backend, CancellationSignal, DependencyFailurePolicy, DuplicatePolicy, ExecutionPlan, ExecutorResult,
  InferenceLocation, Interruptibility, LocalExecutionPlan, ModelTier, PrivacyPolicy, QualityLevel,
  SchedulerClient, SchedulerRuntime, TaskCheckpoint, TaskContext, TaskTemplate, TaskType,
  WorkflowHandle, WorkflowInput, WorkloadExecutor
} from 'scheduler';
import { Product } from '../models/Product';
import { EmbeddingSearchResult } from '../models/EmbeddingModel';
import { DataInitService } from './DataInitService';
import { NeuralEmbeddingIndex, NormalizationProgress, VectorSearchTelemetry } from './NeuralEmbeddingIndex';

type CpuWork<TInput, TOutput> = (input: TInput, plan: LocalExecutionPlan,
  signal: CancellationSignal, checkpoint?: TaskCheckpoint) => Promise<ExecutorResult<TOutput>>;

class ShoppingCpuExecutor<TInput, TOutput> implements WorkloadExecutor<TInput, TOutput> {
  public readonly inferenceLocation: InferenceLocation = InferenceLocation.LOCAL_DEVICE;
  public readonly capability: string;
  private readonly work: CpuWork<TInput, TOutput>;
  constructor(capability: string, work: CpuWork<TInput, TOutput>) { this.capability = capability; this.work = work; }
  public supports(plan: ExecutionPlan): boolean {
    return plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE && (plan as LocalExecutionPlan).backend === Backend.CPU;
  }
  public execute(input: TInput, plan: ExecutionPlan, signal: CancellationSignal,
    checkpoint?: TaskCheckpoint): Promise<ExecutorResult<TOutput>> {
    return this.work(input, plan as LocalExecutionPlan, signal, checkpoint);
  }
  public async dispose(): Promise<void> {}
}

// The application owns templates, model/data dependencies and all interpretation of input.
export class ShoppingTaskService {
  private static instance: ShoppingTaskService | null = null;
  private client: SchedulerClient | null = null;

  public static getInstance(): ShoppingTaskService {
    if (ShoppingTaskService.instance === null) { ShoppingTaskService.instance = new ShoppingTaskService(); }
    return ShoppingTaskService.instance;
  }

  public initialize(runtime: SchedulerRuntime): void {
    if (this.client !== null) { return; }
    const client: SchedulerClient = new SchedulerClient(runtime);
    this.client = client;
    const prepare: TaskTemplate = this.leaf('query_prepare', TaskType.USER_INITIATED, 2, 'text-normalize-v1');
    prepare.qualityLevels.forEach((level: QualityLevel) => { level.supportedThreadCounts = [1]; });
    client.registerTemplate(prepare);
    client.registerTemplate(this.leaf('text_encode', TaskType.USER_INITIATED, 40, 'soleai-neural-char-v1'));
    const retrieval: TaskTemplate = this.leaf('vector_retrieve', TaskType.USER_INITIATED, 35, 'soleai-neural-char-v1');
    retrieval.qualityLevels[1].estimatedLatencyMs = 15;
    retrieval.qualityLevels[2].estimatedLatencyMs = 8;
    client.registerTemplate(retrieval);
    const search: TaskTemplate = this.leaf('product_search', TaskType.USER_INITIATED, 100, 'search-workflow-v1');
    search.duplicatePolicy = DuplicatePolicy.KEEP_LATEST;
    search.workflow = [
      { id: 'prepare', templateId: 'query_prepare', dependsOn: [], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW },
      { id: 'encode', templateId: 'text_encode', dependsOn: ['prepare'], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW },
      { id: 'retrieve', templateId: 'vector_retrieve', dependsOn: ['encode'], failurePolicy: DependencyFailurePolicy.CANCEL_WORKFLOW }
    ];
    search.outputNodeId = 'retrieve';
    client.registerTemplate(search);

    const background: TaskTemplate = this.leaf('index_warmup', TaskType.BACKGROUND_BATCH, 8, 'soleai-neural-char-v1');
    background.interruptibility = Interruptibility.CHECKPOINT;
    background.duplicatePolicy = DuplicatePolicy.MERGE_EQUIVALENT;
    background.qualityLevels = [{ id: 'full-norm-cache-128-row-chunks', modelTier: ModelTier.LIGHTWEIGHT,
      estimatedLatencyMs: 8, estimatedMemoryMb: 8, relativeEnergyCost: 0.2,
      supportedBackends: [Backend.CPU], supportedThreadCounts: [1] }];
    background.timeoutMs = 30000;
    client.registerTemplate(background);
    const preview: TaskTemplate = this.leaf('preview_placeholder', TaskType.FOREGROUND_REALTIME, 1, 'placeholder-v1');
    preview.duplicatePolicy = DuplicatePolicy.KEEP_LATEST;
    client.registerTemplate(preview);

    client.registerExecutor(new ShoppingCpuExecutor<WorkflowInput<string>, string>('query_prepare',
      async (input: WorkflowInput<string>): Promise<ExecutorResult<string>> => {
        await DataInitService.waitUntilReady();
        return { output: input.input.trim(), telemetry: { modelVersion: 'text-normalize-v1', actualBackend: Backend.CPU, actualThreads: 1 } };
      }));
    client.registerExecutor(new ShoppingCpuExecutor<WorkflowInput<string>, Float32Array>('text_encode',
      async (input: WorkflowInput<string>, plan: LocalExecutionPlan): Promise<ExecutorResult<Float32Array>> => {
        const vector: Float32Array = await NeuralEmbeddingIndex.getInstance().encodeQuery(input.outputs['prepare'] as string, plan.threadCount);
        return { output: vector, telemetry: { modelVersion: 'soleai-neural-char-v1', modelSizeMb: 5.51,
          actualBackend: Backend.CPU, actualThreads: plan.threadCount } };
      }));
    client.registerExecutor(new ShoppingCpuExecutor<WorkflowInput<string>, Product[]>('vector_retrieve',
      async (input: WorkflowInput<string>, plan: LocalExecutionPlan): Promise<ExecutorResult<Product[]>> => {
        const dimension: number = plan.modelTier === ModelTier.HIGH_ACCURACY ? 256 : plan.modelTier === ModelTier.BALANCED ? 64 : 16;
        const actual: VectorSearchTelemetry = { executionPath: 'not_started', configuredPartitions: 0, scannedCount: 0 };
        const found: EmbeddingSearchResult[] = await NeuralEmbeddingIndex.getInstance().searchVector(
          input.outputs['encode'] as Float32Array, dimension, plan.threadCount, 20, input.input, actual);
        return { output: found.map((item: EmbeddingSearchResult) => item.product),
          telemetry: { modelVersion: 'soleai-neural-char-v1', actualBackend: Backend.CPU,
            actualThreads: actual.configuredPartitions, executionPath: actual.executionPath, candidateCount: actual.scannedCount } };
      }));
    client.registerExecutor(new ShoppingCpuExecutor<string, number>('index_warmup',
      async (_input: string, _plan: LocalExecutionPlan, signal: CancellationSignal,
        checkpoint?: TaskCheckpoint): Promise<ExecutorResult<number>> => {
        const progress: NormalizationProgress = await NeuralEmbeddingIndex.getInstance().rebuildNormalizationChunk(
          checkpoint === undefined ? undefined : checkpoint.data as NormalizationProgress, signal);
        const total: number = NeuralEmbeddingIndex.getInstance().getModelInfo()?.productCount ?? 0;
        return { output: progress.cursor, completed: progress.cursor >= total,
          checkpoint: { cursor: progress.cursor, data: progress },
          telemetry: { modelVersion: progress.modelVersion, actualBackend: Backend.CPU, actualThreads: 1,
            candidateCount: Math.min(128, total - (checkpoint?.cursor ?? 0)) } };
      }));
    client.registerExecutor(new ShoppingCpuExecutor<string, string>('preview_placeholder',
      async (input: string): Promise<ExecutorResult<string>> => ({ output: input })));
  }

  public search(query: string, highQuality: boolean = false): WorkflowHandle<Product[]> {
    return this.requireClient().submit<string, Product[]>('product_search', query, {
      deadlineMs: 3000, freshnessMs: 4000, userVisible: true, userWaiting: true,
      accuracyFloor: highQuality ? ModelTier.HIGH_ACCURACY : ModelTier.LIGHTWEIGHT,
      highQuality: highQuality, businessImportance: 0.8, inputTokens: Math.max(1, query.length),
      candidateCount: NeuralEmbeddingIndex.getInstance().getModelInfo()?.productCount ?? 0, deduplicationKey: 'search-page', networkAllowed: false
    });
  }

  public warmup(): WorkflowHandle<number> {
    const context: TaskContext = { userVisible: false, userWaiting: false, accuracyFloor: ModelTier.LIGHTWEIGHT,
      businessImportance: 0.1, candidateCount: NeuralEmbeddingIndex.getInstance().getModelInfo()?.productCount ?? 0, deduplicationKey: 'full-norm-cache-v1', networkAllowed: false };
    return this.requireClient().submit<string, number>('index_warmup', 'norm-cache', context);
  }

  public preview(input: string): WorkflowHandle<string> {
    return this.requireClient().submit<string, string>('preview_placeholder', input, {
      deadlineMs: 100, freshnessMs: 150, userVisible: true, userWaiting: true,
      accuracyFloor: ModelTier.LIGHTWEIGHT, deduplicationKey: 'preview', networkAllowed: false
    });
  }

  public async dispose(): Promise<void> {
    if (this.client !== null) { await this.client.dispose(); this.client = null; }
  }

  private requireClient(): SchedulerClient {
    if (this.client === null) { throw new Error('Shopping task client is not initialized.'); }
    return this.client;
  }

  private leaf(capability: string, taskType: TaskType, latency: number, model: string): TaskTemplate {
    const tiers: ModelTier[] = [ModelTier.HIGH_ACCURACY, ModelTier.BALANCED, ModelTier.LIGHTWEIGHT];
    const levels: QualityLevel[] = tiers.map((tier: ModelTier): QualityLevel => ({
      id: tier, modelTier: tier, estimatedLatencyMs: latency, estimatedMemoryMb: 32,
      relativeEnergyCost: 1, supportedBackends: [Backend.CPU], supportedThreadCounts: [1, 2, 4]
    }));
    return { capability: capability, taskType: taskType, inferenceLocation: InferenceLocation.LOCAL_DEVICE,
      qualityLevels: levels, interruptibility: Interruptibility.CANCEL_RESTART,
      duplicatePolicy: DuplicatePolicy.KEEP_ALL, privacyPolicy: PrivacyPolicy.LOCAL_ONLY,
      resourceHints: { modelVersion: model, baselineInputTokens: 32, baselineCandidateCount: 2700 }, timeoutMs: 3000 };
  }
}
