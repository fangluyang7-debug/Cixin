import { Controller, Get, Param } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { ConversationContextService } from '../application/conversation-context.service';

@Controller('api/v1/sessions')
export class ConversationController {
  constructor(private readonly conversationContext: ConversationContextService) {}

  @Get(':sessionId/conversation')
  async getConversation(@Param('sessionId') sessionId: string) {
    return ok(await this.conversationContext.getConversationDebug(sessionId));
  }
}
