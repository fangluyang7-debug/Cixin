import { Module } from '@nestjs/common';
import { ProductProfileModule } from '../product-profile/product-profile.module';
import { ProductPoolModule } from '../product-pool/product-pool.module';
import { SearchModule } from '../search/search.module';
import { FallbackModule } from '../fallback/fallback.module';
import { CandidatesModule } from '../candidates/candidates.module';
import { SuggestionsModule } from '../suggestions/suggestions.module';
import { ConversationModule } from '../conversation/conversation.module';
import { UserMemoryModule } from '../user-memory/user-memory.module';
import { CONVERSATION_INTENT_ADAPTER } from './application/conversation-intent-adapter.interface';
import { StandardConversationIntentAdapterService } from './application/standard-conversation-intent-adapter.service';
import { TurnsService } from './application/turns.service';
import { TurnsController } from './controllers/turns.controller';

@Module({
  imports: [
    ProductProfileModule,
    ProductPoolModule,
    SearchModule,
    FallbackModule,
    CandidatesModule,
    SuggestionsModule,
    ConversationModule,
    UserMemoryModule,
  ],
  controllers: [TurnsController],
  providers: [
    TurnsService,
    StandardConversationIntentAdapterService,
    {
      provide: CONVERSATION_INTENT_ADAPTER,
      useExisting: StandardConversationIntentAdapterService,
    },
  ],
})
export class TurnsModule {}
