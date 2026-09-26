import { Backend, DuplicatePolicy, FeedbackAvailability, FeedbackReceipt, FeedbackRequest,
  InferenceLocation, Interruptibility, ModelTier, PlacementDecision, PlacementDeviceProfile, PlacementLinkProfile,
  PrivacyPolicy, SchedulerClient, SchedulerRuntime, TaskContext, TaskTemplate, TaskType, UserFeedback, WorkflowHandle } from 'scheduler';
import { Product } from '../models/Product';
import { SearchPreference } from './SearchPreferences';
import { CloudShoppingExecutor, CloudShoppingInput } from './CloudShoppingExecutor';

export class ShoppingTaskService {
  private static readonly instance: ShoppingTaskService = new ShoppingTaskService();
  private client: SchedulerClient | null = null;
  private runtime: SchedulerRuntime | null = null;
  private sequence: number = 0;
  private readonly template: TaskTemplate = {
    capability: 'product_search', taskType: TaskType.USER_INITIATED,
    inferenceLocation: InferenceLocation.REMOTE_CLOUD, privacyPolicy: PrivacyPolicy.REMOTE_ALLOWED,
    interruptibility: Interruptibility.CANCEL_RESTART, duplicatePolicy: DuplicatePolicy.KEEP_LATEST,
    timeoutMs: 150000, remoteOptions: { provider: 'cloud-shopping-api', maxRetries: 1, maxConcurrency: 2, allowLocalFallback: false },
    resourceHints: { modelVersion: 'zeabur-shopping-workflow-v1' },
    qualityLevels: [{ id: 'cloud', modelTier: ModelTier.HIGH_ACCURACY, estimatedLatencyMs: 10000,
      estimatedMemoryMb: 48, relativeEnergyCost: 1, supportedBackends: [Backend.CPU], supportedThreadCounts: [1] }]
  };
  public static getInstance(): ShoppingTaskService { return ShoppingTaskService.instance; }
  public initialize(runtime: SchedulerRuntime): void {
    if (this.client !== null) { return; }
    this.runtime = runtime;
    this.client = new SchedulerClient(runtime);
    this.client.registerTemplate(this.template);
    this.client.registerExecutor(new CloudShoppingExecutor());
  }
  public search(query: string, highQuality: boolean = false,
    preference: SearchPreference = SearchPreference.BALANCED): WorkflowHandle<Product[]> {
    return this.submitTask('text', query, undefined, undefined, highQuality || preference === SearchPreference.QUALITY);
  }
  public searchImage(photoUri: string): WorkflowHandle<Product[]> {
    return this.submitTask('image_upload', '', photoUri, undefined);
  }
  public refresh(sessionId: string): WorkflowHandle<Product[]> {
    return this.submitTask('refine', '', undefined, sessionId);
  }
  public read(sessionId: string): WorkflowHandle<Product[]> {
    return this.submitTask('read', '', undefined, sessionId);
  }
  public submitTask(operation: string, query: string, photoUri?: string, sessionId?: string, highQuality: boolean = false): WorkflowHandle<Product[]> {
    const context: TaskContext = { userVisible: true, userWaiting: true, accuracyFloor: ModelTier.HIGH_ACCURACY,
      networkAllowed: true, highQuality: highQuality, deadlineMs: 150000, freshnessMs: 150000, deduplicationKey: 'shopping' };
    const state = this.runtime?.getDeviceState?.();
    if (state === undefined) { throw new Error('DEVICE_PROFILE_UNAVAILABLE'); }
    const input: CloudShoppingInput = { taskId: 'phone_' + Date.now() + '_' + (++this.sequence),
      operation: operation, query: query, photoUri: photoUri, sessionId: sessionId,
      deviceProfile: state, context: context, template: this.template };
    return this.requireClient().submit<CloudShoppingInput, Product[]>('product_search', input, context);
  }
  public warmup(): WorkflowHandle<number> { throw new Error('OFFLINE_DIAGNOSTIC_ONLY'); }
  public getLastPlacementDecision(): PlacementDecision | null { return null; }
  public setShadowPlacement(devices: PlacementDeviceProfile[], links: PlacementLinkProfile[]): void {
    throw new Error('Formal shopping uses the cloud executor; use offline_diagnostic for simulations.');
  }
  public feedbackRequest(id: string): FeedbackRequest | null { return this.requireClient().getFeedbackRequest(id); }
  public feedbackAvailability(id: string): FeedbackAvailability { return this.requireClient().getFeedbackAvailability(id); }
  public submitFeedback(id: string, feedback: UserFeedback): FeedbackReceipt { return this.requireClient().submitFeedback(id, feedback); }
  public async dispose(): Promise<void> {
    if (this.client !== null) { await this.client.dispose(); this.client = null; }
    this.runtime = null;
  }
  private requireClient(): SchedulerClient {
    if (this.client === null) { throw new Error('Shopping task client is not initialized.'); }
    return this.client;
  }
}
