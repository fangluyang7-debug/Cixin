import { http } from '@kit.NetworkKit';
import { CloudApiConfig } from './CloudApiConfig';
import { NativeClock } from './NativeClock';
import { Backend, DuplicatePolicy, FeedbackAvailability, FeedbackReceipt, FeedbackRequest,
  InferenceLocation, Interruptibility, ModelTier, PlacementDecision, PlacementDeviceProfile, PlacementLinkProfile,
  PrivacyPolicy, SchedulerClient, SchedulerRuntime, TaskContext, TaskSignal, TaskTemplate, TaskType, UserFeedback, WorkflowResult, WorkflowHandle } from 'scheduler';
import { Product } from '../models/Product';
import { ShoppingResult } from '../models/ShoppingResult';
import { SearchPreference } from './SearchPreferences';
import { CloudShoppingExecutor, CloudShoppingInput } from './CloudShoppingExecutor';

interface SessionMutationEnvelope { success: boolean; data?: SessionRevision; }
interface SessionRevision { stateVersion?: number; requestRevision?: number; }

export class ShoppingTaskService {
  private static readonly instance: ShoppingTaskService = new ShoppingTaskService();
  private client: SchedulerClient | null = null;
  private runtime: SchedulerRuntime | null = null;
  private sequence: number = 0;
  public lastSubmittedTaskId: string = '';
  private versions: Map<string, number> = new Map<string, number>();
  private revisions: Map<string, number> = new Map<string, number>();
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
    const clock = new NativeClock();
    this.client = new SchedulerClient(runtime, clock);
    this.client.registerTemplate(this.template);
    this.client.registerExecutor(new CloudShoppingExecutor(clock));
  }
  public searchResult(query: string, highQuality: boolean = false,
    preference: SearchPreference = SearchPreference.BALANCED): WorkflowHandle<ShoppingResult> {
    return this.submitResult('text', query, undefined, undefined, highQuality || preference === SearchPreference.QUALITY);
  }
  public searchImageResult(photoUri: string): WorkflowHandle<ShoppingResult> {
    return this.submitResult('image_upload', '', photoUri, undefined);
  }
  public refreshResult(sessionId: string): WorkflowHandle<ShoppingResult> {
    return this.submitResult('refine', '', undefined, sessionId);
  }
  public readResult(sessionId: string): WorkflowHandle<ShoppingResult> {
    return this.submitResult('read', '', undefined, sessionId);
  }
  public sessionResult(operation: string, sessionId: string, bodyJson: string = '{}'): WorkflowHandle<ShoppingResult> {
    return this.submitResult(operation, '', undefined, sessionId, false, bodyJson);
  }
  public async setShortlist(sessionId: string, candidateItemId: string, saved: boolean): Promise<void> {
    await CloudApiConfig.ensureGuest();
    const headers = CloudApiConfig.requestHeaders();
    const revision = (this.revisions.get(sessionId) ?? 0) + 1;
    this.revisions.set(sessionId, revision);
    headers['idempotency-key'] = 'cart_' + Date.now() + '_' + (++this.sequence);
    headers['x-request-revision'] = String(revision);
    const version = this.versions.get(sessionId);
    if (version !== undefined) { headers['x-session-version'] = String(version); }
    const client = http.createHttp();
    try {
      const path = '/api/v1/sessions/' + encodeURIComponent(sessionId) + (saved ? '/candidates/' + encodeURIComponent(candidateItemId) + '/shortlist' : '/cart/' + encodeURIComponent(candidateItemId));
      const response = await client.request(CloudApiConfig.getBaseUrl() + path, { method: saved ? http.RequestMethod.POST : http.RequestMethod.DELETE,
        header: headers, extraData: '{}', connectTimeout: 10000, readTimeout: 15000 });
      if (response.responseCode < 200 || response.responseCode >= 300 || typeof response.result !== 'string') { throw new Error('SHORTLIST_UPDATE_FAILED'); }
      const result = JSON.parse(response.result) as SessionMutationEnvelope;
      if (!result.success) { throw new Error('SHORTLIST_UPDATE_FAILED'); }
      if (result.data?.stateVersion !== undefined) { this.versions.set(sessionId, result.data.stateVersion); }
    } finally { client.destroy(); }
  }
  public remember(result: ShoppingResult): void {
    if (result.sessionId === null) { return; }
    const old = this.versions.get(result.sessionId) ?? -1;
    if (result.stateVersion !== null && result.stateVersion >= old) { this.versions.set(result.sessionId, result.stateVersion); }
    if (result.requestRevision !== null) { this.revisions.set(result.sessionId, Math.max(this.revisions.get(result.sessionId) ?? 0, result.requestRevision)); }
  }
  public submitResult(operation: string, query: string, photoUri?: string, sessionId?: string, highQuality: boolean = false, bodyJson?: string): WorkflowHandle<ShoppingResult> {
    const context: TaskContext = { userVisible: true, userWaiting: true, accuracyFloor: ModelTier.HIGH_ACCURACY,
      networkAllowed: true, highQuality: highQuality, deadlineMs: 150000, freshnessMs: 150000, deduplicationKey: 'shopping' };
    const state = this.runtime?.getDeviceState?.();
    if (state === undefined) { throw new Error('DEVICE_PROFILE_UNAVAILABLE'); }
    const revision = sessionId === undefined ? undefined : (this.revisions.get(sessionId) ?? 0) + 1;
    if (sessionId !== undefined && revision !== undefined) { this.revisions.set(sessionId, revision); }
    const input: CloudShoppingInput = { taskId: 'phone_' + Date.now() + '_' + (++this.sequence),
      bodyJson: bodyJson, baseVersion: sessionId === undefined ? undefined : this.versions.get(sessionId), requestRevision: revision,
      operation: operation, query: query, photoUri: photoUri, sessionId: sessionId,
      deviceProfile: state, context: context, template: this.template };
    this.lastSubmittedTaskId = input.taskId;
    return this.requireClient().submit<CloudShoppingInput, ShoppingResult>('product_search', input, context);
  }
  // Legacy Product[] API is an explicit projection; new consumers retain the full result.
  public search(query: string, highQuality: boolean = false,
    preference: SearchPreference = SearchPreference.BALANCED): WorkflowHandle<Product[]> {
    return this.projectProducts(this.searchResult(query, highQuality, preference));
  }
  public searchImage(uri: string): WorkflowHandle<Product[]> { return this.projectProducts(this.searchImageResult(uri)); }
  public read(sessionId: string): WorkflowHandle<Product[]> { return this.projectProducts(this.readResult(sessionId)); }
  public refresh(sessionId: string): WorkflowHandle<Product[]> { return this.projectProducts(this.refreshResult(sessionId)); }
  public submitTask(operation: string, query: string, photoUri?: string, sessionId?: string, highQuality: boolean = false): WorkflowHandle<Product[]> {
    return this.projectProducts(this.submitResult(operation, query, photoUri, sessionId, highQuality));
  }
  private projectProducts(handle: WorkflowHandle<ShoppingResult>): WorkflowHandle<Product[]> {
    return new ProductWorkflowHandle(handle);
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

class ProductWorkflowHandle implements WorkflowHandle<Product[]> {
  public readonly workflowId: string;
  public readonly result: Promise<WorkflowResult<Product[]>>;
  private readonly source: WorkflowHandle<ShoppingResult>;
  constructor(source: WorkflowHandle<ShoppingResult>) {
    this.source = source;
    this.workflowId = source.workflowId;
    this.result = source.result.then((result): WorkflowResult<Product[]> => {
      const projection: WorkflowResult<Product[]> = { workflowId: result.workflowId, status: result.status,
        nodes: result.nodes, skippedNodeIds: result.skippedNodeIds, reasonCode: result.reasonCode,
        output: result.output === null ? null : result.output.products };
      return projection;
    });
  }
  public cancel(): Promise<boolean> { return this.source.cancel(); }
  public signal(signal: TaskSignal): Promise<void> { return this.source.signal(signal); }
}
