import { Module } from '@nestjs/common';
import { CacheModule } from '../../cache/cache.module';
import { CONTENT_SEARCH_PROVIDER } from './content-search.constants';
import { ChainedContentSearchProviderService } from './chained-content-search-provider.service';
import { ContentSearchDebugController } from './content-search-debug.controller';
import { NoopContentSearchProviderService } from './noop-content-search-provider.service';
import { SelectableContentSearchProviderService } from './selectable-content-search-provider.service';
import { SerperContentSearchProviderService } from './serper-content-search-provider.service';
import { SerpApiContentSearchProviderService } from './serpapi-content-search-provider.service';

@Module({
  imports: [CacheModule],
  controllers: [ContentSearchDebugController],
  providers: [
    NoopContentSearchProviderService,
    SerperContentSearchProviderService,
    SerpApiContentSearchProviderService,
    ChainedContentSearchProviderService,
    SelectableContentSearchProviderService,
    {
      provide: CONTENT_SEARCH_PROVIDER,
      useExisting: SelectableContentSearchProviderService,
    },
  ],
  exports: [CONTENT_SEARCH_PROVIDER],
})
export class ContentSearchModule {}
