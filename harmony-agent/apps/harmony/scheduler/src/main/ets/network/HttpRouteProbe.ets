import { http } from '@kit.NetworkKit';
import { CancellationSignal } from '../api/SchedulerTypes';
import { RouteProbePort, RemoteTaskProfile, RouteCandidate } from '../api/RemoteRouteProfile';
interface CapabilityCheck { available: boolean; }
interface ProbeData { checkedAt?: string; receivedBytes?: number; available?: boolean; queueMs?: number; padding?: string;
  capabilities?: Record<string, CapabilityCheck> }
interface ProbeEnvelope { data: ProbeData; }
export class HttpRouteProbe implements RouteProbePort {
  private readonly baseUrl: string;
  private readonly routeId: string;
  private readonly headers: Object;
  private readonly signal?: CancellationSignal;
  private readonly deadlineAt: number;
  private readonly capability: string;
  constructor(baseUrl: string, routeId: string, headers: Object, signal: CancellationSignal | undefined,
    deadlineAt: number, capability: string) {
    this.baseUrl = baseUrl; this.routeId = routeId; this.headers = headers; this.signal = signal; this.deadlineAt = deadlineAt;
    this.capability = capability;
  }
  public async probe(profile: RemoteTaskProfile): Promise<RouteCandidate> {
    const pingStart = Date.now();
    const ping = await this.call('/ping');
    if (ping.available !== true) { throw new Error('ROUTE_UNREACHABLE'); }
    const rtt = Math.max(1, Date.now() - pingStart);
    const pingAt = Date.now();
    // Effective throughput includes protocol overhead: a conservative bound, not link capacity.
    const sampleBytes = profile.latencyClass === 'realtime' ? 4096 : profile.latencyClass === 'interactive' ? 8192 : 32768;
    const payload = JSON.stringify({ payload: 'x'.repeat(sampleBytes) });
    const upStart = Date.now();
    const uploaded = await this.call('/upload', payload);
    if (uploaded.receivedBytes !== sampleBytes) { throw new Error('UPLOAD_PROBE_INVALID'); }
    const up = utf8Bytes(payload) * 8 / Math.max(1, Date.now() - upStart) / 1000;
    const downStart = Date.now();
    const download = await this.call('/download');
    if (download.padding?.length !== 32768) { throw new Error('DOWNLOAD_PROBE_INVALID'); }
    const down = utf8Bytes(JSON.stringify(download)) * 8 / Math.max(1, Date.now() - downStart) / 1000;
    const bandwidthAt = Date.now();
    const queue = await this.call('/minimal-task', '{}');
    if (queue.queueMs === undefined || !Number.isFinite(queue.queueMs) || queue.queueMs < 0) { throw new Error('QUEUE_PROBE_INVALID'); }
    const health = await this.call('/api/v1/health/capabilities');
    return { routeId: this.routeId, backend: 'cloud', networkKey: this.baseUrl,
      rttMs: rtt, uplinkMbps: up, downlinkMbps: down, cloudQueueMs: queue.queueMs,
      cloudReachability: true, remoteDependencyHealth: health.capabilities?.[this.capability]?.available === true,
      observedAt: pingAt, bandwidthAt: bandwidthAt, dependenciesAt: health.checkedAt === undefined ? Date.now() : Date.parse(health.checkedAt),
      source: 'measured-effective-throughput', estimatedUploadMs: 0, estimatedDownloadMs: 0,
      estimatedTotalMs: 0, costEstimate: null };
  }
  private async call(path: string, body: string = ''): Promise<ProbeData> {
    if (this.signal?.isCancellationRequested) { throw new Error('CLOUD_CANCELLED'); }
    const remaining = Math.min(20000, this.deadlineAt - Date.now());
    if (remaining <= 0) { throw new Error('ROUTE_PROBE_DEADLINE'); }
    const request = http.createHttp();
    const unsubscribe = this.signal?.onCancelled(() => request.destroy());
    try {
      const url = path.startsWith('/api/') ? this.baseUrl + path : this.baseUrl + '/api/v1/runtime/probe' + path;
      const response = await request.request(url, {
        method: body.length === 0 ? http.RequestMethod.GET : http.RequestMethod.POST,
        header: this.headers, extraData: body, connectTimeout: Math.min(3000, remaining), readTimeout: remaining });
      if (response.responseCode !== 200 && response.responseCode !== 201) { throw new Error('ROUTE_PROBE_FAILED'); }
      return (JSON.parse(String(response.result)) as ProbeEnvelope).data;
    } finally { unsubscribe?.(); request.destroy(); }
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
