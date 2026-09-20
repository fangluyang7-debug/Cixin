import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContentSearchProvider,
  ContentSearchResult,
} from './content-search-provider.interface';
import { inferContentSearchSource } from './content-search-source.util';

@Injectable()
export class SerperContentSearchProviderService implements ContentSearchProvider {
  constructor(private readonly config: ConfigService) {}

  async search(input: {
    query: string;
    limit?: number;
  }): Promise<ContentSearchResult[]> {
    const apiKey = this.config.get<string>('contentSearch.serper.apiKey');
    if (!apiKey) {
      throw new InternalServerErrorException('SERPER_API_KEY_NOT_CONFIGURED');
    }

    const response = await fetch(this.resolveSearchUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({
        q: input.query,
        num: input.limit ?? this.config.get<number>('contentSearch.maxResultsPerQuery') ?? 8,
      }),
      signal: AbortSignal.timeout(
        this.config.get<number>('contentSearch.timeoutMs') ?? 5000,
      ),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `SERPER_CONTENT_SEARCH_FAILED:${response.status}`,
      );
    }

    return this.normalizeResponse(await response.json());
  }

  private resolveSearchUrl() {
    const baseUrl =
      this.config.get<string>('contentSearch.serper.baseUrl') ??
      'https://google.serper.dev';
    const trimmed = baseUrl.replace(/\/+$/g, '');
    return trimmed.endsWith('/search') ? trimmed : `${trimmed}/search`;
  }

  private normalizeResponse(body: unknown): ContentSearchResult[] {
    const record = this.asRecord(body);
    const organic = Array.isArray(record.organic) ? record.organic : [];
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
      provider: 'serper',
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
