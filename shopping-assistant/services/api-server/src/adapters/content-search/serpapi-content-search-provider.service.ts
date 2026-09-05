import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContentSearchProvider,
  ContentSearchResult,
} from './content-search-provider.interface';
import { inferContentSearchSource } from './content-search-source.util';

@Injectable()
export class SerpApiContentSearchProviderService implements ContentSearchProvider {
  constructor(private readonly config: ConfigService) {}

  async search(input: {
    query: string;
    limit?: number;
  }): Promise<ContentSearchResult[]> {
    const apiKey = this.config.get<string>('contentSearch.serpapi.apiKey');
    if (!apiKey) {
      throw new InternalServerErrorException('SERPAPI_API_KEY_NOT_CONFIGURED');
    }

    const url = new URL(
      this.config.get<string>('contentSearch.serpapi.baseUrl') ??
        'https://serpapi.com/search',
    );
    url.searchParams.set(
      'engine',
      this.config.get<string>('contentSearch.serpapi.engine') ?? 'google',
    );
    url.searchParams.set('q', input.query);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set(
      'num',
      String(input.limit ?? this.config.get<number>('contentSearch.maxResultsPerQuery') ?? 8),
    );
    url.searchParams.set('hl', 'zh-cn');
    url.searchParams.set('gl', 'cn');

    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(
        this.config.get<number>('contentSearch.timeoutMs') ?? 5000,
      ),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `SERPAPI_CONTENT_SEARCH_FAILED:${response.status}`,
      );
    }

    return this.normalizeResponse(await response.json());
  }

  private normalizeResponse(body: unknown): ContentSearchResult[] {
    const record = this.asRecord(body);
    const organic = Array.isArray(record.organic_results)
      ? record.organic_results
      : [];
    return organic
      .map((item) => this.normalizeItem(this.asRecord(item)))
      .filter((item): item is ContentSearchResult => Boolean(item));
  }

  private normalizeItem(item: Record<string, unknown>): ContentSearchResult | null {
    const title = this.toString(item.title);
    const url = this.toString(item.link);
    if (!title || !url) return null;

    return {
      title,
      snippet: this.toString(item.snippet) ?? '',
      url,
      source: inferContentSearchSource(url),
      provider: 'serpapi',
      raw: item,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }
}
