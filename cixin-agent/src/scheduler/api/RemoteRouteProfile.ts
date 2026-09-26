// Generic, application-independent network contract. Values are never filled with fake defaults.
export interface RemoteTaskInput { modality: string; bytes: number; requiresUpload: boolean; }
export interface RemoteTaskProfile {
  taskKind: string;
  latencyClass: 'realtime' | 'interactive' | 'background';
  input: RemoteTaskInput;
  estimatedResultBytes: number;
  allowCloud: boolean;
}
export interface RouteCandidate {
  routeId: string;
  backend: 'local' | 'cloud' | 'edge';
  networkKey: string;
  rttMs: number;
  uplinkMbps: number;
  downlinkMbps: number;
  cloudQueueMs: number;
  cloudReachability: boolean;
  remoteDependencyHealth: boolean;
  observedAt: number;
  bandwidthAt: number;
  dependenciesAt: number;
  source: string;
  estimatedUploadMs: number;
  estimatedDownloadMs: number;
  estimatedTotalMs: number;
  costEstimate: number | null;
  historyKey?: string;
  invalidationReason?: string;
}
export interface ExecutionTelemetry {
  taskId: string;
  routeId: string;
  phase: 'upload' | 'queue' | 'compute' | 'download' | 'complete' | 'failed';
  timestamp: number;
  durationMs?: number;
  bytesSent?: number;
  bytesReceived?: number;
  errorCode?: string;
}
export interface RouteProbePort {
  probe(profile: RemoteTaskProfile): Promise<RouteCandidate>;
}
export class RemoteRouteRegistry {
  private routes: Map<string, RouteCandidate> = new Map<string, RouteCandidate>();
  private history: Map<string, number> = new Map<string, number>();
  public status(key: string): string {
    const route = this.routes.get(key);
    return route === undefined ? 'REMOTE_ROUTE_MISSING' : routeStatus(route);
  }
  public invalidate(key: string, reason: string): void {
    const route = this.routes.get(key);
    if (route !== undefined) { route.invalidationReason = reason; route.cloudReachability = false; }
  }
  public async prepare(key: string, profile: RemoteTaskProfile, port: RouteProbePort,
    computePriorMs: number): Promise<RouteCandidate> {
    let route = this.routes.get(key);
    if (route === undefined || routeStatus(route, profile.latencyClass) !== 'fresh') {
      route = await port.probe(profile);
      this.routes.set(key, route);
      if (this.routes.size > 32) { this.routes.delete(Array.from(this.routes.keys())[0]); }
    }
    const snapshot = JSON.parse(JSON.stringify(route)) as RouteCandidate;
    snapshot.estimatedUploadMs = profile.input.requiresUpload ? profile.input.bytes * 8 / (snapshot.uplinkMbps * 1000) : 0;
    snapshot.estimatedDownloadMs = profile.estimatedResultBytes * 8 / (snapshot.downlinkMbps * 1000);
    snapshot.historyKey = key + ':' + profile.taskKind + ':' + profile.input.modality + ':' + Math.floor(Math.log2(Math.max(1, profile.input.bytes)));
    snapshot.estimatedTotalMs = snapshot.rttMs + snapshot.estimatedUploadMs + snapshot.estimatedDownloadMs +
      snapshot.cloudQueueMs + (this.history.get(snapshot.historyKey) ?? computePriorMs);
    return snapshot;
  }
  public observe(key: string, route: RouteCandidate, totalMs: number, uploadMs: number | null,
    downloadMs: number | null, inputBytes: number, outputBytes: number, actualComputeMs?: number): void {
    const cached = this.routes.get(key);
    if (cached === undefined || cached.invalidationReason !== undefined) { return; }
    // Residual is an EWMA prediction prior, not a measured compute duration.
    if (actualComputeMs !== undefined && Number.isFinite(actualComputeMs) && actualComputeMs >= 0 || uploadMs !== null && downloadMs !== null) {
      const compute = actualComputeMs !== undefined && Number.isFinite(actualComputeMs) && actualComputeMs >= 0 ? actualComputeMs :
        Math.max(0, totalMs - (uploadMs ?? 0) - (downloadMs ?? 0) - route.rttMs - route.cloudQueueMs);
      const historyKey = route.historyKey ?? key;
      this.history.set(historyKey, (this.history.get(historyKey) ?? compute) * 0.7 + compute * 0.3);
      if (this.history.size > 128) { this.history.delete(Array.from(this.history.keys())[0]); }
    }
    // Preserve bandwidth probe timestamps unless both directions were actually observed.
    if (uploadMs !== null && uploadMs > 0 && downloadMs !== null && downloadMs > 0 && inputBytes > 0 && outputBytes > 0) {
      cached.uplinkMbps = cached.uplinkMbps * 0.7 + inputBytes * 8 / uploadMs / 1000 * 0.3;
      cached.downlinkMbps = cached.downlinkMbps * 0.7 + outputBytes * 8 / downloadMs / 1000 * 0.3;
      cached.bandwidthAt = Date.now();
    }
  }
}
export function routeStatus(route: RouteCandidate, latencyClass: string = 'interactive', now: number = Date.now()): string {
  if (route.invalidationReason !== undefined) { return route.invalidationReason; }
  if (!route.cloudReachability || !route.remoteDependencyHealth) { return 'REMOTE_UNAVAILABLE'; }
  if (![route.rttMs, route.cloudQueueMs, route.uplinkMbps, route.downlinkMbps, route.observedAt,
    route.bandwidthAt, route.dependenciesAt].every((v: number) => Number.isFinite(v) && v >= 0) ||
    route.uplinkMbps <= 0 || route.downlinkMbps <= 0) { return 'ROUTE_METRICS_INVALID'; }
  const rttTtl = latencyClass === 'realtime' ? 10000 : latencyClass === 'background' ? 120000 : 30000;
  const bandwidthTtl = latencyClass === 'background' ? 180000 : 60000;
  if (route.observedAt > now + 5000 || route.bandwidthAt > now + 5000 || route.dependenciesAt > now + 5000 ||
    now - route.observedAt > Math.min(rttTtl, 60000) || now - route.bandwidthAt > bandwidthTtl ||
    now - route.dependenciesAt > (latencyClass === 'background' ? 300000 : 180000)) { return 'ROUTE_EXPIRED'; }
  return 'fresh';
}
