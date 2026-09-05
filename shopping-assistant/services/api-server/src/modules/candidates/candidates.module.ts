import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { TrendOutfitModule } from '../trend-outfit/trend-outfit.module';
import { CANDIDATE_CURSOR_ADAPTER } from './application/candidate-cursor-adapter.interface';
import { CANDIDATE_ITEM_ADAPTER } from './application/candidate-item-adapter.interface';
import { CANDIDATE_SEARCH_CONTEXT_ADAPTER } from './application/candidate-search-context-adapter.interface';
import { CANDIDATE_VIEW_ADAPTER } from './application/candidate-view-adapter.interface';
import { CandidatesService } from './application/candidates.service';
import { StandardCandidateCursorAdapterService } from './application/standard-candidate-cursor-adapter.service';
import { StandardCandidateItemAdapterService } from './application/standard-candidate-item-adapter.service';
import { StandardCandidateSearchContextAdapterService } from './application/standard-candidate-search-context-adapter.service';
import { StandardCandidateViewAdapterService } from './application/standard-candidate-view-adapter.service';
import { CandidatesController } from './controllers/candidates.controller';

@Module({
  imports: [SearchModule, TrendOutfitModule],
  controllers: [CandidatesController],
  providers: [
    CandidatesService,
    StandardCandidateCursorAdapterService,
    StandardCandidateItemAdapterService,
    StandardCandidateSearchContextAdapterService,
    StandardCandidateViewAdapterService,
    {
      provide: CANDIDATE_CURSOR_ADAPTER,
      useExisting: StandardCandidateCursorAdapterService,
    },
    {
      provide: CANDIDATE_ITEM_ADAPTER,
      useExisting: StandardCandidateItemAdapterService,
    },
    {
      provide: CANDIDATE_SEARCH_CONTEXT_ADAPTER,
      useExisting: StandardCandidateSearchContextAdapterService,
    },
    {
      provide: CANDIDATE_VIEW_ADAPTER,
      useExisting: StandardCandidateViewAdapterService,
    },
  ],
  exports: [
    CandidatesService,
    CANDIDATE_CURSOR_ADAPTER,
    CANDIDATE_ITEM_ADAPTER,
    CANDIDATE_SEARCH_CONTEXT_ADAPTER,
    CANDIDATE_VIEW_ADAPTER,
  ],
})
export class CandidatesModule {}
