import { Injectable } from '@nestjs/common';
import {
  ContentSearchDebugInfo,
  ContentSearchProvider,
  ContentSearchResult,
} from './content-search-provider.interface';

@Injectable()
export class NoopContentSearchProviderService implements ContentSearchProvider {
  private lastDebug: ContentSearchDebugInfo | null = null;

  async search(): Promise<ContentSearchResult[]> {
    this.lastDebug = {
      searchProvider: 'noop',
      attemptedProviders: ['noop'],
      providerResultCounts: { noop: 0 },
    };
    return [];
  }

  getLastDebug() {
    return this.lastDebug;
  }
}
