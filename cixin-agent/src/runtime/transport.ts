import { AttemptRecord, AttemptRequest, NodeSnapshot, PeerConfig, Quote, QuoteRequest } from '../contracts/fleet';
import { invariant } from './util';

export interface PeerTransport {
  snapshot(peer: PeerConfig): Promise<NodeSnapshot>;
  quote(peer: PeerConfig, request: QuoteRequest): Promise<Quote>;
  submit(peer: PeerConfig, request: AttemptRequest): Promise<AttemptRecord>;
  get(peer: PeerConfig, key: string): Promise<AttemptRecord>;
  cancel(peer: PeerConfig, key: string): Promise<AttemptRecord>;
}
export class HttpTransport implements PeerTransport {
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
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; invariant(size <= 2 * 1024 * 1024, 'PEER_RESPONSE_TOO_LARGE'); chunks.push(value);
      }
    } finally { await reader.cancel(); }
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
