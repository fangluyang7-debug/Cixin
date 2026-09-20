import {
  ConversationTurnParseInput,
  ConversationTurnParseResult,
} from '../../../adapters/model/model-adapter.interface';

export const CONVERSATION_INTENT_ADAPTER = Symbol('CONVERSATION_INTENT_ADAPTER');

export interface ConversationIntentAdapter {
  parseTurn(input: ConversationTurnParseInput): Promise<ConversationTurnParseResult>;
}
