import { Module } from '@nestjs/common';
import { SuggestionsService } from './application/suggestions.service';
import { SUGGESTION_VIEW_ADAPTER } from './application/suggestion-view-adapter.interface';
import { StandardSuggestionViewAdapterService } from './application/standard-suggestion-view-adapter.service';
import { SuggestionsController } from './controllers/suggestions.controller';

@Module({
  controllers: [SuggestionsController],
  providers: [
    SuggestionsService,
    StandardSuggestionViewAdapterService,
    {
      provide: SUGGESTION_VIEW_ADAPTER,
      useExisting: StandardSuggestionViewAdapterService,
    },
  ],
  exports: [SuggestionsService],
})
export class SuggestionsModule {}
