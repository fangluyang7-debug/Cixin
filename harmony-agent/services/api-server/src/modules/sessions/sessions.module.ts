import { Module } from '@nestjs/common';
import { CacheModule } from '../../cache/cache.module';
import { AssetsModule } from '../assets/assets.module';
import { AuthModule } from '../auth/auth.module';
import { ProductProfileModule } from '../product-profile/product-profile.module';
import { PromptAssetsModule } from '../prompt-assets/prompt-assets.module';
import { ProductPoolModule } from '../product-pool/product-pool.module';
import { SearchModule } from '../search/search.module';
import { FallbackModule } from '../fallback/fallback.module';
import { CandidatesModule } from '../candidates/candidates.module';
import { SuggestionsModule } from '../suggestions/suggestions.module';
import { UserMemoryModule } from '../user-memory/user-memory.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { SessionsService } from './application/sessions.service';
import { SearchEventsService } from './application/search-events.service';
import { SEARCH_EVENT_ADAPTER } from './application/search-event-adapter.interface';
import { StandardSearchEventAdapterService } from './application/standard-search-event-adapter.service';
import { QueryImagePreprocessService } from './application/query-image-preprocess.service';
import { QUERY_IMAGE_CONTENT_ADAPTER } from './application/query-image-content-adapter.interface';
import { QUERY_IMAGE_PREPROCESS_ADAPTER } from './application/query-image-preprocess-adapter.interface';
import { StandardQueryImageContentAdapterService } from './application/standard-query-image-content-adapter.service';
import { StandardQueryImagePreprocessAdapterService } from './application/standard-query-image-preprocess-adapter.service';
import { SESSION_PRODUCT_PROFILE_ADAPTER } from './application/session-product-profile-adapter.interface';
import { StandardSessionProductProfileAdapterService } from './application/standard-session-product-profile-adapter.service';
import { SESSION_VIEW_ADAPTER } from './application/session-view-adapter.interface';
import { StandardSessionViewAdapterService } from './application/standard-session-view-adapter.service';
import { SearchDebugService } from './application/search-debug.service';
import { SessionsController } from './controllers/sessions.controller';
import { SearchDebugController } from './controllers/search-debug.controller';

@Module({
  imports: [
    CacheModule,
    AuthModule,
    AssetsModule,
    ProductProfileModule,
    PromptAssetsModule,
    ProductPoolModule,
    SearchModule,
    FallbackModule,
    CandidatesModule,
    SuggestionsModule,
    UserMemoryModule,
    RuntimeModule,
  ],
  controllers: [SessionsController, SearchDebugController],
  providers: [
    SessionsService,
    SearchDebugService,
    SearchEventsService,
    StandardSearchEventAdapterService,
    StandardSessionProductProfileAdapterService,
    StandardSessionViewAdapterService,
    QueryImagePreprocessService,
    StandardQueryImageContentAdapterService,
    StandardQueryImagePreprocessAdapterService,
    {
      provide: SEARCH_EVENT_ADAPTER,
      useExisting: StandardSearchEventAdapterService,
    },
    {
      provide: QUERY_IMAGE_CONTENT_ADAPTER,
      useExisting: StandardQueryImageContentAdapterService,
    },
    {
      provide: QUERY_IMAGE_PREPROCESS_ADAPTER,
      useExisting: StandardQueryImagePreprocessAdapterService,
    },
    {
      provide: SESSION_PRODUCT_PROFILE_ADAPTER,
      useExisting: StandardSessionProductProfileAdapterService,
    },
    {
      provide: SESSION_VIEW_ADAPTER,
      useExisting: StandardSessionViewAdapterService,
    },
  ],
  exports: [SessionsService],
})
export class SessionsModule {}
