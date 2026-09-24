import {
  CandidateItem,
  ConversationMessage,
  ConversationSummary,
  ProductProfileSnapshot,
} from '@prisma/client';
import {
  ConversationCandidateSummaryItem,
  ConversationContextMessage,
  ConversationSummaryContext,
  ProductProfileResult,
} from '../../../adapters/model/model-adapter.interface';

export const CONVERSATION_CONTEXT_VIEW_ADAPTER = Symbol(
  'CONVERSATION_CONTEXT_VIEW_ADAPTER',
);

export interface ConversationContextViewAdapter {
  toContextMessage(message: ConversationMessage): ConversationContextMessage;
  toSummaryContext(summary: ConversationSummary): ConversationSummaryContext;
  toCandidateSummaryItem(item: CandidateItem): ConversationCandidateSummaryItem;
  toProductProfile(snapshot: ProductProfileSnapshot): ProductProfileResult;
  toDebugMessage(message: ConversationMessage): Record<string, unknown>;
  toDebugSummary(summary: ConversationSummary): Record<string, unknown>;
}
