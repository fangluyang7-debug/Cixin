/**
 * Stable seam for model integrations. Runtime scheduling only depends on this
 * port; provider credentials, SDKs and model-specific payloads stay behind it.
 */
export interface ModelProviderPort {
  readonly providerId: string;
  readonly capabilities: readonly ('chat' | 'vision' | 'embedding')[];
  probe(signal?: AbortSignal): Promise<ModelProviderProbe>;
  invoke(request: ModelProviderRequest, signal?: AbortSignal): Promise<ModelProviderResponse>;
}

export interface ModelProviderProbe {
  available: boolean;
  modelId?: string;
  dimension?: number;
  reason?: string;
}

export interface ModelProviderRequest {
  capability: 'chat' | 'vision' | 'embedding';
  modelId?: string;
  input: unknown;
  metadata?: Record<string, string>;
}

export interface ModelProviderResponse {
  output: unknown;
  quality?: number;
  usage?: { inputTokens?: number; outputTokens?: number; latencyMs?: number };
}
