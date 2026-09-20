export const TREND_CACHE_KEYS = {
  queryPlan: (itemTagHash: string) => `trend:query-plan:${itemTagHash}`,
  search: (provider: string, queryHash: string) =>
    `trend:search:${provider}:${queryHash}`,
  extract: (baseItemHash: string, searchResultHash: string) =>
    `trend:extract:${baseItemHash}:${searchResultHash}`,
  recommend: (baseItemHash: string, productPoolVersion: string) =>
    `trend:recommend:${baseItemHash}:${productPoolVersion}`,
} as const;
