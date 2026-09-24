import { Injectable } from '@nestjs/common';
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
import { fromJson } from '../../../common/utils/json';
import { ConversationContextViewAdapter } from './conversation-context-view-adapter.interface';

@Injectable()
export class StandardConversationContextViewAdapterService
  implements ConversationContextViewAdapter
{
  toContextMessage(message: ConversationMessage): ConversationContextMessage {
    return {
      turnIndex: message.turnIndex,
      role: this.toConversationRole(message.role),
      content: message.content,
      metadata: fromJson<Record<string, unknown>>(message.metadataJson, {}),
      createdAt: message.createdAt.toISOString(),
    };
  }

  toSummaryContext(summary: ConversationSummary): ConversationSummaryContext {
    return {
      summaryText: summary.summaryText,
      summaryJson: fromJson<Record<string, unknown>>(summary.summaryJson, {}),
      coveredTurnIndex: summary.coveredTurnIndex,
      createdAt: summary.createdAt.toISOString(),
    };
  }

  toCandidateSummaryItem(item: CandidateItem): ConversationCandidateSummaryItem {
    const normalizedAttributes = fromJson<Record<string, unknown>>(
      item.normalizedAttributesJson,
      {},
    );
    const rawPayload = fromJson<Record<string, unknown>>(item.rawPayloadJson, {});
    const productPoolSource = rawPayload.productPoolSource as
      | Record<string, unknown>
      | undefined;
    const productId =
      typeof normalizedAttributes.productId === 'string'
        ? normalizedAttributes.productId
        : typeof productPoolSource?.productId === 'string'
          ? productPoolSource.productId
          : null;

    return {
      candidateItemId: item.id,
      productId,
      title: item.title,
      platformName: item.platformName,
      amount: item.amount,
      currency: item.currency,
      stockStatus: item.stockStatus,
      matchSummary: fromJson<Record<string, unknown>>(item.matchSummaryJson, {}),
    };
  }

  toProductProfile(snapshot: ProductProfileSnapshot): ProductProfileResult {
    const raw = fromJson<Record<string, unknown>>(snapshot.rawJson, {});
    return {
      category: snapshot.category,
      brand: snapshot.brand,
      modelLine: typeof raw.modelLine === 'string' ? raw.modelLine : null,
      colorFamily:
        typeof raw.colorFamily === 'string' ? raw.colorFamily : null,
      colorway: typeof raw.colorway === 'string' ? raw.colorway : null,
      shoeType: typeof raw.shoeType === 'string' ? raw.shoeType : null,
      size: snapshot.size,
      color: snapshot.color,
      styleTags: fromJson<string[]>(snapshot.styleTagsJson, []),
      sceneTags: fromJson<string[]>(snapshot.sceneTagsJson, []),
      keywords: fromJson<string[]>(snapshot.keywordsJson, []),
      confidence: snapshot.confidence ?? 0,
      raw,
    };
  }

  toDebugMessage(message: ConversationMessage): Record<string, unknown> {
    return {
      messageId: message.id,
      turnIndex: message.turnIndex,
      role: message.role,
      content: message.content,
      metadata: fromJson<Record<string, unknown>>(message.metadataJson, {}),
      createdAt: message.createdAt.toISOString(),
    };
  }

  toDebugSummary(summary: ConversationSummary): Record<string, unknown> {
    return {
      summaryId: summary.id,
      summaryText: summary.summaryText,
      summaryJson: fromJson<Record<string, unknown>>(summary.summaryJson, {}),
      coveredTurnIndex: summary.coveredTurnIndex,
      createdAt: summary.createdAt.toISOString(),
    };
  }

  private toConversationRole(role: string): 'user' | 'assistant' | 'system' {
    if (role === 'assistant' || role === 'system') return role;
    return 'user';
  }
}
