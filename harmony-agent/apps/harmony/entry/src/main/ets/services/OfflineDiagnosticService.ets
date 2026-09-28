import {
  Backend, CancellationSignal, DuplicatePolicy, ExecutionPlan, ExecutorResult, InferenceLocation,
  Interruptibility, LocalExecutionPlan, ModelTier, PrivacyPolicy, SchedulerClient, SchedulerRuntime,
  TaskContext, TaskTemplate, TaskType, WorkflowHandle, WorkloadExecutor
} from 'scheduler';
import { Product } from '../models/Product';
import hilog from '@ohos.hilog';
import { NeuralEmbeddingIndex, NormalizationProgress, VectorSearchTelemetry } from './NeuralEmbeddingIndex';
import { searchManifest, warmupManifest } from './ShoppingProfiles';

// Deliberately separate from product_search: these packaged samples are only a local diagnostic workload.
class DiagnosticSearchExecutor implements WorkloadExecutor<string, Product[]> {
  public readonly capability: string = 'offline_diagnostic_search';
  public readonly inferenceLocation: InferenceLocation = InferenceLocation.LOCAL_DEVICE;
  public supports(plan: ExecutionPlan): boolean { return plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE && plan.backend === Backend.CPU; }
  public async execute(query: string, plan: ExecutionPlan, signal: CancellationSignal): Promise<ExecutorResult<Product[]>> {
    if (signal.isCancellationRequested) { throw new Error('DIAGNOSTIC_CANCELLED'); }
    const local = plan as LocalExecutionPlan;
    const index = NeuralEmbeddingIndex.getInstance();
    const vector = await index.encodeQuery(query, local.threadCount);
    if (signal.isCancellationRequested) { throw new Error('DIAGNOSTIC_CANCELLED'); }
    const measured: VectorSearchTelemetry = { executionPath: '', configuredPartitions: 0, scannedCount: 0 };
    const results = await index.searchVector(vector,
      local.executionProfile?.retrievalDimensions ?? 256, local.threadCount, 6, false, query, measured);
    // TaskPool inference cannot be interrupted midway. Settle it before acknowledging a stop.
    if (signal.isCancellationRequested) { throw new Error('DIAGNOSTIC_CANCELLED'); }
    hilog.info(0x0000, 'OfflineDiagnostic', `search profile=${local.executionProfile?.id} tier=${local.executionProfile?.modelTier} workers=${measured.configuredPartitions} candidates=${measured.scannedCount} dimension=${local.executionProfile?.retrievalDimensions} path=${measured.executionPath}`);
    return { output: results.map((item) => item.product), telemetry: {
      profileId: local.executionProfile?.id,
      actualModelTier: local.executionProfile?.modelTier ?? local.modelTier, actualBackend: Backend.CPU,
      workerCount: measured.configuredPartitions, candidateCount: measured.scannedCount,
      retrievalDimensions: local.executionProfile?.retrievalDimensions, executionPath: measured.executionPath
    } };
  }
  public async dispose(): Promise<void> {}
}

class DiagnosticWarmupExecutor implements WorkloadExecutor<number, number> {
  public readonly capability: string = 'offline_diagnostic_warmup';
  public readonly inferenceLocation: InferenceLocation = InferenceLocation.LOCAL_DEVICE;
  public supports(plan: ExecutionPlan): boolean { return plan.inferenceLocation === InferenceLocation.LOCAL_DEVICE && plan.backend === Backend.CPU; }
  public async execute(_input: number, plan: ExecutionPlan, signal: CancellationSignal): Promise<ExecutorResult<number>> {
    if (signal.isCancellationRequested) { throw new Error('DIAGNOSTIC_CANCELLED'); }
    const local = plan as LocalExecutionPlan;
    const index = NeuralEmbeddingIndex.getInstance();
    const count = index.getModelInfo()?.productCount ?? 0;
    const batchSize = local.executionProfile?.batchSize ?? 128;
    let progress: NormalizationProgress | undefined = undefined;
    while (progress === undefined || progress.cursor < count) {
      if (signal.isCancellationRequested) { throw new Error('DIAGNOSTIC_CANCELLED'); }
      progress = await index.rebuildNormalizationChunk(progress, signal, batchSize);
      if (count === 0) { break; }
    }
    if (signal.isCancellationRequested) { throw new Error('DIAGNOSTIC_CANCELLED'); }
    hilog.info(0x0000, 'OfflineDiagnostic', `warmup profile=${local.executionProfile?.id} tier=${local.executionProfile?.modelTier} workers=1 batch=${batchSize} rows=${progress?.cursor ?? 0}`);
    return { output: progress?.cursor ?? 0, telemetry: {
      profileId: local.executionProfile?.id,
      actualModelTier: local.executionProfile?.modelTier ?? local.modelTier, actualBackend: Backend.CPU,
      workerCount: 1, batchSize: batchSize, executionPath: 'taskpool'
    } };
  }
  public async dispose(): Promise<void> {}
}

export class OfflineDiagnosticService {
  private static readonly instance = new OfflineDiagnosticService();
  private client: SchedulerClient | null = null;
  public static getInstance(): OfflineDiagnosticService { return OfflineDiagnosticService.instance; }

  public initialize(runtime: SchedulerRuntime): void {
    if (this.client !== null) { return; }
    const client = new SchedulerClient(runtime);
    const search: TaskTemplate = {
      capability: 'offline_diagnostic_search', taskType: TaskType.USER_INITIATED,
      inferenceLocation: InferenceLocation.LOCAL_DEVICE, privacyPolicy: PrivacyPolicy.LOCAL_ONLY,
      interruptibility: Interruptibility.CANCEL_RESTART, duplicatePolicy: DuplicatePolicy.KEEP_ALL,
      timeoutMs: 60000, resourceHints: { modelVersion: 'soleai-neural-char-v1' },
      qualityLevels: [
        { id: ModelTier.HIGH_ACCURACY, modelTier: ModelTier.HIGH_ACCURACY, estimatedLatencyMs: 1000,
          relativeEnergyCost: 1, supportedBackends: [Backend.CPU], supportedThreadCounts: [1, 2, 4] },
        { id: ModelTier.BALANCED, modelTier: ModelTier.BALANCED, estimatedLatencyMs: 800,
          relativeEnergyCost: 1, supportedBackends: [Backend.CPU], supportedThreadCounts: [1, 2, 4] },
        { id: ModelTier.LIGHTWEIGHT, modelTier: ModelTier.LIGHTWEIGHT, estimatedLatencyMs: 600,
          relativeEnergyCost: 1, supportedBackends: [Backend.CPU], supportedThreadCounts: [1, 2, 4] }
      ], manifest: searchManifest()
    };
    const warmup: TaskTemplate = {
      capability: 'offline_diagnostic_warmup', taskType: TaskType.BACKGROUND_BATCH,
      inferenceLocation: InferenceLocation.LOCAL_DEVICE, privacyPolicy: PrivacyPolicy.LOCAL_ONLY,
      interruptibility: Interruptibility.CANCEL_RESTART, duplicatePolicy: DuplicatePolicy.KEEP_ALL,
      timeoutMs: 60000, resourceHints: { modelVersion: 'soleai-neural-char-v1' },
      qualityLevels: [{ id: 'full-norm-cache-128-row-chunks', modelTier: ModelTier.LIGHTWEIGHT,
        estimatedLatencyMs: 1000, relativeEnergyCost: 1,
        supportedBackends: [Backend.CPU], supportedThreadCounts: [1] }], manifest: warmupManifest()
    };
    client.registerTemplate(search);
    client.registerTemplate(warmup);
    client.registerExecutor(new DiagnosticSearchExecutor());
    client.registerExecutor(new DiagnosticWarmupExecutor());
    this.client = client;
  }

  public search(query: string): WorkflowHandle<Product[]> {
    const context: TaskContext = { userVisible: true, userWaiting: true,
      accuracyFloor: ModelTier.HIGH_ACCURACY, networkAllowed: false, deadlineMs: 60000 };
    return this.requireClient().submit<string, Product[]>('offline_diagnostic_search', query, context);
  }

  public warmup(): WorkflowHandle<number> {
    const context: TaskContext = { userVisible: false, userWaiting: false,
      accuracyFloor: ModelTier.LIGHTWEIGHT, networkAllowed: false, deadlineMs: 60000 };
    return this.requireClient().submit<number, number>('offline_diagnostic_warmup', 0, context);
  }

  public async dispose(): Promise<void> {
    if (this.client !== null) { await this.client.dispose(); this.client = null; }
  }

  private requireClient(): SchedulerClient {
    if (this.client === null) { throw new Error('Offline diagnostic is not initialized.'); }
    return this.client;
  }
}
