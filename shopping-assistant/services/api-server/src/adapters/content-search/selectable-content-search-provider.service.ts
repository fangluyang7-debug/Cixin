import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { stableHash } from '../../cache/cache-key.util';
import { TREND_CACHE_KEYS } from '../../cache/cache-namespaces';
import { CACHE_STORE } from '../../cache/cache.constants';
import { CacheStore } from '../../cache/interfaces/cache-store.interface';
import {
  ContentSearchDebugInfo,
  ContentSearchProvider,
  ContentSearchResult,
  DebuggableContentSearchProvider,
} from './content-search-provider.interface';
import { ChainedContentSearchProviderService } from './chained-content-search-provider.service';
import { NoopContentSearchProviderService } from './noop-content-search-provider.service';
import { SerperContentSearchProviderService } from './serper-content-search-provider.service';
import { SerpApiContentSearchProviderService } from './serpapi-content-search-provider.service';

interface CachedContentSearchResults {
  provider: string;
  queryHash: string;
  createdAt: string;
  expiresAt: string;
  results: ContentSearchResult[];
}

@Injectable()
export class SelectableContentSearchProviderService
  implements DebuggableContentSearchProvider
{
  private lastDebug: ContentSearchDebugInfo | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(CACHE_STORE)
    private readonly cache: CacheStore,
    private readonly serper: SerperContentSearchProviderService,
    private readonly serpapi: SerpApiContentSearchProviderService,
    private readonly chain: ChainedContentSearchProviderService,
    private readonly noop: NoopContentSearchProviderService,
  ) {}

  async search(input: {
    query: string;
    limit?: number;
    providerOverride?: string;
  }): Promise<ContentSearchResult[]> {
    const provider = this.resolveProvider(input.providerOverride);
    const limit = this.resolveLimit(input.limit);
    const queryHash = stableHash({ query: input.query, limit });
    const cacheKey = TREND_CACHE_KEYS.search(provider, queryHash);
    const cached = await this.cache.get<CachedContentSearchResults>(cacheKey);
    const now = Date.now();

    if (cached && new Date(cached.expiresAt).getTime() > now) {
      this.lastDebug = {
        searchProvider: provider,
        attemptedProviders: [provider],
        providerResultCounts: { [provider]: cached.results.length },
        cacheHit: true,
        stale: false,
      };
      return cached.results;
    }

    try {
      const results = await this.providerFor(provider).search({
        query: input.query,
        limit,
      });
      const normalizedResults = results.slice(0, limit);
      const providerDebug = this.providerDebug(provider);
      this.lastDebug = {
        searchProvider: provider,
        attemptedProviders: providerDebug?.attemptedProviders ?? [provider],
        providerResultCounts: providerDebug?.providerResultCounts ?? {
          [provider]: normalizedResults.length,
        },
        cacheHit: false,
        stale: false,
        errors: providerDebug?.errors,
      };
      await this.cache.set(
        cacheKey,
        {
          provider,
          queryHash,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + this.freshTtlSeconds() * 1000).toISOString(),
          results: normalizedResults,
        },
        this.staleTtlSeconds(),
      );
      return normalizedResults;
    } catch (error) {
      if (cached) {
        const staleResults = cached.results.map((result) => ({
          ...result,
          stale: true,
        }));
        this.lastDebug = {
          searchProvider: provider,
          attemptedProviders: [provider],
          providerResultCounts: { [provider]: staleResults.length },
          cacheHit: true,
          stale: true,
          errors: { [provider]: this.safeErrorCode(error) },
        };
        return staleResults;
      }
      this.lastDebug = {
        searchProvider: provider,
        attemptedProviders: [provider],
        providerResultCounts: { [provider]: 0 },
        cacheHit: false,
        stale: false,
        errors: { [provider]: this.safeErrorCode(error) },
      };
      throw new InternalServerErrorException('CONTENT_SEARCH_PROVIDER_FAILED');
    }
  }

  getLastDebug() {
    return this.lastDebug;
  }

  getProviderName() {
    return this.resolveProvider();
  }

  private providerFor(provider: string): ContentSearchProvider {
    if (provider === 'serper') return this.serper;
    if (provider === 'serpapi') return this.serpapi;
    if (provider === 'chain') return this.chain;
    return this.noop;
  }

  private providerDebug(provider: string) {
    if (provider === 'chain') return this.chain.getLastDebug();
    if (provider === 'noop') return this.noop.getLastDebug();
    return null;
  }

  private resolveProvider(providerOverride?: string | null) {
    const value =
      providerOverride ??
      this.config.get<string>('contentSearch.provider') ??
      process.env.CONTENT_SEARCH_PROVIDER;
    const provider = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (provider === 'serper' || provider === 'serpapi' || provider === 'chain') {
      return provider;
    }
    return 'noop';
  }

  private resolveLimit(value: unknown) {
    const max =
      this.config.get<number>('contentSearch.maxResultsPerQuery') ??
      Number(process.env.CONTENT_SEARCH_MAX_RESULTS_PER_QUERY ?? 8);
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return max;
    return Math.min(parsed, max);
  }

  private freshTtlSeconds() {
    return 60 * 60 * 12;
  }

  private staleTtlSeconds() {
    return 60 * 60 * 24;
  }

  private safeErrorCode(error: unknown) {
    if (error instanceof Error && error.message) return error.message.split('\n')[0];
    return 'CONTENT_SEARCH_PROVIDER_FAILED';
  }
}
