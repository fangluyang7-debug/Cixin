import { networkInterfaces } from 'node:os';
import { RouteCandidate, routeStatus } from '../scheduler/api/RemoteRouteProfile';
import { AttemptRecord, AttemptRequest, NodeSnapshot, PeerConfig, Quote, QuoteRequest } from '../contracts/fleet';
import { invariant, digest } from './util';

export interface PeerTransport {
  probe?(peer: PeerConfig, remainingMs: number): Promise<RouteCandidate>;
  invalidate?(peer: PeerConfig, reason: string): void;
  snapshot(peer: PeerConfig): Promise<NodeSnapshot>;
  quote(peer: PeerConfig, request: QuoteRequest): Promise<Quote>;
  submit(peer: PeerConfig, request: AttemptRequest): Promise<AttemptRecord>;
  get(peer: PeerConfig, key: string): Promise<AttemptRecord>;
  cancel(peer: PeerConfig, key: string): Promise<AttemptRecord>;
}
export class HttpTransport implements PeerTransport {
  private readonly routes = new Map<string, RouteCandidate>();
  invalidate(peer: PeerConfig, reason: string): void {
    const route = this.routes.get(peer.url);
    if (route) { route.invalidationReason = reason; route.cloudReachability = false; }
  }
  async probe(peer: PeerConfig, remainingMs: number): Promise<RouteCandidate> {
    const networkKey = digest(networkInterfaces());
    const cached = this.routes.get(peer.url);
    if (cached && cached.networkKey === networkKey && Date.now() - cached.observedAt < 2500 && routeStatus(cached) === 'fresh') return { ...cached };
    const started = performance.now();
    const budget = () => { const left = remainingMs - (performance.now() - started); invariant(left > 0, 'PROBE_DEADLINE_EXCEEDED'); return Math.min(3000, left); };
    try {
      const ping = performance.now();
      await this.call(peer, '/api/v1/runtime/probe/ping', undefined, budget());
      const rttMs = performance.now() - ping;
      const payload = { payload: 'x'.repeat(32768) };
      const up = performance.now();
      await this.call(peer, '/api/v1/runtime/probe/upload', payload, budget());
      const uplinkMbps = Buffer.byteLength(JSON.stringify(payload)) * 8 / Math.max(1, performance.now() - up) / 1000;
      const down = performance.now();
      const result = await this.call<{ padding: string }>(peer, '/api/v1/runtime/probe/download', undefined, budget());
      invariant(typeof result.padding === 'string' && result.padding.length === 32768, 'INVALID_DOWNLOAD_PROBE');
      const downlinkMbps = Buffer.byteLength(JSON.stringify(result)) * 8 / Math.max(1, performance.now() - down) / 1000;
      const route: RouteCandidate = { routeId: peer.deviceId, backend: 'edge', networkKey, rttMs,
        uplinkMbps, downlinkMbps, cloudQueueMs: 0, cloudReachability: true, remoteDependencyHealth: true,
        observedAt: Date.now(), bandwidthAt: Date.now(), dependenciesAt: Date.now(), source: 'measured-effective-throughput',
        estimatedUploadMs: 0, estimatedDownloadMs: 0, estimatedTotalMs: 0, costEstimate: null };
      this.routes.set(peer.url, route);
      if (this.routes.size > 64) this.routes.delete(this.routes.keys().next().value!);
      return { ...route };
    } catch (error) { this.invalidate(peer, 'PROBE_FAILED'); throw error; }
  }
  private async call<T>(peer: PeerConfig, path: string, body?: unknown, timeoutMs = 3000): Promise<T> {
    const token = process.env[peer.tokenEnv];
    invariant(token && token.length >= 24, `PEER_TOKEN_MISSING:${peer.deviceId}`);
    const response = await fetch(new URL(path, peer.url), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))),
    });
    invariant(response.ok, `PEER_HTTP_${response.status}`);
    invariant(response.body, 'PEER_EMPTY_RESPONSE');
    const downloadStarted = performance.now();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; invariant(size <= 2 * 1024 * 1024, 'PEER_RESPONSE_TOO_LARGE'); chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const duration = performance.now() - downloadStarted;
    const cached = this.routes.get(peer.url);
    if (cached && size >= 4096 && duration >= 1 && path.includes('/attempts/')) {
      const observed = size * 8 / duration / 1000;
      cached.downlinkMbps = cached.downlinkMbps * 0.7 + observed * 0.3;
      // Do not refresh the upload timestamp with a download observation.
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  }
  snapshot(peer: PeerConfig): Promise<NodeSnapshot> { return this.call(peer, '/api/v1/node/snapshot'); }
  quote(peer: PeerConfig, request: QuoteRequest): Promise<Quote> {
    return this.call(peer, '/api/v1/node/quote', request, Math.min(3000, request.remainingMs));
  }
  submit(peer: PeerConfig, request: AttemptRequest): Promise<AttemptRecord> {
    return this.call(peer, '/api/v1/node/attempts', request, Math.min(5000, request.remainingMs));
  }
  get(peer: PeerConfig, key: string): Promise<AttemptRecord> { return this.call(peer, `/api/v1/node/attempts/${key}`); }
  cancel(peer: PeerConfig, key: string): Promise<AttemptRecord> { return this.call(peer, `/api/v1/node/attempts/${key}/cancel`, {}); }
}
