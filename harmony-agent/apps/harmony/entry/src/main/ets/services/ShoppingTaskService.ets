import {
  Backend, CancellationSignal, DependencyFailurePolicy, DuplicatePolicy, ExecutionPlan, ExecutorResult,
  InferenceLocation, Interruptibility, LocalExecutionPlan, ModelTier, PrivacyPolicy, QualityLevel,
  SchedulerClient, SchedulerRuntime, TaskCheckpoint, TaskContext, TaskTemplate, TaskType,
  WorkflowHandle, WorkflowInput, WorkloadExecutor, ExecutionProfile, FeedbackRequest, FeedbackReceipt, UserFeedback, FeedbackAvailability
} from 'scheduler';
import { Product } from '../models/Product';
import { EmbeddingSearchResult } from '../models/EmbeddingModel';
import { DataInitService } from './DataInitService';
import { encoderManifest, searchManifest, warmupManifest } from './ShoppingProfiles';
import { SearchPreference, searchContext } from './SearchPreferences';
import { NeuralEmbeddingIndex, NormalizationProgress, VectorSearchTelemetry } from './NeuralEmbeddingIndex';

type CpuWork<TInput, TOutput> = (input: TInput, plan: LocalExecutionPlan,
  signal: CancellationSignal, checkpoint?: TaskCheckpoint) => Promise<ExecutorResult<TOutput>>;

class ShoppingCpuExecutor<TInput, TOutput> implements WorkloadExecutor<TInput, TOutput> {
  public readonly inferenceLocation: InferenceLocation = InferenceLocation.LOCAL_DEVICE;
  public readonly capability: string;
  private readonly work: CpuWork<TInput, TOutput>;
  private readonly profiles: ExecutionProfile[];
  constructor(capability: string, work: CpuWork<TInput, TOutput>, profiles: ExecutionProfile[] = []) {
    this.capability = capability; this.work = work;
    this.profiles = JSON.parse(JSON.stringify(profiles)) as ExecutionProfile[];
  }
  public supports(plan: ExecutionPlan): boolean {
    if (plan.inferenceLocation !== InferenceLocation.LOCAL_DEVICE || (plan as LocalExecutionPlan).backend !== Backend.CPU) { return false; }
    if (this.profiles.length === 0) { return plan.executionProfile === undefined; }
    const declared = this.profiles.find((item: ExecutionProfile) => item.id === plan.executionProfile?.id);
    return declared !== undefined && JSON.stringify(declared) === JSON.stringify(plan.executionProfile) &&
      (plan as LocalExecutionPlan).threadCount === declared.workerCount && (plan as LocalExecutionPlan).modelTier === declared.modelTier;
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
    const encoder = this.leaf('text_encode', TaskType.USER_INITIATED, 40, 'soleai-neural-char-v1');
    encoder.interruptibility = Interruptibility.NON_INTERRUPTIBLE;
    encoder.manifest = encoderManifest();
    client.registerTemplate(encoder);
    const retrieval: TaskTemplate = this.leaf('vector_retrieve', TaskType.USER_INITIATED, 35, 'soleai-neural-char-v1');
    retrieval.qualityLevels[1].estimatedLatencyMs = 15;
    retrieval.qualityLevels[2].estimatedLatencyMs = 8;
    retrieval.manifest = searchManifest();
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
    background.manifest = warmupManifest();
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
          actualBackend: Backend.CPU, actualThreads: plan.threadCount, workerCount: plan.threadCount,
          profileId: plan.executionProfile!.id, actualModelTier: ModelTier.HIGH_ACCURACY } };
      }, encoder.manifest.profiles));
    client.registerExecutor(new ShoppingCpuExecutor<WorkflowInput<string>, Product[]>('vector_retrieve',
      async (input: WorkflowInput<string>, plan: LocalExecutionPlan): Promise<ExecutorResult<Product[]>> => {
        const dimension: number = plan.executionProfile!.retrievalDimensions!;
        const count: number = NeuralEmbeddingIndex.getInstance().getModelInfo()?.productCount ?? 0;
        if (count !== plan.executionProfile!.candidateCount) { throw new Error('Search profile does not match the loaded candidate set.'); }
        const actual: VectorSearchTelemetry = { executionPath: 'not_started', configuredPartitions: 0, scannedCount: 0 };
        const found: EmbeddingSearchResult[] = await NeuralEmbeddingIndex.getInstance().searchVector(
          input.outputs['encode'] as Float32Array, dimension, plan.threadCount, 20, false, input.input, actual);
        return { output: found.map((item: EmbeddingSearchResult) => item.product),
          telemetry: { modelVersion: 'soleai-neural-char-v1', actualBackend: Backend.CPU,
            workerCount: actual.configuredPartitions, actualThreads: actual.configuredPartitions,
            candidateCount: actual.scannedCount, retrievalDimensions: dimension, executionPath: actual.executionPath,
            profileId: plan.executionProfile!.id, actualModelTier: plan.modelTier } };
      }, retrieval.manifest.profiles));
    client.registerExecutor(new ShoppingCpuExecutor<string, number>('index_warmup',
      async (_input: string, plan: LocalExecutionPlan, signal: CancellationSignal,
        checkpoint?: TaskCheckpoint): Promise<ExecutorResult<number>> => {
        const progress: NormalizationProgress = await NeuralEmbeddingIndex.getInstance().rebuildNormalizationChunk(
          checkpoint === undefined ? undefined : checkpoint.data as NormalizationProgress, signal, plan.executionProfile!.batchSize!);
        const total: number = NeuralEmbeddingIndex.getInstance().getModelInfo()?.productCount ?? 0;
        return { output: progress.cursor, completed: progress.cursor >= total,
          checkpoint: { cursor: progress.cursor, data: progress },
          telemetry: { modelVersion: progress.modelVersion, actualBackend: Backend.CPU, workerCount: 1,
            profileId: plan.executionProfile!.id, actualModelTier: ModelTier.LIGHTWEIGHT,
            batchSize: plan.executionProfile!.batchSize!, candidateCount: progress.cursor - (checkpoint?.cursor ?? 0) } };
      }, background.manifest.profiles));
    client.registerExecutor(new ShoppingCpuExecutor<string, string>('preview_placeholder',
      async (input: string): Promise<ExecutorResult<string>> => ({ output: input })));
  }

  public search(query: string, highQuality: boolean = false,
    preference: SearchPreference = SearchPreference.BALANCED): WorkflowHandle<Product[]> {
    return this.requireClient().submit<string, Product[]>('product_search', query,
      searchContext(query.length, NeuralEmbeddingIndex.getInstance().getModelInfo()?.productCount ?? 0, preference, highQuality));
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

  public feedbackRequest(workflowId: string): FeedbackRequest | null { return this.requireClient().getFeedbackRequest(workflowId); }
  public feedbackAvailability(workflowId: string): FeedbackAvailability { return this.requireClient().getFeedbackAvailability(workflowId); }
  public submitFeedback(workflowId: string, feedback: UserFeedback): FeedbackReceipt {
    return this.requireClient().submitFeedback(workflowId, feedback);
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
