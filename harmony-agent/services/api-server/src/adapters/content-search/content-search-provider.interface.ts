export type ContentSearchSource =
  | 'xiaohongshu'
  | 'douyin'
  | 'bilibili'
  | 'web'
  | 'unknown';

export interface ContentSearchResult {
  title: string;
  snippet: string;
  url: string;
  source: ContentSearchSource;
  provider: 'serper' | 'serpapi' | 'noop' | string;
  raw?: unknown;
  stale?: boolean;
}

export interface ContentSearchDebugInfo {
  searchProvider: string;
  attemptedProviders: string[];
  providerResultCounts: Record<string, number>;
  cacheHit?: boolean;
  stale?: boolean;
  errors?: Record<string, string>;
}

export interface ContentSearchProvider {
  search(input: {
    query: string;
    limit?: number;
    providerOverride?: string;
  }): Promise<ContentSearchResult[]>;
}

export interface DebuggableContentSearchProvider extends ContentSearchProvider {
  getLastDebug(): ContentSearchDebugInfo | null;
  getProviderName(): string;
}
