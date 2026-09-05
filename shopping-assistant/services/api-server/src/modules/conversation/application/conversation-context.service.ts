import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ProductProfileSnapshot } from '@prisma/client';
import {
  ConversationCandidateSummaryItem,
  ConversationContextMessage,
  ConversationSummaryContext,
  ConversationTurnParseInput,
  ProductProfileResult,
} from '../../../adapters/model/model-adapter.interface';
import { createId } from '../../../common/utils/id';
import { toJsonString } from '../../../common/utils/json';
import {
  normalizeProductCategory,
  normalizeProductCategoryOrNull,
} from '../../../common/catalog/product-categories';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { ProfileSchemaRegistryService } from '../../prompt-assets/application/profile-schema-registry.service';
import { PromptRegistryService } from '../../prompt-assets/application/prompt-registry.service';
import { UserMemoryContextService } from '../../user-memory/application/user-memory-context.service';
import {
  CONVERSATION_CONTEXT_VIEW_ADAPTER,
  ConversationContextViewAdapter,
} from './conversation-context-view-adapter.interface';
import { EffectiveFilterState, FilterStateService } from './filter-state.service';

interface BuildContextInput {
  sessionId: string;
  turnIndex: number;
  latestUserMessage: string;
  productProfile: ProductProfileResult | null;
}

@Injectable()
export class ConversationContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promptRegistry: PromptRegistryService,
    private readonly profileSchemaRegistry: ProfileSchemaRegistryService,
    private readonly userMemoryContext: UserMemoryContextService,
    private readonly filterState: FilterStateService,
    @Inject(CONVERSATION_CONTEXT_VIEW_ADAPTER)
    private readonly contextViewAdapter: ConversationContextViewAdapter,
  ) {}

  async createMessage(input: {
    sessionId: string;
    turnIndex: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.conversationMessage.create({
      data: {
        id: createId('conv_msg'),
        sessionId: input.sessionId,
        turnIndex: input.turnIndex,
        role: input.role,
        content: input.content,
        metadataJson: toJsonString(input.metadata ?? {}),
      },
    });
  }

  async buildContext(input: BuildContextInput): Promise<ConversationTurnParseInput> {
    const session = await this.prisma.querySession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');

    const latestFilter = await this.getLatestFilter(input.sessionId);
    const category = normalizeProductCategory(
      normalizeProductCategoryOrNull(input.latestUserMessage) ??
        session.categoryHint ??
        latestFilter.categoryScope ??
        input.productProfile?.category,
      'general',
    );
    const [recentMessages, latestSummary, candidateSummary, userMemoryContext] = await Promise.all([
      this.getRecentMessages(input.sessionId, 12),
      this.getLatestSummary(input.sessionId),
      this.getCandidateSummary(input.sessionId, 5),
      session.userId ? this.userMemoryContext.getContext(session.userId, category) : Promise.resolve(null),
    ]);

    const prompt = this.promptRegistry.getConversationPrompt(category);
    const outputSchema = this.promptRegistry.getFilterOutputSchema();
    const profileSchema = this.profileSchemaRegistry.getProfileSchema(category);

    return {
      sessionId: input.sessionId,
      turnIndex: input.turnIndex,
      latestUserMessage: input.latestUserMessage,
      productProfile: input.productProfile,
      effectiveFilter: latestFilter,
      userMemoryContext: userMemoryContext as Record<string, unknown> | null,
      conversationSummary: latestSummary,
      recentMessages,
      candidateSummary,
      prompt,
      outputSchema,
      profileSchema,
    };
  }

  async getConversationDebug(sessionId: string) {
    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
      include: { profileSnapshot: true },
    });
    if (!session) throw new NotFoundException('SESSION_NOT_FOUND');

    const latestFilter = await this.getLatestFilter(sessionId);
    const category = normalizeProductCategory(
      session.categoryHint ?? latestFilter.categoryScope ?? session.profileSnapshot?.category,
      'general',
    );
    const [messages, summaries, candidateSummary, userMemoryContext] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        where: { sessionId },
        orderBy: [{ turnIndex: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.conversationSummary.findMany({
        where: { sessionId },
        orderBy: [{ coveredTurnIndex: 'desc' }, { createdAt: 'desc' }],
      }),
      this.getCandidateSummary(sessionId, 5),
      session.userId
        ? this.userMemoryContext.getContext(session.userId, category)
        : Promise.resolve(null),
    ]);

    const prompt = this.promptRegistry.getConversationPrompt(category);
    const outputSchema = this.promptRegistry.getFilterOutputSchema();
    const profileSchema = this.profileSchemaRegistry.getProfileSchema(category);

    return {
      session: {
        sessionId: session.id,
        currentTurnIndex: session.currentTurnIndex,
        status: session.status,
        stage: session.stage,
      },
      productProfile: session.profileSnapshot ? this.profileFromSnapshot(session.profileSnapshot) : null,
      effectiveFilter: latestFilter,
      userMemoryContext,
      candidateSummary,
      messages: messages.map((message) =>
        this.contextViewAdapter.toDebugMessage(message),
      ),
      summaries: summaries.map((summary) =>
        this.contextViewAdapter.toDebugSummary(summary),
      ),
      resources: {
        promptVersion: prompt.version,
        profileSchemaVersion: profileSchema.version,
        outputSchemaVersion: outputSchema.version,
      },
    };
  }

  async maybeUpdateSummary(input: {
    sessionId: string;
    turnIndex: number;
    effectiveFilter: EffectiveFilterState;
    promptVersion: string;
    schemaVersion: string;
    outputSchemaVersion: string;
  }) {
    const latestSummary = await this.prisma.conversationSummary.findFirst({
      where: { sessionId: input.sessionId },
      orderBy: [{ coveredTurnIndex: 'desc' }, { createdAt: 'desc' }],
    });
    const coveredTurnIndex = latestSummary?.coveredTurnIndex ?? 0;
    const messages = await this.prisma.conversationMessage.findMany({
      where: {
        sessionId: input.sessionId,
        turnIndex: { gt: coveredTurnIndex },
      },
      orderBy: [{ turnIndex: 'asc' }, { createdAt: 'asc' }],
    });
    if (messages.length === 0) return latestSummary;
    const unsummarizedCharacters = messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    if (input.turnIndex - coveredTurnIndex < 8 && unsummarizedCharacters < 8000) {
      return latestSummary;
    }

    const userMessages = messages
      .filter((message) => message.role === 'user')
      .slice(-6)
      .map((message) => message.content);
    const assistantMessages = messages
      .filter((message) => message.role === 'assistant')
      .slice(-3)
      .map((message) => message.content);
    const summaryText = [
      `Covered turns 1-${input.turnIndex}.`,
      `Effective filter: ${JSON.stringify(input.effectiveFilter)}.`,
      userMessages.length > 0 ? `Recent user intents: ${userMessages.join(' | ')}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    return this.prisma.conversationSummary.create({
      data: {
        id: createId('conv_sum'),
        sessionId: input.sessionId,
        coveredTurnIndex: input.turnIndex,
        summaryText,
        summaryJson: toJsonString({
          effectiveFilter: input.effectiveFilter,
          recentUserMessages: userMessages,
          recentAssistantMessages: assistantMessages,
          promptVersion: input.promptVersion,
          schemaVersion: input.schemaVersion,
          outputSchemaVersion: input.outputSchemaVersion,
        }),
      },
    });
  }

  private async getLatestFilter(sessionId: string): Promise<EffectiveFilterState> {
    const latest = await this.prisma.filterSnapshot.findFirst({
      where: { sessionId },
      orderBy: [{ turnIndex: 'desc' }, { createdAt: 'desc' }],
    });
    return this.filterState.fromSnapshot(latest);
  }

  private async getRecentMessages(sessionId: string, take: number): Promise<ConversationContextMessage[]> {
    const messages = await this.prisma.conversationMessage.findMany({
      where: { sessionId },
      orderBy: [{ turnIndex: 'desc' }, { createdAt: 'desc' }],
      take,
    });
    return messages
      .reverse()
      .map((message) => this.contextViewAdapter.toContextMessage(message));
  }

  private async getLatestSummary(sessionId: string): Promise<ConversationSummaryContext | null> {
    const summary = await this.prisma.conversationSummary.findFirst({
      where: { sessionId },
      orderBy: [{ coveredTurnIndex: 'desc' }, { createdAt: 'desc' }],
    });
    if (!summary) return null;
    return this.contextViewAdapter.toSummaryContext(summary);
  }

  private async getCandidateSummary(
    sessionId: string,
    take: number,
  ): Promise<ConversationCandidateSummaryItem[]> {
    const snapshot = await this.prisma.candidateSnapshot.findFirst({
      where: { sessionId },
      orderBy: [{ turnIndex: 'desc' }, { createdAt: 'desc' }],
      include: { items: true },
    });
    if (!snapshot) return [];
    return snapshot.items
      .sort((a, b) => Number(a.amount) - Number(b.amount))
      .slice(0, take)
      .map((item) => this.contextViewAdapter.toCandidateSummaryItem(item));
  }

  private profileFromSnapshot(
    snapshot: ProductProfileSnapshot,
  ): ProductProfileResult {
    return this.contextViewAdapter.toProductProfile(snapshot);
  }
}
