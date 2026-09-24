import { Module } from '@nestjs/common';
import { PromptAssetsModule } from '../prompt-assets/prompt-assets.module';
import { UserMemoryModule } from '../user-memory/user-memory.module';
import { ConversationContextService } from './application/conversation-context.service';
import { CONVERSATION_CONTEXT_VIEW_ADAPTER } from './application/conversation-context-view-adapter.interface';
import { FilterStateService } from './application/filter-state.service';
import { StandardConversationContextViewAdapterService } from './application/standard-conversation-context-view-adapter.service';
import { ConversationController } from './controllers/conversation.controller';

@Module({
  imports: [PromptAssetsModule, UserMemoryModule],
  controllers: [ConversationController],
  providers: [
    ConversationContextService,
    FilterStateService,
    {
      provide: CONVERSATION_CONTEXT_VIEW_ADAPTER,
      useClass: StandardConversationContextViewAdapterService,
    },
  ],
  exports: [ConversationContextService, FilterStateService],
})
export class ConversationModule {}
