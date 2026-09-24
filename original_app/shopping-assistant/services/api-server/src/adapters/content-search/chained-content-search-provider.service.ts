import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContentSearchDebugInfo,
  ContentSearchProvider,
  ContentSearchResult,
} from './content-search-provider.interface';
import { dedupeContentSearchResults } from './content-search-source.util';
import { NoopContentSearchProviderService } from './noop-content-search-provider.service';
import { SerperContentSearchProviderService } from './serper-content-search-provider.service';
import { SerpApiContentSearchProviderService } from './serpapi-content-search-provider.service';

@Injectable()
export class ChainedContentSearchProviderService implements ContentSearchProvider {
  private lastDebug: ContentSearchDebugInfo | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly serper: SerperContentSearchProviderService,
    private readonly serpapi: SerpApiContentSearchProviderService,
    private readonly noop: NoopContentSearchProviderService,
  ) {}

  async search(input: {
    query: string;
    limit?: number;
  }): Promise<ContentSearchResult[]> {
    const chain = this.resolveProviderChain();
    const attemptedProviders: string[] = [];
    const providerResultCounts: Record<string, number> = {};
    const errors: Record<string, string> = {};
    const merged: ContentSearchResult[] = [];
    let failedCount = 0;
    const earlyResultMinCount = this.earlyResultMinCount();

    for (const providerName of chain) {
      attemptedProviders.push(providerName);
      try {
        const results = await this.providerFor(providerName).search(input);
        providerResultCounts[providerName] = results.length;
        merged.push(...results);
        const deduped = dedupeContentSearchResults(merged);
        if (deduped.length >= earlyResultMinCount) {
          this.lastDebug = {
            searchProvider: 'chain',
            attemptedProviders,
            providerResultCounts,
            errors: Object.keys(errors).length > 0 ? errors : undefined,
          };
          return deduped;
        }
      } catch (error) {
        failedCount += 1;
        providerResultCounts[providerName] = 0;
        errors[providerName] = this.safeErrorCode(error);
      }
    }

    const deduped = dedupeContentSearchResults(merged);
    this.lastDebug = {
      searchProvider: 'chain',
      attemptedProviders,
      providerResultCounts,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    };
    if (deduped.length === 0 && failedCount === chain.length) {
      throw new InternalServerErrorException('CONTENT_SEARCH_CHAIN_FAILED');
    }
    return deduped;
  }

  getLastDebug() {
    return this.lastDebug;
  }

  private resolveProviderChain() {
    const configured =
      this.config.get<string>('contentSearch.providerChain') ?? 'serper,serpapi';
    const providers = configured
      .split(',')
      .map((item) => this.normalizeProviderName(item))
      .filter((item): item is 'serper' | 'serpapi' | 'noop' => Boolean(item));
    return providers.length > 0 ? providers : (['serper', 'serpapi'] as const);
  }

  private providerFor(providerName: string): ContentSearchProvider {
    if (providerName === 'serper') return this.serper;
    if (providerName === 'serpapi') return this.serpapi;
    return this.noop;
  }

  private normalizeProviderName(value: string) {
    const provider = value.trim().toLowerCase();
    if (provider === 'serper' || provider === 'serpapi' || provider === 'noop') {
      return provider;
    }
    if (provider === 'none') return 'noop';
    return null;
  }

  private earlyResultMinCount() {
    const configured = this.config.get<number>('contentSearch.earlyResultMinCount');
    const value = typeof configured === 'number' ? configured : Number(configured);
    return Number.isInteger(value) && value > 0 ? value : 3;
  }

  private safeErrorCode(error: unknown) {
    if (error instanceof Error && error.message) return error.message.split('\n')[0];
    return 'CONTENT_SEARCH_PROVIDER_FAILED';
  }
}
