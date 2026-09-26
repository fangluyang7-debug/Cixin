import { http } from '@kit.NetworkKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { CancellationSignal, CloudClientTiming, DeviceState, ExecutionPlan, ExecutorResult, InferenceLocation,
  RemoteExecutionPlan, TaskContext, TaskTemplate, WorkloadExecutor } from 'scheduler';
import { Product } from '../models/Product';
import { CloudApiConfig } from './CloudApiConfig';

export interface CloudShoppingInput {
  taskId: string;
  operation: string;
  query: string;
  photoUri?: string;
  assetId?: string;
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
interface CloudShoppingResponse { runtimeRunId: string; candidates?: CloudCandidates; }
interface CloudErrorDetails { runId?: string; }
interface CloudError { code: string; details?: CloudErrorDetails; }
interface CloudErrorEnvelope { error?: CloudError; }
interface CloudEnvelope { success: boolean; data: CloudShoppingResponse; }
interface CloudHttpResult { body: string; timing: CloudClientTiming; }
interface CloudRouteProfile {
  executorId: string; inputResidence: string; outputDestination: string; accessMode: string;
  transferAuthorized: boolean; inputBytes: number; outputBytes: number | null;
  roundTripMs: number | null; uploadMbps: number | null; downloadMbps: number | null;
  storageReadMs: number | null; storageWriteMs: number | null; queueMs: number | null;
  estimatedFeeMinorUnits: number | null; accessExpiresAt: string | null; source: string; observedAt: number;
}
interface CloudTaskProfile {
  cloudRoutes: CloudRouteProfile[];
  taskId: string; toolId: string; inputRef: string; outputType: string;
  allowCloud: boolean; privacy: string; inputBytes: number; deadlineMs: number;
  template: TaskTemplate; context: TaskContext;
}
interface CloudRequestInput { message?: string; assetId?: string; imageBase64?: string; contentType?: string; }
interface CloudTaskRequest {
  taskId: string; operation: string; sessionId?: string; input: CloudRequestInput;
  networkProfile: CloudRouteProfile; taskProfile: CloudTaskProfile; deviceProfile: DeviceState; executionPlan: RemoteExecutionPlan;
}

export class CloudShoppingExecutor implements WorkloadExecutor<CloudShoppingInput, Product[]> {
  public readonly capability: string = 'product_search';
  public readonly inferenceLocation: InferenceLocation = InferenceLocation.REMOTE_CLOUD;
  public supports(plan: ExecutionPlan): boolean {
    return plan.inferenceLocation === InferenceLocation.REMOTE_CLOUD &&
      (plan as RemoteExecutionPlan).provider === 'cloud-shopping-api' && !(plan as RemoteExecutionPlan).allowLocalFallback;
  }
  public async execute(input: CloudShoppingInput, plan: ExecutionPlan, signal: CancellationSignal): Promise<ExecutorResult<Product[]>> {
    if (!this.supports(plan)) { throw new Error('CLOUD_PLAN_REQUIRED'); }
    const remote = plan as RemoteExecutionPlan;
    const baseUrl = CloudApiConfig.getBaseUrl();
    // A read-only probe may retry. Mutating workflow submissions are never replayed automatically.
    let healthy: boolean = false;
    for (let attempt = 0; attempt <= remote.maxRetries; attempt++) {
      try { await this.request(baseUrl + '/api/v1/health/readiness', '', 10000, signal); healthy = true; break; }
      catch (error) { if (signal.isCancellationRequested || attempt === remote.maxRetries) { throw new Error((error as Error).message); } }
    }
    if (!healthy) { throw new Error('CLOUD_UNAVAILABLE'); }
    const body: CloudRequestInput = { message: input.query, assetId: input.assetId };
    if (input.photoUri !== undefined) {
      const file = fileIo.openSync(input.photoUri, fileIo.OpenMode.READ_ONLY);
      try {
        const size = fileIo.statSync(file.fd).size;
        if (size <= 0 || size > 6 * 1024 * 1024) { throw new Error('CLOUD_IMAGE_TOO_LARGE'); }
        const bytes = new ArrayBuffer(size);
        const read = fileIo.readSync(file.fd, bytes);
        if (read !== size) { throw new Error('CLOUD_IMAGE_READ_FAILED'); }
        const view = new Uint8Array(bytes);
        body.contentType = view[0] === 0x89 && view[1] === 0x50 ? 'image/png' :
          view[0] === 0x52 && view[1] === 0x49 ? 'image/webp' : 'image/jpeg';
        body.imageBase64 = new util.Base64Helper().encodeToStringSync(view);
      } finally { fileIo.closeSync(file); }
    }
    const route: CloudRouteProfile = { executorId: 'cloud-shopping-api', inputResidence: 'device', outputDestination: 'device',
      accessMode: 'inline_transfer', transferAuthorized: true, inputBytes: utf8Bytes(JSON.stringify(body)), outputBytes: null,
      roundTripMs: null, uploadMbps: null, downloadMbps: null, storageReadMs: null, storageWriteMs: null,
      queueMs: null, estimatedFeeMinorUnits: null, accessExpiresAt: null, source: 'unavailable-before-first-transfer', observedAt: Date.now() };
    const request: CloudTaskRequest = { taskId: input.taskId, operation: input.operation,
      sessionId: input.sessionId, input: body, networkProfile: route, deviceProfile: input.deviceProfile, executionPlan: remote,
      taskProfile: { cloudRoutes: [route], taskId: input.taskId, toolId: 'product_search',
        inputRef: input.photoUri === undefined ? 'request:text' : 'request:image', outputType: 'Product[]',
        allowCloud: true, privacy: 'internal', inputBytes: route.inputBytes,
        deadlineMs: remote.timeoutMs, template: input.template, context: input.context } };
    const resultText = await this.request(baseUrl + '/api/v1/shopping/tasks', JSON.stringify(request), remote.timeoutMs, signal);
    const envelope = JSON.parse(resultText.body) as CloudEnvelope;
    if (!envelope.success || !envelope.data.runtimeRunId) { throw new Error('CLOUD_INVALID_RESULT'); }
    try {
      await this.request(baseUrl + '/api/v1/runtime/runs/' + envelope.data.runtimeRunId + '/client-telemetry',
        JSON.stringify({ taskId: input.taskId, timing: resultText.timing }), 3000, signal);
    } catch (_) { /* Result remains usable if the optional telemetry acknowledgement is unavailable. */ }
    const items: CloudCandidate[] = envelope.data.candidates?.items ?? [];
    return { output: items.map((item: CloudCandidate): Product => new Product(item.candidateItemId,
      item.platformName, item.title, String(item.price.amount), item.price.currency,
      item.stockStatus, item.shopName, item.shopType, item.productUrl, item.coverImageUrl)),
      telemetry: { executionPath: 'cloud-shopping-api', cloudRunId: envelope.data.runtimeRunId,
        cloudTaskId: input.taskId, cloudTiming: resultText.timing } };
  }

  private async request(url: string, body: string, timeoutMs: number, signal: CancellationSignal): Promise<CloudHttpResult> {
    if (signal.isCancellationRequested) { throw new Error('CLOUD_CANCELLED'); }
    const request = http.createHttp();
    const began: number = Date.now();
    let sentBytes: number = 0;
    let sentAt: number | null = null;
    request.on('dataSendProgress', (progress: http.DataSendProgressInfo) => {
      sentBytes += progress.sendSize;
      if (progress.totalSize > 0 && sentBytes >= progress.totalSize) { sentAt = Date.now() - began; }
    });
    const unsubscribe = signal.onCancelled(() => request.destroy());
    try {
      const response = await request.request(url, { method: body.length === 0 ? http.RequestMethod.GET : http.RequestMethod.POST,
        header: CloudApiConfig.requestHeaders(), extraData: body,
        connectTimeout: Math.min(timeoutMs, 10000), readTimeout: timeoutMs });
      if (signal.isCancellationRequested) { throw new Error('CLOUD_CANCELLED'); }
      if (response.responseCode < 200 || response.responseCode >= 300) {
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
      return { body: String(response.result), timing: { requestMs: Date.now() - began, uploadMs: uploadMs,
        downloadMs: downloadMs, inputBytes: utf8Bytes(body), outputBytes: utf8Bytes(String(response.result)) } };
    } finally { unsubscribe(); request.off('dataSendProgress'); request.destroy(); }
  }
  public async dispose(): Promise<void> {}
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
