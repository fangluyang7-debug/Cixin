import { http, connection } from '@kit.NetworkKit';
import { ShoppingImageUpload } from './ShoppingImageUpload';
import { ArtifactRef, ClockPort, WallClock, CancellationSignal, CloudClientTiming, DeviceState, ExecutionPlan, ExecutorResult, InferenceLocation,
  RemoteRouteRegistry, HttpRouteProbe, RouteCandidate, routeStatus, ExecutionTelemetry,
  RemoteExecutionPlan, TaskContext, TaskTemplate, TaskCheckpoint, WorkloadExecutor } from 'scheduler';
import { ShoppingResult, ShoppingEnvelope, decodeShoppingResult } from '../models/ShoppingResult';
import { CloudApiConfig } from './CloudApiConfig';

export interface CloudShoppingInput {
  bodyJson?: string;
  baseVersion?: number;
  requestRevision?: number;
  budgetStartedAt?: number;
  budgetMs?: number;
  preparedBody?: CloudRequestInput;
  taskId: string;
  operation: string;
  query: string;
  photoUri?: string;
  assetId?: string;
  imageArtifact?: ArtifactRef;
  sessionId?: string;
  deviceProfile: DeviceState;
  context: TaskContext;
  template: TaskTemplate;
}
interface CandidatePrice { amount: number; currency: string; }
interface CloudCandidate {
  candidateItemId: string; title: string; platformName: string; price: CandidatePrice;
  shopName: string; shopType: string; stockStatus: string; coverImageUrl: string; productUrl: string;
}
interface CloudCandidates { items: CloudCandidate[]; }
interface ServerTiming { queueMs: number; computeMs: number; }
interface CloudShoppingResponse { runtimeRunId: string; candidates?: CloudCandidates; serverTiming?: ServerTiming; }
interface CloudErrorDetails { runId?: string; }
interface CloudError { code: string; details?: CloudErrorDetails; }
interface CloudErrorEnvelope { error?: CloudError; }
interface CloudEnvelope { success: boolean; data: CloudShoppingResponse; }
interface CloudHttpResult { body: string; timing: CloudClientTiming; }
interface CloudRouteProfile {
  throughputScope: string;
  executorId: string; inputResidence: string; outputDestination: string; accessMode: string;
  transferAuthorized: boolean; inputBytes: number; outputBytes: number;
  roundTripMs: number; uploadMbps: number; downloadMbps: number;
  storageReadMs: number; storageWriteMs: number; queueMs: number;
  source: string; observedAt: string;
}
interface CloudTaskProfile {
  cloudRoutes: CloudRouteProfile[];
  taskId: string; toolId: string; inputRef: string; outputType: string;
  allowCloud: boolean; privacy: string; inputBytes: number; deadlineMs: number;
  template: TaskTemplate; context: TaskContext;
}
interface CloudRequestInput { message?: string; assetId?: string; imageArtifact?: ArtifactRef; highQuality?: boolean; }
interface CloudTaskRequest {
  baseVersion?: number; requestRevision?: number;
  taskId: string; operation: string; sessionId?: string; input: CloudRequestInput;
  networkProfile: CloudRouteProfile; taskProfile: CloudTaskProfile; deviceProfile: DeviceState; executionPlan: RemoteExecutionPlan;
}

export class CloudShoppingExecutor implements WorkloadExecutor<CloudShoppingInput, ShoppingResult> {
  private readonly clock: ClockPort;
  constructor(clock: ClockPort = new WallClock()) { this.clock = clock; }
  public readonly capability: string = 'product_search';
  public readonly inferenceLocation: InferenceLocation = InferenceLocation.REMOTE_CLOUD;
  public supports(plan: ExecutionPlan): boolean {
    return plan.inferenceLocation === InferenceLocation.REMOTE_CLOUD &&
      (plan as RemoteExecutionPlan).provider === 'cloud-shopping-api' && !(plan as RemoteExecutionPlan).allowLocalFallback;
  }
  private readonly routes: RemoteRouteRegistry = new RemoteRouteRegistry();
  private networkObserver: connection.NetConnection | undefined = undefined;
  private networkEpoch: number = 0;
  private observedNetwork: boolean = false;
  private lastRouteKey: string = '';
  private async watchNetwork(): Promise<void> {
    if (this.networkObserver !== undefined) { return; }
    try {
      const observer = connection.createNetConnection();
      const changed = (): void => {
        this.networkEpoch++;
        this.routes.invalidate(this.lastRouteKey, 'NETWORK_CHANGED');
      };
      observer.on('netAvailable', changed);
      observer.on('netLost', changed);
      observer.on('netCapabilitiesChange', changed);
      observer.on('netConnectionPropertiesChange', changed);
      this.networkObserver = observer;
      await new Promise<void>((resolve) => observer.register((error) => { this.observedNetwork = !error; resolve(); }));
    } catch (_) { this.observedNetwork = false; }
  }
  public async prepare(input: CloudShoppingInput, context: TaskContext, signal?: CancellationSignal): Promise<void> {
    if (input.budgetStartedAt === undefined) {
      input.budgetStartedAt = this.clock.now();
      input.budgetMs = context.remainingBudgetMs ?? context.deadlineMs ?? 150000;
    }
    input.context = context;
    if (input.budgetMs === undefined || !Number.isFinite(input.budgetMs) || input.budgetMs <= 0) { throw new Error('DEADLINE_EXCEEDED'); }
    if (context.networkAllowed !== true) { throw new Error('NETWORK_NOT_ALLOWED'); }
    await CloudApiConfig.ensureGuest();
    if (input.photoUri !== undefined && input.assetId === undefined) {
      const uploaded = await ShoppingImageUpload.upload(input.photoUri, this.clock,
        this.clock.now() + this.remainingBudget(input), signal);
      input.assetId = uploaded.assetId;
      input.imageArtifact = uploaded.imageArtifact;
    }
    const body: CloudRequestInput = input.bodyJson === undefined ? { message: input.query, assetId: input.assetId, imageArtifact: input.imageArtifact } : JSON.parse(input.bodyJson) as CloudRequestInput;
    if (input.operation === 'text') { body.highQuality = context.highQuality === true; }
    input.preparedBody = body;
    context.remoteTask = { taskKind: input.photoUri === undefined ? 'text' : 'vision', latencyClass: 'interactive',
      input: { modality: input.photoUri === undefined ? 'text' : 'image', bytes: utf8Bytes(JSON.stringify(body)) + 8192,
        requiresUpload: true }, estimatedResultBytes: 512 * 1024, allowCloud: true };
    await this.watchNetwork();
    const endpoint = CloudApiConfig.getBaseUrl();
    const deadlineAt = Date.now() + Math.min(60000, this.remainingBudget(input));
    for (let attempt: number = 0; attempt < 2; attempt++) {
      const key = this.routeKey(input);
      this.lastRouteKey = key;
      if (!this.observedNetwork) { this.routes.invalidate(key, 'NETWORK_IDENTITY_UNAVAILABLE_REFRESH'); }
      context.routeCandidate = await this.routes.prepare(key, context.remoteTask,
        new HttpRouteProbe(endpoint, 'cloud-shopping-api', CloudApiConfig.requestHeaders(), signal, deadlineAt,
          'shopping.' + (input.operation === 'image_upload' ? 'image' : input.operation)), 25000);
      context.routeCandidate.networkKey = key;
      if (key === this.routeKey(input)) { return; }
      this.routes.invalidate(key, 'NETWORK_CHANGED_DURING_PROBE');
    }
    throw new Error('NETWORK_CHANGED_DURING_PROBE');
  }
  public async execute(input: CloudShoppingInput, plan: ExecutionPlan, signal: CancellationSignal, checkpoint?: TaskCheckpoint, onProgress?: (event: ExecutionTelemetry) => void): Promise<ExecutorResult<ShoppingResult>> {
    if (!this.supports(plan)) { throw new Error('CLOUD_PLAN_REQUIRED'); }
    const remote = plan as RemoteExecutionPlan;
    const selected = remote.routeCandidate;
    if (selected === undefined || routeStatus(selected) !== 'fresh' || this.routes.status(selected.networkKey) !== 'fresh' || input.preparedBody === undefined) {
      throw new Error('REMOTE_ROUTE_EXPIRED_OR_MISSING');
    }
    const baseUrl = CloudApiConfig.getBaseUrl();
    if (selected.networkKey !== this.routeKey(input) || selected.routeId !== remote.provider) { throw new Error('REMOTE_ROUTE_CHANGED'); }
    const remainingBudgetMs = Math.min(remote.timeoutMs, this.remainingBudget(input));
    if (remainingBudgetMs <= 0) { throw new Error('DEADLINE_EXCEEDED'); }
    const body = input.preparedBody;
    const route: CloudRouteProfile = { throughputScope: selected.source === 'measured-effective-throughput' ? 'effective' : 'payload', executorId: remote.provider, inputResidence: 'device', outputDestination: 'device',
      accessMode: 'inline_transfer', transferAuthorized: true, inputBytes: utf8Bytes(JSON.stringify(body)) + 8192,
      outputBytes: 512 * 1024, roundTripMs: selected.rttMs, uploadMbps: selected.uplinkMbps,
      downloadMbps: selected.downlinkMbps, storageReadMs: 0, storageWriteMs: 0, queueMs: selected.cloudQueueMs,
      source: 'measured', observedAt: new Date(selected.observedAt).toISOString() };
    const events: ExecutionTelemetry[] = [];
    const request: CloudTaskRequest = { taskId: input.taskId, operation: input.operation,
      sessionId: input.sessionId, baseVersion: input.baseVersion, requestRevision: input.requestRevision, input: body, networkProfile: route, deviceProfile: input.deviceProfile, executionPlan: remote,
      taskProfile: { cloudRoutes: [route], taskId: input.taskId, toolId: 'product_search',
        inputRef: input.photoUri === undefined ? 'request:text' : 'request:image', outputType: 'ShoppingResult',
        allowCloud: true, privacy: 'internal', inputBytes: route.inputBytes,
        deadlineMs: remainingBudgetMs, template: input.template, context: input.context } };
    let resultText: CloudHttpResult;
    try {
      resultText = await this.request(baseUrl + '/api/v1/shopping/tasks', JSON.stringify(request), remainingBudgetMs, signal,
        events, input.taskId, selected.routeId, onProgress);
    } catch (error) {
      this.routes.invalidate(selected.networkKey, (error as Error).message);
      onProgress?.({ taskId: input.taskId, routeId: selected.routeId, phase: 'failed', timestamp: Date.now(), errorCode: (error as Error).message });
      throw new Error((error as Error).message);
    }
    const envelope = JSON.parse(resultText.body) as CloudEnvelope;
    if (!envelope.success || !envelope.data.runtimeRunId) { throw new Error('CLOUD_INVALID_RESULT'); }
    this.routes.observe(selected.networkKey, selected, resultText.timing.requestMs, resultText.timing.uploadMs,
      resultText.timing.downloadMs, resultText.timing.inputBytes, resultText.timing.outputBytes, envelope.data.serverTiming?.computeMs);
    if (envelope.data.serverTiming !== undefined) {
      events.push({ taskId: input.taskId, routeId: selected.routeId, phase: 'queue', timestamp: Date.now(), durationMs: envelope.data.serverTiming.queueMs });
      events.push({ taskId: input.taskId, routeId: selected.routeId, phase: 'compute', timestamp: Date.now(), durationMs: envelope.data.serverTiming.computeMs });
    }
    events.push({ taskId: input.taskId, routeId: selected.routeId, phase: 'complete', timestamp: Date.now(), durationMs: resultText.timing.requestMs });
    events.filter((event: ExecutionTelemetry) => event.phase === 'queue' || event.phase === 'compute' || event.phase === 'complete').forEach((event: ExecutionTelemetry) => onProgress?.(event));
    try {
      await this.request(baseUrl + '/api/v1/runtime/runs/' + envelope.data.runtimeRunId + '/client-telemetry',
        JSON.stringify({ taskId: input.taskId, timing: resultText.timing, events: events }), 3000, signal);
    } catch (_) { /* Result remains usable if the optional telemetry acknowledgement is unavailable. */ }
    return { output: decodeShoppingResult(resultText.body, input.operation, input.taskId),
      telemetry: { routeEvents: events, executionPath: 'cloud-shopping-api', cloudRunId: envelope.data.runtimeRunId,
        cloudTaskId: input.taskId, cloudTiming: resultText.timing } };
  }

  private routeKey(input: CloudShoppingInput): string {
    return CloudApiConfig.getBaseUrl() + ':' + this.networkEpoch + ':' + (input.operation === 'image_upload' ? 'image' : input.operation);
  }
  private remainingBudget(input: CloudShoppingInput): number {
    const remaining = (input.budgetMs ?? 0) - Math.max(0, this.clock.now() - (input.budgetStartedAt ?? this.clock.now()));
    if (remaining <= 0) { throw new Error('DEADLINE_EXCEEDED'); }
    return remaining;
  }
  private async request(url: string, body: string, timeoutMs: number, signal: CancellationSignal, events?: ExecutionTelemetry[], taskId: string = '', routeId: string = '', onProgress?: (event: ExecutionTelemetry) => void): Promise<CloudHttpResult> {
    if (signal.isCancellationRequested) { throw new Error('CLOUD_CANCELLED'); }
    const request = http.createHttp();
    const began: number = this.clock.now();
    const publish = (event: ExecutionTelemetry): void => { events?.push(event); onProgress?.(event); };
    let sentBytes: number = 0;
    let sentAt: number | null = null;
    request.on('dataSendProgress', (progress: http.DataSendProgressInfo) => {
      sentBytes = progress.sendSize;
      if (sentAt === null && progress.totalSize > 0 && sentBytes >= progress.totalSize) { sentAt = this.clock.now() - began;
        publish({ taskId: taskId, routeId: routeId, phase: 'upload', timestamp: Date.now(), bytesSent: sentBytes }); }
    });
    const unsubscribe = signal.onCancelled(() => request.destroy());
    try {
      const response = await request.request(url, { method: body.length === 0 ? http.RequestMethod.GET : http.RequestMethod.POST,
        header: CloudApiConfig.requestHeaders(), extraData: body,
        connectTimeout: Math.min(timeoutMs, 10000), readTimeout: timeoutMs });
      if (signal.isCancellationRequested) { throw new Error('CLOUD_CANCELLED'); }
      if (response.responseCode < 200 || response.responseCode >= 300) {
        if (response.responseCode === 401) { CloudApiConfig.logout(); }
        let failure: string = 'CLOUD_HTTP_' + response.responseCode;
        try {
          const errorBody = JSON.parse(String(response.result)) as CloudErrorEnvelope;
          if (errorBody.error !== undefined && /^[A-Z0-9_]+$/.test(errorBody.error.code)) {
            failure = errorBody.error.code;
            const runId = errorBody.error.details?.runId;
            if (runId !== undefined && /^run_[a-zA-Z0-9_-]+$/.test(runId)) { failure += ':' + runId; }
          }
        } catch (_) {}
        throw new Error(failure);
      }
      const timing = response.performanceTiming;
      const uploadMs: number | null = timing !== undefined && sentAt !== null && sentAt >= timing.firstSendTiming ? sentAt - timing.firstSendTiming : null;
      const downloadMs: number | null = timing !== undefined && timing.totalFinishTiming >= timing.firstReceiveTiming ? timing.totalFinishTiming - timing.firstReceiveTiming : null;
      publish({ taskId: taskId, routeId: routeId, phase: 'download', timestamp: Date.now(), durationMs: downloadMs ?? undefined, bytesReceived: utf8Bytes(String(response.result)) });
      return { body: String(response.result), timing: { requestMs: this.clock.now() - began, uploadMs: uploadMs,
        downloadMs: downloadMs, inputBytes: utf8Bytes(body), outputBytes: utf8Bytes(String(response.result)) } };
    } finally { unsubscribe(); request.off('dataSendProgress'); request.destroy(); }
  }
  public async dispose(): Promise<void> {
    if (this.networkObserver !== undefined) {
      await new Promise<void>((resolve) => this.networkObserver!.unregister(() => resolve()));
      this.networkObserver = undefined;
    }
  }
}

function utf8Bytes(value: string): number {
  let count: number = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) { count++; }
    else if (code < 0x800) { count += 2; }
    else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xDC00 && value.charCodeAt(i + 1) <= 0xDFFF) { count += 4; i++; }
    else { count += 3; }
  }
  return count;
}
