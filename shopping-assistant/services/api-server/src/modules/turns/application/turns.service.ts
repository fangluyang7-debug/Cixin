import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { CandidateItem } from "@prisma/client";
import { PrismaService } from "../../../persistence/prisma/prisma.service";
import { createId } from "../../../common/utils/id";
import {
  fromJson,
  toJsonArrayString,
  toJsonString,
} from "../../../common/utils/json";
import {
  getProductCategoryDefinition,
  normalizeProductCategory,
  normalizeProductCategoryOrNull,
  productCategoryKeywords,
} from "../../../common/catalog/product-categories";
import {
  displayPlatformLabel,
  extractMentionedPlatforms,
  platformComparisonKey,
} from "../../../common/platforms/platform-normalization";
import {
  extractBrand as extractBrandHeuristic,
  extractColor as extractColorHeuristic,
  extractPriceMax as extractPriceMaxHeuristic,
  extractShoeSize as extractShoeSizeHeuristic,
  extractShoppingFilterPatch,
} from "../../../common/shopping/shopping-filter-heuristics";
import { analyzeShoppingLanguage } from "../../../common/shopping/shopping-language-analyzer";
import { validateShoppingMessage } from "../../../common/shopping/shopping-message-validation";
import {
  ConversationTurnParseInput,
  ConversationTurnParseResult,
  ProductProfileResult,
} from "../../../adapters/model/model-adapter.interface";
import {
  CandidateSeed,
  ProductSearchPipelineMode,
  SEARCH_PROVIDER,
  SearchProvider,
} from "../../../adapters/search-provider/search-provider.interface";
import { FallbackService } from "../../fallback/application/fallback.service";
import { CandidatesService } from "../../candidates/application/candidates.service";
import {
  CANDIDATE_ITEM_ADAPTER,
  CandidateItemAdapter,
} from "../../candidates/application/candidate-item-adapter.interface";
import {
  CANDIDATE_SEARCH_CONTEXT_ADAPTER,
  CandidateSearchContextAdapter,
} from "../../candidates/application/candidate-search-context-adapter.interface";
import { SuggestionsService } from "../../suggestions/application/suggestions.service";
import { ConversationContextService } from "../../conversation/application/conversation-context.service";
import {
  FilterMergeResult,
  FilterStateDiff,
  FilterStateService,
} from "../../conversation/application/filter-state.service";
import {
  SEARCH_QUERY_EMBEDDING_ADAPTER,
  SearchQueryEmbeddingAdapter,
} from "../../product-pool/application/search-query-embedding-adapter.interface";
import { UserMemoryExtractionService } from "../../user-memory/application/user-memory-extraction.service";
import { CreateTurnDto } from "../dto/create-turn.dto";
import {
  CONVERSATION_INTENT_ADAPTER,
  ConversationIntentAdapter,
} from "./conversation-intent-adapter.interface";

interface SearchResult {
  candidates: CandidateSeed[];
  fallback: ReturnType<FallbackService["buildFallbackReason"]> | null;
}

const SNAPSHOT_REFINE_FIELDS = new Set([
  "sortRule",
  "excludedProductIds",
  "excludedCandidateItemIds",
]);

@Injectable()
export class TurnsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONVERSATION_INTENT_ADAPTER)
    private readonly conversationIntentAdapter: ConversationIntentAdapter,
    @Inject(SEARCH_PROVIDER)
    private readonly searchProvider: SearchProvider,
    @Inject(CANDIDATE_ITEM_ADAPTER)
    private readonly candidateItemAdapter: CandidateItemAdapter,
    @Inject(CANDIDATE_SEARCH_CONTEXT_ADAPTER)
    private readonly candidateSearchContextAdapter: CandidateSearchContextAdapter,
    private readonly fallbackService: FallbackService,
    private readonly candidatesService: CandidatesService,
    private readonly suggestionsService: SuggestionsService,
    private readonly conversationContext: ConversationContextService,
    private readonly filterState: FilterStateService,
    @Inject(SEARCH_QUERY_EMBEDDING_ADAPTER)
    private readonly searchQueryEmbeddingAdapter: SearchQueryEmbeddingAdapter,
    private readonly userMemoryExtraction: UserMemoryExtractionService,
    private readonly config: ConfigService,
  ) {}

  async createTurn(sessionId: string, dto: CreateTurnDto) {
    if (!dto || typeof dto !== "object") {
      throw new BadRequestException("TURN_BODY_REQUIRED");
    }
    dto.message = validateShoppingMessage(dto.message, {
      requiredCode: "TURN_MESSAGE_REQUIRED",
      tooLongCode: "TURN_MESSAGE_TOO_LONG",
    });
    this.validateCreateTurnDto(dto);

    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
      include: {
        imageAsset: true,
        profileSnapshot: true,
        queryImagePreprocessSnapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");

    const nextTurnIndex = session.currentTurnIndex + 1;
    const turnId = createId("turn");
    const keywords = this.candidateSearchContextAdapter.toKeywords(
      session.profileSnapshot,
    );
    const profile = this.candidateSearchContextAdapter.toProfile(
      session.profileSnapshot,
    );
    await this.conversationContext.createMessage({
      sessionId,
      turnIndex: nextTurnIndex,
      role: "user",
      content: dto.message,
      metadata: { source: "turn_api" },
    });

    const context = await this.conversationContext.buildContext({
      sessionId,
      turnIndex: nextTurnIndex,
      latestUserMessage: dto.message,
      productProfile: profile,
    });
    const searchRequestMessage = this.resolveTurnSearchMessage(
      dto.message,
      context,
    );
    let parsedTurn = this.forceProductSearchTurn(
      dto.message,
      await this.conversationIntentAdapter.parseTurn(context),
      context,
    );
    parsedTurn = await this.resolvePreviousFilterRestore(sessionId, parsedTurn);
    const currentFilter = this.filterState.normalizeState(
      context.effectiveFilter,
    );
    let stateChangingTurn = this.isStateChangingTurn(parsedTurn);
    let filterMerge = stateChangingTurn
      ? this.filterState.merge(currentFilter, parsedTurn, {
          promptVersion: context.prompt.version,
          schemaVersion: context.profileSchema.version,
          outputSchemaVersion: context.outputSchema.version,
        })
      : null;
    if (filterMerge?.rejectedOperations.length) {
      parsedTurn = {
        ...parsedTurn,
        intent: "ask_clarification",
        filterPatch: {},
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: filterMerge.rejectedOperations[0].message,
        rejectedOperations: filterMerge.rejectedOperations,
      };
      stateChangingTurn = false;
    }

    if (!stateChangingTurn) {
      await this.prisma.$transaction(async (tx) => {
        await tx.sessionTurn.create({
          data: {
            id: turnId,
            sessionId,
            turnIndex: nextTurnIndex,
            message: dto.message,
            parsedFilterJson: toJsonString({
              ...parsedTurn,
              effectiveFilter: currentFilter,
              stateChangingTurn: false,
            }),
          },
        });

        await tx.conversationMessage.create({
          data: {
            id: createId("conv_msg"),
            sessionId,
            turnIndex: nextTurnIndex,
            role: "assistant",
            content: parsedTurn.assistantMessage,
            metadataJson: toJsonString({
              intent: parsedTurn.intent,
              confidence: parsedTurn.confidence,
              promptVersion: context.prompt.version,
              schemaVersion: context.profileSchema.version,
              outputSchemaVersion: context.outputSchema.version,
              stateChangingTurn: false,
            }),
          },
        });

        await tx.querySession.update({
          where: { id: sessionId },
          data: {
            currentTurnIndex: nextTurnIndex,
          },
        });
      });

      const summary = await this.conversationContext.maybeUpdateSummary({
        sessionId,
        turnIndex: nextTurnIndex,
        effectiveFilter: currentFilter,
        promptVersion: context.prompt.version,
        schemaVersion: context.profileSchema.version,
        outputSchemaVersion: context.outputSchema.version,
      });
      const memoryProposals = session.userId
        ? await this.userMemoryExtraction.createProposalsFromTurn({
            userId: session.userId,
            sessionId,
            turnIndex: nextTurnIndex,
            message: dto.message,
          })
        : [];

      const updatedCandidates =
        await this.candidatesService.getCurrentCandidates(sessionId);
      const updatedSuggestions =
        await this.suggestionsService.getSuggestions(sessionId);

      return {
        turn: {
          turnId,
          turnIndex: nextTurnIndex,
          message: dto.message,
          parsedFilter: parsedTurn,
        },
        assistantMessage: parsedTurn.assistantMessage,
        effectiveFilter: currentFilter,
        filterDiff: filterMerge?.filterDiff ?? null,
        profileDiff: null,
        filterSources: filterMerge?.filterSources ?? {},
        rejectedOperations:
          parsedTurn.rejectedOperations ??
          filterMerge?.rejectedOperations ??
          [],
        conversationState: {
          promptVersion: context.prompt.version,
          schemaVersion: context.profileSchema.version,
          outputSchemaVersion: context.outputSchema.version,
          summaryCoveredTurnIndex: summary?.coveredTurnIndex ?? null,
          recentMessageCount: context.recentMessages.length,
          userMemoryContextIncluded:
            context.userMemoryContext !== null &&
            context.userMemoryContext !== undefined,
          stateChangingTurn: false,
        },
        memoryProposals: {
          createdCount: memoryProposals.length,
          items: memoryProposals,
        },
        session: {
          sessionId,
          status: session.status,
          stage: session.stage,
          degraded: session.degraded,
        },
        candidates: updatedCandidates,
        suggestions: updatedSuggestions,
        fallback: null,
      };
    }

    filterMerge ??= this.filterState.merge(currentFilter, parsedTurn, {
      promptVersion: context.prompt.version,
      schemaVersion: context.profileSchema.version,
      outputSchemaVersion: context.outputSchema.version,
    });
    this.applyExplicitTurnFilters(filterMerge, dto.filters);
    if (this.isSnapshotRefineTurn(parsedTurn)) {
      const snapshotRefineResult = await this.createSnapshotRefineTurn({
        sessionId,
        nextTurnIndex,
        turnId,
        message: dto.message,
        session,
        context,
        parsedTurn,
        filterMerge,
      });
      if (snapshotRefineResult) return snapshotRefineResult;
    }
    const latestPreprocess = session.queryImagePreprocessSnapshots[0] ?? null;
    const sessionAssetIsText = this.isTextQueryAsset(session.imageAsset);
    this.applyCategoryChangeToFilter(
      filterMerge.effectiveFilter,
      searchRequestMessage,
      profile,
    );
    const searchProfile = this.buildTurnSearchProfile(
      profile,
      searchRequestMessage,
      filterMerge.effectiveFilter,
      parsedTurn,
    );
    const profileDiff = this.buildProfileDiff(profile, searchProfile);
    const searchKeywords = this.buildTurnKeywords(
      searchRequestMessage,
      keywords,
      searchProfile,
    );
    filterMerge.effectiveFilter.categoryScope = searchProfile.category;
    Object.assign(filterMerge.rawJson, filterMerge.effectiveFilter);
    const latestPreprocessIsText =
      this.isTextQueryPreprocessSnapshot(latestPreprocess) ||
      sessionAssetIsText;
    const canReuseExistingQueryEmbedding =
      !profile || normalizeProductCategory(profile.category) === searchProfile.category;
    const existingQueryEmbedding = canReuseExistingQueryEmbedding
      ? this.candidateSearchContextAdapter.toQueryEmbedding(latestPreprocess)
      : [];
    const generatedQueryEmbedding =
      existingQueryEmbedding.length > 0
        ? []
        : await this.searchQueryEmbeddingAdapter.buildQueryEmbedding({
            keywords: searchKeywords,
            profile: searchProfile,
            queryImageUrl: null,
          });
    const queryEmbedding =
      existingQueryEmbedding.length > 0
        ? existingQueryEmbedding
        : generatedQueryEmbedding;
    const searchResult = await this.searchShoesWithFallback({
      keywords: searchKeywords,
      filters: filterMerge.effectiveFilter,
      profile: searchProfile,
      assetId: latestPreprocessIsText ? undefined : session.assetId,
      queryEmbedding: queryEmbedding.length > 0 ? queryEmbedding : undefined,
      embeddingKind:
        existingQueryEmbedding.length > 0
          ? latestPreprocessIsText
            ? "multimodal"
            : "visual"
          : undefined,
    });
    const { candidates, fallback } = searchResult;
    const assistantMessage = this.buildPostSearchAssistantMessage({
      message: searchRequestMessage,
      parsedTurn,
      candidates,
      fallback,
      effectiveFilter: filterMerge.effectiveFilter,
      filterDiff: filterMerge.filterDiff,
      profileDiff,
    });
    const finalParsedTurn = {
      ...parsedTurn,
      assistantMessage,
      filterDiff: filterMerge.filterDiff,
      profileDiff,
      rejectedOperations: filterMerge.rejectedOperations,
    };
    const candidateSnapshotId = createId("cand_snap");
    let preprocessSnapshotId = canReuseExistingQueryEmbedding
      ? (latestPreprocess?.id ?? null)
      : null;

    await this.prisma.$transaction(async (tx) => {
      if (!preprocessSnapshotId && queryEmbedding.length > 0) {
        preprocessSnapshotId = createId("query_pre");
        await tx.queryImagePreprocessSnapshot.create({
          data: {
            id: preprocessSnapshotId,
            sessionId,
            assetId: session.assetId,
            selectedBoxJson: "{}",
            detectedBoxesJson: "[]",
            selectionSource: "text_turn",
            status: "ready",
            embeddingProvider: "search_query_adapter",
            embeddingModel: "text_query_turn",
            embeddingDimension: queryEmbedding.length,
            embeddingVectorHash: this.hashVector(queryEmbedding),
            embeddingVectorJson: toJsonString(queryEmbedding),
            cropImageRefJson: "{}",
            rawJson: toJsonString({
              source: "turn_text_query",
              message: dto.message,
              keywords: searchKeywords,
              profile: searchProfile,
            }),
          },
        });
      }

      await tx.sessionTurn.create({
        data: {
          id: turnId,
          sessionId,
          turnIndex: nextTurnIndex,
          message: dto.message,
          parsedFilterJson: toJsonString({
            ...finalParsedTurn,
            effectiveFilter: filterMerge.effectiveFilter,
          }),
        },
      });

      await tx.filterSnapshot.create({
        data: {
          id: createId("filter_snap"),
          ...this.filterState.toSnapshotData({
            sessionId,
            turnIndex: nextTurnIndex,
            effectiveFilter: filterMerge.effectiveFilter,
            rawJson: filterMerge.rawJson,
          }),
        },
      });

      await tx.candidateSnapshot.create({
        data: {
          id: candidateSnapshotId,
          sessionId,
          turnIndex: nextTurnIndex,
          degraded: fallback !== null,
          appliedFilterJson: toJsonString({
            ...filterMerge.rawJson,
            fallbackReason: fallback?.reason ?? null,
          }),
          items: {
            create: candidates.map((item, index) =>
              this.candidateItemAdapter.toCandidateItemData({
                item,
                rank: index + 1,
                pageIndex: Math.floor(index / this.initialReturnLimit()),
              }),
            ),
          },
        },
      });

      await tx.conversationMessage.create({
        data: {
          id: createId("conv_msg"),
          sessionId,
          turnIndex: nextTurnIndex,
          role: "assistant",
          content: assistantMessage,
          metadataJson: toJsonString({
            intent: parsedTurn.intent,
            confidence: parsedTurn.confidence,
            promptVersion: context.prompt.version,
            schemaVersion: context.profileSchema.version,
            outputSchemaVersion: context.outputSchema.version,
            droppedFields: filterMerge.droppedFields,
            fallbackReason: fallback?.reason ?? null,
          }),
        },
      });

      await tx.querySession.update({
        where: { id: sessionId },
        data: {
          currentTurnIndex: nextTurnIndex,
          status: fallback ? "degraded_ready" : "ready",
          stage: "candidate_ready",
          categoryHint: searchProfile.category,
          degraded: fallback !== null,
        },
      });
      await tx.productProfileSnapshot.upsert({
        where: { sessionId },
        create: {
          id: createId("profile_snap"),
          sessionId,
          category: searchProfile.category,
          brand: searchProfile.brand,
          size: searchProfile.size,
          color: searchProfile.color,
          keywordsJson: toJsonArrayString(searchProfile.keywords),
          styleTagsJson: toJsonArrayString(searchProfile.styleTags),
          sceneTagsJson: toJsonArrayString(searchProfile.sceneTags),
          confidence: searchProfile.confidence,
          rawJson: toJsonString({
            ...searchProfile.raw,
            modelLine: searchProfile.modelLine ?? null,
            colorFamily: searchProfile.colorFamily ?? null,
            colorway: searchProfile.colorway ?? null,
            shoeType: searchProfile.shoeType ?? null,
          }),
        },
        update: {
          category: searchProfile.category,
          brand: searchProfile.brand,
          size: searchProfile.size,
          color: searchProfile.color,
          keywordsJson: toJsonArrayString(searchProfile.keywords),
          styleTagsJson: toJsonArrayString(searchProfile.styleTags),
          sceneTagsJson: toJsonArrayString(searchProfile.sceneTags),
          confidence: searchProfile.confidence,
          rawJson: toJsonString({
            ...searchProfile.raw,
            modelLine: searchProfile.modelLine ?? null,
            colorFamily: searchProfile.colorFamily ?? null,
            colorway: searchProfile.colorway ?? null,
            shoeType: searchProfile.shoeType ?? null,
          }),
        },
      });

      if (fallback) {
        await tx.fallbackSnapshot.create({
          data: {
            id: createId("fallback_snap"),
            sessionId,
            reason: fallback.reason,
            payloadJson: toJsonString(fallback),
          },
        });
      }
    });

    if (preprocessSnapshotId) {
      await this.candidatesService.createPaginationCursorForSnapshot({
        sessionId,
        candidateSnapshotId,
        preprocessSnapshotId,
        filter: filterMerge.rawJson,
        offset: this.initialConsumedOffset(candidates.length),
        limit: this.initialReturnLimit(),
        totalCandidates: candidates.length,
        fallbackSearchAllowed: this.searchMoreFallbackAllowed(queryEmbedding),
        sortRule: this.toString(filterMerge.effectiveFilter.sortRule),
      });
    }

    const summary = await this.conversationContext.maybeUpdateSummary({
      sessionId,
      turnIndex: nextTurnIndex,
      effectiveFilter: filterMerge.effectiveFilter,
      promptVersion: context.prompt.version,
      schemaVersion: context.profileSchema.version,
      outputSchemaVersion: context.outputSchema.version,
    });
    const memoryProposals = session.userId
      ? await this.userMemoryExtraction.createProposalsFromTurn({
          userId: session.userId,
          sessionId,
          turnIndex: nextTurnIndex,
          message: dto.message,
        })
      : [];

    const updatedCandidates =
      await this.candidatesService.getCurrentCandidates(sessionId);
    const updatedSuggestions =
      await this.suggestionsService.getSuggestions(sessionId);

    return {
      turn: {
        turnId,
        turnIndex: nextTurnIndex,
        message: dto.message,
        parsedFilter: finalParsedTurn,
      },
      assistantMessage,
      effectiveFilter: filterMerge.effectiveFilter,
      filterDiff: filterMerge.filterDiff,
      profileDiff,
      filterSources: filterMerge.filterSources,
      rejectedOperations: filterMerge.rejectedOperations,
      conversationState: {
        promptVersion: context.prompt.version,
        schemaVersion: context.profileSchema.version,
        outputSchemaVersion: context.outputSchema.version,
        summaryCoveredTurnIndex: summary?.coveredTurnIndex ?? null,
        recentMessageCount: context.recentMessages.length,
        userMemoryContextIncluded:
          context.userMemoryContext !== null &&
          context.userMemoryContext !== undefined,
        stateChangingTurn: true,
      },
      memoryProposals: {
        createdCount: memoryProposals.length,
        items: memoryProposals,
      },
      session: {
        sessionId,
        status: fallback ? "degraded_ready" : "ready",
        stage: "candidate_ready",
        degraded: fallback !== null,
      },
      candidates: updatedCandidates,
      suggestions: updatedSuggestions,
      fallback,
    };
  }

  private isStateChangingTurn(parsedTurn: {
    intent: string;
    filterPatch?: Record<string, unknown>;
    filterRemove?: string[];
    shouldResetPreviousFilters?: boolean;
  }) {
    if (
      parsedTurn.intent === "refine_filter" ||
      parsedTurn.intent === "reset_filter"
    ) {
      return true;
    }
    if (parsedTurn.shouldResetPreviousFilters === true) return true;
    if (Object.keys(parsedTurn.filterPatch ?? {}).length > 0) return true;
    return (parsedTurn.filterRemove ?? []).length > 0;
  }

  private applyExplicitTurnFilters(
    filterMerge: FilterMergeResult,
    filters?: Record<string, unknown>,
  ) {
    const mode = this.toSearchPipelineMode(filters?.searchPipelineMode);
    if (!mode) return;
    filterMerge.effectiveFilter.searchPipelineMode = mode;
    filterMerge.rawJson.searchPipelineMode = mode;
  }

  private toSearchPipelineMode(
    value: unknown,
  ): ProductSearchPipelineMode | null {
    const mode = this.toString(value);
    if (mode === "current_ann_then_refine" || mode === "light_tag_ann_fusion") {
      return mode;
    }
    return null;
  }

  private isSnapshotOnlySortTurn(parsedTurn: {
    filterPatch?: Record<string, unknown>;
    filterRemove?: string[];
    shouldResetPreviousFilters?: boolean;
  }) {
    if (parsedTurn.shouldResetPreviousFilters === true) return false;
    if ((parsedTurn.filterRemove ?? []).length > 0) return false;
    const patchKeys = Object.keys(parsedTurn.filterPatch ?? {});
    return patchKeys.length === 1 && patchKeys[0] === "sortRule";
  }

  private isSnapshotRefineTurn(parsedTurn: {
    filterPatch?: Record<string, unknown>;
    filterRemove?: string[];
    shouldResetPreviousFilters?: boolean;
  }) {
    if (parsedTurn.shouldResetPreviousFilters === true) return false;
    if ((parsedTurn.filterRemove ?? []).length > 0) return false;
    const patchKeys = Object.keys(parsedTurn.filterPatch ?? {});
    return (
      patchKeys.length > 0 &&
      patchKeys.every((field) => SNAPSHOT_REFINE_FIELDS.has(field))
    );
  }

  private async createSnapshotRefineTurn(input: {
    sessionId: string;
    nextTurnIndex: number;
    turnId: string;
    message: string;
    session: {
      status: string;
      stage: string;
      degraded: boolean;
      userId: string | null;
      queryImagePreprocessSnapshots: Array<{
        id: string;
        status: string;
        embeddingVectorJson: string;
      }>;
    };
    context: Awaited<ReturnType<ConversationContextService["buildContext"]>>;
    parsedTurn: ConversationTurnParseResult;
    filterMerge: FilterMergeResult;
  }) {
    const sourceSnapshot = await this.prisma.candidateSnapshot.findFirst({
      where: { sessionId: input.sessionId },
      orderBy: { createdAt: "desc" },
      include: { items: { orderBy: [{ rank: "asc" }, { amount: "asc" }] } },
    });
    if (!sourceSnapshot || sourceSnapshot.items.length === 0) return null;

    const sourceCursor = await this.prisma.candidatePaginationCursor.findFirst({
      where: {
        candidateSnapshotId: sourceSnapshot.id,
        expiresAt: { gt: new Date() },
      },
      orderBy: { updatedAt: "desc" },
    });
    const previousConsumedCount = Math.min(
      Math.max(
        sourceCursor?.offset ?? this.initialReturnLimit(),
        this.initialReturnLimit(),
      ),
      sourceSnapshot.items.length,
    );
    const sortRule =
      this.toString(input.filterMerge.effectiveFilter.sortRule) ??
      "relevance_desc";
    const filteredItems = this.filterSnapshotItems(
      sourceSnapshot.items,
      input.filterMerge.effectiveFilter,
    );
    const sortedItems = this.isSnapshotOnlySortTurn(input.parsedTurn)
      ? [
          ...this.sortSnapshotItems(
            filteredItems.slice(0, previousConsumedCount),
            sortRule,
          ),
          ...filteredItems.slice(previousConsumedCount),
        ]
      : this.sortSnapshotItems(filteredItems, sortRule);
    const consumedOffset = this.isSnapshotOnlySortTurn(input.parsedTurn)
      ? Math.min(previousConsumedCount, sortedItems.length)
      : this.initialConsumedOffset(sortedItems.length);
    const candidateSnapshotId = createId("cand_snap");
    const assistantMessage =
      sortedItems.length === 0
        ? "已按你的要求更新筛选，但当前条件下暂时没有找到合适商品。你可以放宽预算、平台或颜色条件试试。"
        : (this.buildRefineResultMessage(
            input.parsedTurn.filterPatch ?? {},
            input.filterMerge.effectiveFilter,
            sortedItems.length,
          ) ?? `好的，已在当前 ${sortedItems.length} 个候选商品内完成筛选。`);
    const finalParsedTurn = {
      ...input.parsedTurn,
      assistantMessage,
      filterDiff: input.filterMerge.filterDiff,
      profileDiff: null,
      rejectedOperations: input.filterMerge.rejectedOperations,
    };
    const preprocess = input.session.queryImagePreprocessSnapshots[0] ?? null;
    const queryEmbedding =
      this.candidateSearchContextAdapter.toQueryEmbedding(preprocess);

    await this.prisma.$transaction(async (tx) => {
      await tx.sessionTurn.create({
        data: {
          id: input.turnId,
          sessionId: input.sessionId,
          turnIndex: input.nextTurnIndex,
          message: input.message,
          parsedFilterJson: toJsonString({
            ...finalParsedTurn,
            effectiveFilter: input.filterMerge.effectiveFilter,
            stateChangingTurn: true,
            snapshotRefine: true,
            snapshotOnlySort: this.isSnapshotOnlySortTurn(input.parsedTurn),
          }),
        },
      });

      await tx.filterSnapshot.create({
        data: {
          id: createId("filter_snap"),
          ...this.filterState.toSnapshotData({
            sessionId: input.sessionId,
            turnIndex: input.nextTurnIndex,
            effectiveFilter: input.filterMerge.effectiveFilter,
            rawJson: input.filterMerge.rawJson,
          }),
        },
      });

      await tx.candidateSnapshot.create({
        data: {
          id: candidateSnapshotId,
          sessionId: input.sessionId,
          turnIndex: input.nextTurnIndex,
          degraded: sourceSnapshot.degraded,
          appliedFilterJson: toJsonString({
            ...input.filterMerge.rawJson,
            snapshotRefine: true,
            snapshotOnlySort: this.isSnapshotOnlySortTurn(input.parsedTurn),
            sourceCandidateSnapshotId: sourceSnapshot.id,
          }),
          items: {
            create: sortedItems.map((item, index) =>
              this.cloneCandidateItemForSnapshot(
                item,
                index + 1,
                Math.floor(index / this.initialReturnLimit()),
              ),
            ),
          },
        },
      });

      await tx.conversationMessage.create({
        data: {
          id: createId("conv_msg"),
          sessionId: input.sessionId,
          turnIndex: input.nextTurnIndex,
          role: "assistant",
          content: assistantMessage,
          metadataJson: toJsonString({
            intent: input.parsedTurn.intent,
            confidence: input.parsedTurn.confidence,
            promptVersion: input.context.prompt.version,
            schemaVersion: input.context.profileSchema.version,
            outputSchemaVersion: input.context.outputSchema.version,
            droppedFields: input.filterMerge.droppedFields,
            stateChangingTurn: true,
            snapshotRefine: true,
            snapshotOnlySort: this.isSnapshotOnlySortTurn(input.parsedTurn),
          }),
        },
      });

      await tx.querySession.update({
        where: { id: input.sessionId },
        data: {
          currentTurnIndex: input.nextTurnIndex,
          status: sourceSnapshot.degraded ? "degraded_ready" : "ready",
          stage: "candidate_ready",
          degraded: sourceSnapshot.degraded,
        },
      });
    });

    await this.candidatesService.createPaginationCursorForSnapshot({
      sessionId: input.sessionId,
      candidateSnapshotId,
      preprocessSnapshotId: preprocess?.id ?? null,
      filter: input.filterMerge.rawJson,
      offset: consumedOffset,
      limit: sourceCursor?.limit ?? this.initialReturnLimit(),
      totalCandidates: sortedItems.length,
      fallbackSearchAllowed: this.searchMoreFallbackAllowed(queryEmbedding),
      sortRule,
    });

    const summary = await this.conversationContext.maybeUpdateSummary({
      sessionId: input.sessionId,
      turnIndex: input.nextTurnIndex,
      effectiveFilter: input.filterMerge.effectiveFilter,
      promptVersion: input.context.prompt.version,
      schemaVersion: input.context.profileSchema.version,
      outputSchemaVersion: input.context.outputSchema.version,
    });
    const memoryProposals = input.session.userId
      ? await this.userMemoryExtraction.createProposalsFromTurn({
          userId: input.session.userId,
          sessionId: input.sessionId,
          turnIndex: input.nextTurnIndex,
          message: input.message,
        })
      : [];
    const updatedCandidates = await this.candidatesService.getCurrentCandidates(
      input.sessionId,
    );
    const updatedSuggestions = await this.suggestionsService.getSuggestions(
      input.sessionId,
    );

    return {
      turn: {
        turnId: input.turnId,
        turnIndex: input.nextTurnIndex,
        message: input.message,
        parsedFilter: finalParsedTurn,
      },
      assistantMessage,
      effectiveFilter: input.filterMerge.effectiveFilter,
      filterDiff: input.filterMerge.filterDiff,
      profileDiff: null,
      filterSources: input.filterMerge.filterSources,
      rejectedOperations: input.filterMerge.rejectedOperations,
      conversationState: {
        promptVersion: input.context.prompt.version,
        schemaVersion: input.context.profileSchema.version,
        outputSchemaVersion: input.context.outputSchema.version,
        summaryCoveredTurnIndex: summary?.coveredTurnIndex ?? null,
        recentMessageCount: input.context.recentMessages.length,
        userMemoryContextIncluded:
          input.context.userMemoryContext !== null &&
          input.context.userMemoryContext !== undefined,
        stateChangingTurn: true,
        snapshotOnlySort: this.isSnapshotOnlySortTurn(input.parsedTurn),
      },
      memoryProposals: {
        createdCount: memoryProposals.length,
        items: memoryProposals,
      },
      session: {
        sessionId: input.sessionId,
        status: sourceSnapshot.degraded ? "degraded_ready" : "ready",
        stage: "candidate_ready",
        degraded: sourceSnapshot.degraded,
      },
      candidates: updatedCandidates,
      suggestions: updatedSuggestions,
      fallback: null,
    };
  }

  private cloneCandidateItemForSnapshot(
    item: CandidateItem,
    rank: number,
    pageIndex: number,
  ) {
    return {
      id: createId("item"),
      title: item.title,
      platformName: item.platformName,
      amount: item.amount,
      currency: item.currency,
      shopName: item.shopName,
      shopType: item.shopType,
      stockStatus: item.stockStatus,
      coverImageUrl: item.coverImageUrl,
      productUrl: item.productUrl,
      matchSummaryJson: item.matchSummaryJson,
      normalizedAttributesJson: item.normalizedAttributesJson,
      rawPayloadJson: item.rawPayloadJson,
      recommendationReasonJson: item.recommendationReasonJson,
      rank,
      pageIndex,
      productPoolKey: item.productPoolKey,
    };
  }

  private filterSnapshotItems(
    items: CandidateItem[],
    filters: Record<string, unknown>,
  ) {
    const priceMin = this.toNumber(filters.priceMin);
    const priceMax = this.toNumber(filters.priceMax);
    const platformsInclude = new Set(
      this.toStringArray(filters.platformsInclude)
        .map((platform) => platformComparisonKey(platform))
        .filter((platform): platform is string => platform !== null),
    );
    const platformsExclude = new Set(
      this.toStringArray(filters.platformsExclude)
        .map((platform) => platformComparisonKey(platform))
        .filter((platform): platform is string => platform !== null),
    );
    const legacyPlatform = platformComparisonKey(filters.platform);
    if (legacyPlatform && platformsInclude.size === 0) {
      platformsInclude.add(legacyPlatform);
    }
    const excludedProductIds = new Set(
      this.toStringArray(filters.excludedProductIds),
    );
    const excludedCandidateItemIds = new Set(
      this.toStringArray(filters.excludedCandidateItemIds),
    );
    const stockOnly = filters.stockOnly === true;
    const freeShippingOnly = filters.freeShippingOnly === true;
    const shopType = this.toString(filters.shopType);
    const color = this.toString(filters.color);
    const size = this.toString(filters.size);

    return items.filter((item) => {
      const productId = this.itemProductId(item);
      if (excludedCandidateItemIds.has(item.id)) return false;
      if (productId && excludedProductIds.has(productId)) return false;

      const price = this.itemPrice(item);
      if (priceMin !== null && price < priceMin) return false;
      if (priceMax !== null && price > priceMax) return false;

      const platform = platformComparisonKey(item.platformName);
      if (platformsInclude.size > 0 && (!platform || !platformsInclude.has(platform))) {
        return false;
      }
      if (platform && platformsExclude.has(platform)) return false;

      if (stockOnly && item.stockStatus !== "in_stock") return false;
      if (shopType && item.shopType !== shopType) return false;
      if (freeShippingOnly && !this.itemHasFreeShipping(item)) return false;
      if (color && !this.itemMatchesColor(item, color)) return false;
      if (size && !this.itemMatchesSize(item, size)) return false;
      return true;
    });
  }

  private sortSnapshotItems(items: CandidateItem[], sortRule: string) {
    return [...items].sort((left, right) => {
      if (sortRule === "price_asc") {
        return this.compareSnapshotItemsByPrice(left, right, "asc");
      }
      if (sortRule === "price_desc") {
        return this.compareSnapshotItemsByPrice(left, right, "desc");
      }
      if (sortRule === "rating_desc") {
        return this.compareSnapshotItemsByRating(left, right);
      }
      if (sortRule === "delivery_asc") {
        return this.compareSnapshotItemsByDelivery(left, right);
      }
      return this.compareSnapshotItemsByMatchScore(left, right);
    });
  }

  private compareSnapshotItemsByPrice(
    left: CandidateItem,
    right: CandidateItem,
    direction: "asc" | "desc",
  ) {
    const priceDelta = this.itemPrice(left) - this.itemPrice(right);
    if (Number.isFinite(priceDelta) && priceDelta !== 0) {
      return direction === "asc" ? priceDelta : -priceDelta;
    }
    return this.compareSnapshotItemsByMatchScore(left, right);
  }

  private compareSnapshotItemsByMatchScore(
    left: CandidateItem,
    right: CandidateItem,
  ) {
    const scoreDelta =
      this.itemMatchSortScore(right) - this.itemMatchSortScore(left);
    if (scoreDelta !== 0) return scoreDelta;

    const annDelta = this.itemAnnScore(right) - this.itemAnnScore(left);
    if (annDelta !== 0) return annDelta;

    const tagDelta =
      this.itemTagMatchScore(right) - this.itemTagMatchScore(left);
    if (tagDelta !== 0) return tagDelta;

    const visualDelta =
      this.itemVisualMatchConfidence(right) -
      this.itemVisualMatchConfidence(left);
    if (visualDelta !== 0) return visualDelta;

    return (left.rank ?? 0) - (right.rank ?? 0);
  }

  private compareSnapshotItemsByRating(
    left: CandidateItem,
    right: CandidateItem,
  ) {
    const ratingDelta =
      this.itemRatingScore(right) - this.itemRatingScore(left);
    if (Number.isFinite(ratingDelta) && ratingDelta !== 0) return ratingDelta;
    return this.compareSnapshotItemsByMatchScore(left, right);
  }

  private compareSnapshotItemsByDelivery(
    left: CandidateItem,
    right: CandidateItem,
  ) {
    const deliveryDelta =
      this.itemDeliveryDays(left) - this.itemDeliveryDays(right);
    if (Number.isFinite(deliveryDelta) && deliveryDelta !== 0)
      return deliveryDelta;
    return this.compareSnapshotItemsByMatchScore(left, right);
  }

  private itemMatchSortScore(item: CandidateItem) {
    const score =
      this.itemAnnScore(item) * 0.55 +
      this.itemTagMatchScore(item) * 0.35 +
      this.itemVisualMatchConfidence(item) * 0.1;
    return Number(
      Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0)).toFixed(6),
    );
  }

  private itemAnnScore(item: CandidateItem) {
    const summary = this.itemMatchSummary(item);
    return this.toNumber(summary.annScore) ?? 0;
  }

  private itemTagMatchScore(item: CandidateItem) {
    const summary = this.itemMatchSummary(item);
    return this.toNumber(summary.tagMatchScore) ?? 0;
  }

  private itemVisualMatchConfidence(item: CandidateItem) {
    const summary = this.itemMatchSummary(item);
    return this.toNumber(summary.visualMatchConfidence) ?? 0;
  }

  private itemMatchSummary(item: CandidateItem) {
    return fromJson<Record<string, unknown>>(item.matchSummaryJson, {});
  }

  private itemPrice(item: CandidateItem) {
    const price = Number(item.amount);
    return Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
  }

  private itemRatingScore(item: CandidateItem) {
    const rawPayload = this.itemProductRawPayload(item);
    const shop = this.asRecord(rawPayload.shop);
    const ratings = this.asRecord(shop.ratings);
    return this.toNumber(ratings.overall) ?? 0;
  }

  private itemDeliveryDays(item: CandidateItem) {
    const rawPayload = this.itemProductRawPayload(item);
    const fulfillment = this.asRecord(rawPayload.fulfillment);
    const text = [
      this.toString(fulfillment.deliveryTimeText),
      this.toString(fulfillment.shipTimeText),
      ...this.toStringArray(fulfillment.serviceLabels),
    ]
      .filter(Boolean)
      .join(" ");
    if (!text) return 99;
    if (/明日|次日|24\s*小时|24小时/.test(text)) return 1;
    const match = text.match(/(\d+)\s*天/);
    return match ? Number(match[1]) : 99;
  }

  private itemProductRawPayload(item: CandidateItem) {
    const raw = fromJson<Record<string, unknown>>(item.rawPayloadJson, {});
    const productRawPayload = this.asRecord(raw.productRawPayload);
    return Object.keys(productRawPayload).length > 0 ? productRawPayload : raw;
  }

  private itemNormalizedAttributes(item: CandidateItem) {
    return fromJson<Record<string, unknown>>(item.normalizedAttributesJson, {});
  }

  private itemProductId(item: CandidateItem) {
    const normalized = this.itemNormalizedAttributes(item);
    const productId = this.toString(normalized.productId);
    if (productId) return productId;
    const raw = fromJson<Record<string, unknown>>(item.rawPayloadJson, {});
    const source = this.asRecord(raw.productPoolSource);
    const sourceProductId = this.toString(source.productId);
    if (sourceProductId) return sourceProductId;
    return item.productPoolKey?.split(":")[0] ?? null;
  }

  private itemHasFreeShipping(item: CandidateItem) {
    const rawPayload = this.itemProductRawPayload(item);
    const fulfillment = this.asRecord(rawPayload.fulfillment);
    return fulfillment.freeShipping === true;
  }

  private itemMatchesColor(item: CandidateItem, color: string) {
    const normalized = this.normalizeComparableText(color);
    if (!normalized) return true;
    const attributes = this.itemNormalizedAttributes(item);
    const rawPayload = this.itemProductRawPayload(item);
    const rawAttributes = this.asRecord(rawPayload.attributes);
    const haystack = [
      attributes.colorFamily,
      attributes.colorway,
      rawAttributes.colorFamily,
      rawAttributes.colorway,
      rawAttributes.color,
      item.title,
    ]
      .map((value) => this.normalizeComparableText(value))
      .filter(Boolean)
      .join(" ");
    return haystack.includes(normalized);
  }

  private itemMatchesSize(item: CandidateItem, size: string) {
    const normalized = this.normalizeSize(size);
    if (!normalized) return true;
    const attributes = this.itemNormalizedAttributes(item);
    const rawPayload = this.itemProductRawPayload(item);
    const rawAttributes = this.asRecord(rawPayload.attributes);
    const skuOptions = this.asRecord(rawPayload.skuOptions);
    const skuOptionSizes = Array.isArray(skuOptions.sizes)
      ? skuOptions.sizes
          .map((item) =>
            typeof item === "string"
              ? item
              : this.toString(this.asRecord(item).value),
          )
          .filter((item): item is string => Boolean(item))
      : [];
    const sizes = [
      ...this.toStringArray(attributes.availableSizes),
      ...this.toStringArray(rawAttributes.availableSizes),
      ...skuOptionSizes,
    ];
    if (sizes.length === 0) return true;
    return sizes.some((itemSize) => this.normalizeSize(itemSize) === normalized);
  }

  private normalizeComparableText(value: unknown) {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim().toLowerCase().replace(/\s+/g, "")
          .replace(/[_-]+/g, "")
      : null;
  }

  private normalizeSize(value: unknown) {
    const text = this.toString(value);
    if (!text) return null;
    const match = /\d{2}(?:\.5)?/.exec(text);
    return match?.[0] ?? text.trim();
  }

  private toNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private validateCreateTurnDto(dto: CreateTurnDto) {
    if (!dto || typeof dto !== "object") {
      throw new BadRequestException("TURN_BODY_REQUIRED");
    }

    if (
      !dto.message ||
      typeof dto.message !== "string" ||
      dto.message.trim().length === 0
    ) {
      throw new BadRequestException("TURN_MESSAGE_REQUIRED");
    }
  }

  private async searchShoesWithFallback(input: {
    keywords: string[];
    filters?: Record<string, unknown>;
    profile?: ProductProfileResult | null;
    assetId?: string;
    queryEmbedding?: number[];
    embeddingKind?: "visual" | "multimodal";
    limit?: number;
  }): Promise<SearchResult> {
    try {
      const limit = input.limit ?? this.searchPrefetchLimit();
      const mode = this.toSearchPipelineMode(input.filters?.searchPipelineMode);
      const candidates =
        mode === "current_ann_then_refine" &&
        input.assetId &&
        input.queryEmbedding?.length &&
        this.searchProvider.searchFastAnnShoes
          ? await this.searchProvider.searchFastAnnShoes({
              keywords: input.keywords,
              filters: input.filters,
              profile: input.profile ?? null,
              queryEmbedding: input.queryEmbedding,
              assetId: input.assetId,
              embeddingKind: "visual",
              limit,
            })
          : await this.searchProvider.searchShoes({
              ...input,
              limit,
            });
      if (candidates.length > 0) {
        return { candidates, fallback: null };
      }

      const fallback = this.fallbackService.buildFallbackReason(
        "NO_CANDIDATES_AFTER_FILTER",
      );
      return {
        candidates: [],
        fallback,
      };
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new InternalServerErrorException("SEARCH_PROVIDER_UNAVAILABLE");
    }
  }

  private toString(value: unknown) {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  }

  private initialReturnLimit() {
    const configured =
      this.config.get<number>("search.initialReturnLimit") ?? 30;
    return this.normalizePositiveLimit(configured, 30);
  }

  private searchPrefetchLimit() {
    const configured = this.config.get<number>("search.prefetchLimit") ?? 120;
    return this.normalizePositiveLimit(configured, 120);
  }

  private initialConsumedOffset(candidateCount: number) {
    return Math.min(this.initialReturnLimit(), candidateCount);
  }

  private searchMoreFallbackAllowed(queryEmbedding?: number[] | null) {
    return Boolean(
      this.searchProvider.searchMoreShoes &&
      queryEmbedding &&
      queryEmbedding.length > 0,
    );
  }

  private async resolvePreviousFilterRestore(
    sessionId: string,
    parsedTurn: ConversationTurnParseResult,
  ): Promise<ConversationTurnParseResult> {
    if (parsedTurn.raw?.restorePreviousFilter !== true) return parsedTurn;
    const snapshots = await this.prisma.filterSnapshot.findMany({
      where: { sessionId },
      orderBy: [{ turnIndex: "desc" }, { createdAt: "desc" }],
      take: 2,
    });
    const previous = snapshots[1];
    if (!previous) {
      return {
        ...parsedTurn,
        intent: "ask_clarification",
        filterPatch: {},
        filterRemove: [],
        shouldResetPreviousFilters: false,
        assistantMessage: "当前还没有可恢复的上一轮筛选条件。",
        rejectedOperations: [
          {
            field: "filterState",
            code: "PREVIOUS_FILTER_NOT_AVAILABLE",
            message: "当前还没有可恢复的上一轮筛选条件。",
          },
        ],
      };
    }
    const restored = this.filterState.fromSnapshot(previous);
    const { searchPipelineMode: _mode, ...filterPatch } = restored;
    return {
      ...parsedTurn,
      filterPatch,
      shouldResetPreviousFilters: true,
      assistantMessage: "正在恢复上一轮筛选条件。",
      raw: {
        ...parsedTurn.raw,
        restoredFilterSnapshotId: previous.id,
        restoredTurnIndex: previous.turnIndex,
      },
    };
  }

  private isTextQueryPreprocessSnapshot(
    preprocess: { selectionSource?: string | null } | null | undefined,
  ) {
    return (
      preprocess?.selectionSource === "text_query" ||
      preprocess?.selectionSource === "text_turn"
    );
  }

  private isTextQueryAsset(
    asset: { sourceType?: string | null } | null | undefined,
  ) {
    return asset?.sourceType === "text_query";
  }

  private normalizePositiveLimit(value: unknown, fallback: number) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  private forceProductSearchTurn(
    message: string,
    parsedTurn: ConversationTurnParseResult,
    context: ConversationTurnParseInput,
  ): ConversationTurnParseResult {
    if (
      parsedTurn.intent === "ask_clarification" ||
      (parsedTurn.rejectedOperations?.length ?? 0) > 0
    ) {
      return parsedTurn;
    }
    const searchContinuation = this.findSearchContinuation(message, context);
    if (this.isAdviceFirstQuestion(message) && !searchContinuation) {
      return parsedTurn;
    }
    const analysis = analyzeShoppingLanguage(message, context);
    const localPatch = analysis.filterPatch;
    const hasLocalPatch = Object.keys(localPatch).length > 0;
    if (
      parsedTurn.intent === "refine_filter" ||
      parsedTurn.intent === "reset_filter"
    ) {
      return parsedTurn;
    }
    const shouldSearch =
      searchContinuation !== null ||
      this.isProductSearchRequest(message) ||
      this.isExplicitFilterRequest(message) ||
      (hasLocalPatch && !this.isAdviceOnlyQuestion(message));
    if (!shouldSearch) return parsedTurn;

    const filterPatch = {
      ...(parsedTurn.filterPatch ?? {}),
      ...localPatch,
    };
    return {
      ...parsedTurn,
      intent: "refine_filter",
      filterPatch,
      filterRemove: analysis.filterRemove,
      shouldResetPreviousFilters:
        parsedTurn.shouldResetPreviousFilters === true,
      assistantMessage: this.buildLocalFilterAssistantMessage(
        filterPatch,
        parsedTurn.assistantMessage,
      ),
      confidence: Math.max(parsedTurn.confidence ?? 0, 0.66),
      raw: {
        ...(parsedTurn.raw ?? {}),
        forcedBy: "turns_service_product_search_guard",
        ...(searchContinuation
          ? {
              searchContinuation: searchContinuation.trigger,
              inheritedSearchMessage: searchContinuation.queryMessage,
            }
          : {}),
      },
      semanticOperations: analysis.semanticOperations,
      profilePatch: analysis.profilePatch,
      profileRemove: analysis.profileRemove,
      rejectedOperations: analysis.rejectedOperations,
    };
  }

  private resolveTurnSearchMessage(
    message: string,
    context: ConversationTurnParseInput,
  ) {
    const continuation = this.findSearchContinuation(message, context);
    if (!continuation) return message;
    if (continuation.trigger === "affirmative_reply") {
      return continuation.queryMessage;
    }
    return `${continuation.queryMessage} ${message}`.trim();
  }

  private findSearchContinuation(
    message: string,
    context: ConversationTurnParseInput,
  ): {
    queryMessage: string;
    trigger: "affirmative_reply" | "contextual_search_command";
  } | null {
    const normalized = message.trim();
    const affirmativeReply =
      /^(好|好的|好啊|可以|行|行的|没问题|需要|要|嗯|嗯嗯|对|是的|当然|搜吧|搜索吧|帮我搜|帮我搜索|麻烦了|开始吧)[\s。！!，,]*$/i.test(
        normalized,
      );
    const contextualSearchCommand =
      /^(?:请|麻烦)?(?:直接|现在|马上)?(?:为我|帮我)?(?:搜索|搜一下|搜|找一下|找)(?:具体商品|具体款|商品|鞋款|一批)?(?:吧|一下)?[\s。！!，,]*$/i.test(
        normalized,
      );
    if (!affirmativeReply && !contextualSearchCommand) return null;

    const previousMessages = context.recentMessages.filter(
      (item) =>
        !(
          item.role === "user" &&
          item.turnIndex === context.turnIndex &&
          item.content.trim() === normalized
        ),
    );
    const offerIndex = this.findLastIndex(previousMessages, (item) => {
      if (item.role !== "assistant") return false;
      return this.isSearchOfferMessage(item.content);
    });
    if (offerIndex < 0) return null;
    if (affirmativeReply) {
      const latestAssistantIndex = this.findLastIndex(
        previousMessages,
        (item) => item.role === "assistant",
      );
      if (latestAssistantIndex !== offerIndex) return null;
    }

    for (let index = offerIndex - 1; index >= 0; index -= 1) {
      const candidate = previousMessages[index];
      if (candidate.role !== "user") continue;
      const candidateMessage = candidate.content.trim();
      if (
        candidateMessage.length === 0 ||
        this.isAcknowledgementMessage(candidateMessage) ||
        this.isContextOnlySearchCommand(candidateMessage)
      ) {
        continue;
      }
      if (
        this.isAdviceFirstQuestion(candidateMessage) ||
        this.isProductSearchRequest(candidateMessage) ||
        /鞋|shoe|shoes|sneaker|通勤|上班|上课|跑步|篮球|休闲|穿搭|商品|产品/i.test(
          candidateMessage,
        )
      ) {
        return {
          queryMessage: candidateMessage,
          trigger: affirmativeReply
            ? "affirmative_reply"
            : "contextual_search_command",
        };
      }
    }
    return null;
  }

  private isSearchOfferMessage(message: string) {
    return /(?:需要|要不要|是否|可以|要我|让我|我来).{0,12}(?:帮你|为你)?.{0,8}(?:搜索|搜一批|搜一下|找一批|找具体|搜索具体)|(?:搜索|搜一批|搜一下|找一批|找具体|搜索具体).{0,12}(?:吗|么|？|\?)/i.test(
      message,
    );
  }

  private isAcknowledgementMessage(message: string) {
    return /^(好|好的|好啊|可以|行|行的|没问题|嗯|嗯嗯|对|是的|当然|谢谢|感谢|麻烦了)[\s。！!，,]*$/i.test(
      message.trim(),
    );
  }

  private isContextOnlySearchCommand(message: string) {
    return /^(?:请|麻烦)?(?:直接|现在|马上)?(?:为我|帮我)?(?:搜索|搜一下|搜|找一下|找)(?:具体商品|具体款|商品|鞋款|一批)?(?:吧|一下)?[\s。！!，,]*$/i.test(
      message.trim(),
    );
  }

  private findLastIndex<T>(
    items: T[],
    predicate: (item: T) => boolean,
  ): number {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (predicate(items[index])) return index;
    }
    return -1;
  }

  private buildLocalFilterPatch(message: string): Record<string, unknown> {
    return analyzeShoppingLanguage(message).filterPatch;
  }

  private isProductSearchRequest(message: string) {
    if (this.isAdviceFirstQuestion(message)) return false;
    return (
      /(?:想买|要买|准备买|帮我找|找一下|搜索|搜一下|看看|看一下|换成|改成|改口|推荐|买一双|买一台|买台|买个|只看|仅看|筛选)/i.test(
        message,
      ) && this.hasProductSearchSignal(message)
    );
  }

  private isAdviceFirstQuestion(message: string) {
    const normalized = message.trim();
    const advicePattern =
      /有什么适合|适合.*吗|穿什么|怎么选|推荐哪类|哪种.*适合|通勤|上班|上课|约会|日常穿|日常.*鞋|穿搭|跑步.*怎么|篮球.*怎么|休闲.*怎么/i;
    const directSearchPattern =
      /我想买|要买|准备买|帮我找|找一下|搜索|搜一下|看看|看一下|有没有|只看|仅看|筛选|预算|价位|不超过|低于|少于|最多|最高|以内|以下|\d{2,5}\s*(元|块|rmb|RMB|¥)/i;

    return (
      advicePattern.test(normalized) && !directSearchPattern.test(normalized)
    );
  }

  private isExplicitFilterRequest(message: string) {
    return /只看|仅看|筛选|过滤|限定|限制|控制在|预算|价位|不超过|低于|少于|最多|最高|以内|以下|以上|有货|现货|可拍|包邮|免邮|旗舰店|官方店|平台|淘宝|天猫|京东|得物|拼多多|抖音|闲鱼|咸鱼|排除|不要|不看|去掉|改成|换成|想看|看.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|找.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|搜索.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|搜.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|买.*(?:商品|产品|鞋|电脑|笔记本|手机|耳机|相机|手表|平板|键盘|鼠标)|按.*排序|价格优先|低价优先|好评优先|评分优先|最快|送达|到货|从低到高|从高到低|cheapest|free shipping|filter|only|under|below|exclude|sort/i.test(
      message,
    );
  }

  private isAdviceOnlyQuestion(message: string) {
    return (
      /[?？]|为什么|为何|怎么|如何|哪个|哪双|哪一个|推荐|建议|值不值|值得|适合|能不能|可不可以|好吗|行吗|靠谱吗/i.test(
        message,
      ) && !this.isExplicitFilterRequest(message)
    );
  }

  private buildLocalFilterAssistantMessage(
    filterPatch: Record<string, unknown>,
    modelMessage: string,
  ) {
    const parts: string[] = [];
    if (filterPatch.brand) parts.push(`品牌为 ${filterPatch.brand}`);
    if (filterPatch.color) parts.push(`颜色为 ${filterPatch.color}`);
    if (filterPatch.size) parts.push(`尺码为 ${filterPatch.size}`);
    if (filterPatch.stockOnly === true) parts.push("只看有货");
    if (filterPatch.freeShippingOnly === true) parts.push("只看包邮");
    if (filterPatch.priceMax) parts.push(`${filterPatch.priceMax}元以内`);
    if (filterPatch.priceMin) parts.push(`${filterPatch.priceMin}元以上`);
    if (filterPatch.shopType === "flagship") parts.push("优先旗舰店");
    if (Array.isArray(filterPatch.platformsInclude)) {
      parts.push(
        `平台限定为 ${filterPatch.platformsInclude
          .map((platform) => this.displayPlatform(platform))
          .join("、")}`,
      );
    }
    if (Array.isArray(filterPatch.platformsExclude)) {
      parts.push(
        `不看 ${filterPatch.platformsExclude
          .map((platform) => this.displayPlatform(platform))
          .join("、")}`,
      );
    }
    if (filterPatch.sortRule === "price_asc") parts.push("按价格从低到高");
    if (filterPatch.sortRule === "price_desc") parts.push("按价格从高到低");
    if (filterPatch.sortRule === "relevance_desc") parts.push("按匹配度优先");
    if (filterPatch.sortRule === "rating_desc") parts.push("按评分优先");
    if (filterPatch.sortRule === "delivery_asc") parts.push("按送达速度优先");
    if (parts.length > 0) return `好的，已为您${parts.join("，")}筛选。`;
    return modelMessage?.trim() || "收到，我会按这条要求继续收拢商品池。";
  }

  private buildPostSearchAssistantMessage(input: {
    message: string;
    parsedTurn: ConversationTurnParseResult;
    candidates: CandidateSeed[];
    fallback: SearchResult["fallback"];
    effectiveFilter: Record<string, unknown>;
    filterDiff?: FilterStateDiff;
    profileDiff?: {
      added: Record<string, unknown>;
      changed: Record<string, { before: unknown; after: unknown }>;
      removed: Record<string, unknown>;
    };
  }): string {
    const filterDiff = input.filterDiff ?? {
      added: {},
      changed: {},
      removed: {},
      unchanged: [],
      rejected: [],
    };
    const profileDiff = input.profileDiff ?? {
      added: {},
      changed: {},
      removed: {},
    };
    if (filterDiff.rejected.length > 0) {
      return filterDiff.rejected[0].message;
    }
    const changedCount =
      Object.keys(filterDiff.added).length +
      Object.keys(filterDiff.changed).length +
      Object.keys(filterDiff.removed).length +
      Object.keys(profileDiff.added).length +
      Object.keys(profileDiff.changed).length +
      Object.keys(profileDiff.removed).length;
    if (
      changedCount === 0 &&
      input.parsedTurn.intent !== "reset_filter" &&
      !this.isDirectProductSearchRequest(input.message) &&
      input.filterDiff
    ) {
      return "当前条件本来就是这样，没有重复修改筛选。";
    }
    if (input.fallback || input.candidates.length === 0) {
      const removed = [
        ...Object.keys(filterDiff.removed),
        ...Object.keys(profileDiff.removed),
      ];
      return removed.length > 0
        ? `已清除${removed.map((field) => this.displayFilterField(field)).join("、")}限制，但当前仍没有找到合适商品。`
        : "已按你的要求更新筛选，但当前条件下暂时没有找到合适商品。你可以放宽预算、平台或颜色条件试试。";
    }

    if (input.parsedTurn.intent === "reset_filter") {
      return `好的，已为您重置筛选，当前找到 ${input.candidates.length} 个结果。`;
    }

    if (this.isDirectProductSearchRequest(input.message)) {
      const subject = this.buildSearchSubject(
        input.message,
        input.effectiveFilter,
      );
      return `好的，已为您搜索 ${subject}，找到 ${input.candidates.length} 个结果。你可以继续说“只看500元以下”“只看黑色”“按价格从低到高”。`;
    }

    const updateMessage = this.buildRefineResultMessage(
      input.parsedTurn.filterPatch ?? {},
      input.effectiveFilter,
      input.candidates.length,
    );
    const removed = [
      ...Object.keys(filterDiff.removed),
      ...Object.keys(profileDiff.removed),
    ];
    if (removed.length > 0) {
      return `已清除${removed.map((field) => this.displayFilterField(field)).join("、")}限制，当前找到 ${input.candidates.length} 个结果。`;
    }
    return (
      updateMessage ??
      `好的，已为您更新商品，当前保留 ${input.candidates.length} 个结果。`
    );
  }

  private isDirectProductSearchRequest(message: string): boolean {
    if (this.isAdviceFirstQuestion(message)) return false;
    return (
      /我想买|要买|准备买|帮我找|找一下|搜索|搜一下|看看|看一下|有没有|买一双|买一台|买台|买个|推荐/i.test(
        message,
      ) && this.hasProductSearchSignal(message)
    );
  }

  private displayFilterField(field: string) {
    const labels: Record<string, string> = {
      priceMin: "最低价格",
      priceMax: "最高价格",
      priceTarget: "目标价格",
      platformsInclude: "平台限定",
      platformsExclude: "平台排除",
      brandsInclude: "品牌",
      brandsExclude: "排除品牌",
      brand: "识别品牌",
      colorsInclude: "颜色",
      colorsExclude: "排除颜色",
      color: "识别颜色",
      sizesInclude: "尺码",
      stockOnly: "库存",
      freeShippingOnly: "包邮",
      shopType: "店铺类型",
      sortRule: "排序",
    };
    return labels[field] ?? field;
  }

  private buildRefineResultMessage(
    filterPatch: Record<string, unknown>,
    effectiveFilter: Record<string, unknown>,
    candidateCount: number,
  ): string | null {
    const sortRule = this.toString(filterPatch.sortRule);
    if (sortRule === "price_asc") {
      return "好的，已为您按价格从低到高重新排序。";
    }
    if (sortRule === "price_desc") {
      return "好的，已为您按价格从高到低重新排序。";
    }
    if (sortRule === "relevance_desc") {
      return "好的，已为您按匹配度重新排序；匹配度相差 10% 以内时，价格更低的会排在前面。";
    }
    if (sortRule === "rating_desc") {
      return "好的，已为您按评分从高到低重新排序。";
    }
    if (sortRule === "delivery_asc") {
      return "好的，已为您按送达速度优先重新排序。";
    }

    const parts: string[] = [];
    const category = normalizeProductCategory(
      effectiveFilter.categoryScope,
      "general",
    );
    const priceMax = this.toString(
      filterPatch.priceMax ?? effectiveFilter.priceMax,
    );
    if (priceMax) {
      parts.push(`当前保留 ${candidateCount} 个 ${priceMax}元以下的结果`);
    }
    const priceMin = this.toString(
      filterPatch.priceMin ?? effectiveFilter.priceMin,
    );
    if (priceMin) {
      parts.push(`只看 ${priceMin}元以上的结果`);
    }
    const platforms = this.toStringArray(
      filterPatch.platformsInclude ?? effectiveFilter.platformsInclude,
    );
    if (platforms.length > 0) {
      parts.push(
        `只看${platforms.map((platform) => this.displayPlatform(platform)).join("、")}平台的结果`,
      );
    }
    const excludedPlatforms = this.toStringArray(
      filterPatch.platformsExclude ?? effectiveFilter.platformsExclude,
    );
    if (excludedPlatforms.length > 0) {
      parts.push(
        `不看${excludedPlatforms
          .map((platform) => this.displayPlatform(platform))
          .join("、")}平台的结果`,
      );
    }
    const color = this.toString(filterPatch.color ?? effectiveFilter.color);
    if (color) parts.push(`只看${this.displayColor(color)}的结果`);
    const size = this.toString(filterPatch.size ?? effectiveFilter.size);
    if (size) {
      parts.push(
        category === "shoe" ? `只看 ${size} 码的结果` : `只看 ${size} 尺寸/规格的结果`,
      );
    }
    const brand = this.toString(filterPatch.brand ?? effectiveFilter.brand);
    if (brand) {
      const label = getProductCategoryDefinition(category).labelZh;
      parts.push(
        category === "shoe"
          ? `只看 ${brand} 相关鞋款`
          : `只看 ${brand} 相关${category === "general" ? "商品" : label}`,
      );
    }
    if (filterPatch.shopType === "flagship" || effectiveFilter.shopType === "flagship") {
      parts.push("优先旗舰店结果");
    }
    if (filterPatch.stockOnly === true || effectiveFilter.stockOnly === true) {
      parts.push("只看有货的结果");
    }
    if (
      filterPatch.freeShippingOnly === true ||
      effectiveFilter.freeShippingOnly === true
    ) {
      parts.push("只看包邮的结果");
    }

    if (parts.length === 0) return null;
    return `好的，已为您更新商品，${parts.join("，")}。`;
  }

  private buildSearchSubject(message: string, filter: Record<string, unknown>) {
    const category = normalizeProductCategory(
      filter.categoryScope ?? message,
      "general",
    );
    const brand = this.extractBrand(message) ?? this.toString(filter.brand);
    if (category === "shoe") {
      if (brand) return `${brand} 相关鞋款`;
      if (/篮球鞋|basketball/i.test(message)) return "篮球鞋";
      if (/跑鞋|跑步|running/i.test(message)) return "跑步鞋";
      if (/板鞋|skate/i.test(message)) return "板鞋";
      if (/休闲|通勤|日常|casual|lifestyle/i.test(message))
        return "休闲通勤鞋";
      return "相关鞋款";
    }
    if (/笔记本电脑|笔记本|laptop|notebook/i.test(message)) {
      return brand ? `${brand} 笔记本电脑` : "笔记本电脑";
    }
    const label = getProductCategoryDefinition(category).labelZh;
    if (category === "general") return brand ? `${brand} 相关商品` : "相关商品";
    return brand ? `${brand} ${label}` : `${label}商品`;
  }

  private displayPlatform(platform: string) {
    return displayPlatformLabel(platform);
  }

  private displayColor(color: string) {
    const normalized = color.trim().toLowerCase();
    if (normalized === "black_white") return "黑白色";
    if (normalized === "white") return "白色";
    if (normalized === "black") return "黑色";
    if (normalized === "gray" || normalized === "grey") return "灰色";
    if (normalized === "blue") return "蓝色";
    if (normalized === "red") return "红色";
    if (normalized === "green") return "绿色";
    if (normalized === "yellow") return "黄色";
    if (normalized === "brown") return "棕色";
    if (normalized === "beige") return "米色";
    if (normalized === "pink") return "粉色";
    if (normalized === "purple") return "紫色";
    if (normalized === "orange") return "橙色";
    if (normalized === "multi") return "多色";
    return color;
  }

  private buildTurnSearchProfile(
    baseProfile: ProductProfileResult | null,
    message: string,
    effectiveFilter: Record<string, unknown>,
    parsedTurn?: ConversationTurnParseResult,
  ): ProductProfileResult {
    const mentionedCategory =
      analyzeShoppingLanguage(message).categoryMentions.at(-1) ??
      normalizeProductCategoryOrNull(message);
    const category = normalizeProductCategory(
      this.toString(effectiveFilter.categoryScope) ??
        mentionedCategory ??
        baseProfile?.category,
      "general",
    );
    const sameBaseCategory =
      !baseProfile || normalizeProductCategory(baseProfile.category) === category;
    const canUseShoeState = category === "shoe";
    const profileRemove = new Set(parsedTurn?.profileRemove ?? []);
    const profilePatch = parsedTurn?.profilePatch ?? {};
    const explicitBrand = this.toString(profilePatch.brand) ?? this.extractBrand(message);
    const filterBrands = this.toStringArray(effectiveFilter.brandsInclude);
    const filterBrand = filterBrands.length === 1 ? filterBrands[0] : null;
    const baseBrand =
      sameBaseCategory && this.shouldInheritBaseProfileBrand(baseProfile)
        ? (baseProfile?.brand ?? null)
        : null;
    const brand = profileRemove.has("brand")
      ? null
      : explicitBrand ?? filterBrand ?? (filterBrands.length > 1 ? null : baseBrand) ?? null;
    const filterColors = this.toStringArray(effectiveFilter.colorsInclude);
    const patchedColor = this.toString(profilePatch.color);
    const color = profileRemove.has("color")
      ? null
      : patchedColor ??
        this.extractColor(message) ??
        (filterColors.length === 1 ? filterColors[0] : null) ??
        (filterColors.length > 1 ? null : sameBaseCategory ? baseProfile?.colorFamily : null) ??
        (filterColors.length > 1 ? null : sameBaseCategory ? baseProfile?.color : null) ??
        null;
    const filterSizes = this.toStringArray(effectiveFilter.sizesInclude);
    const size = profileRemove.has("size")
      ? null
      :
      (canUseShoeState ? this.extractShoeSize(message) : null) ??
      (canUseShoeState && filterSizes.length === 1 ? filterSizes[0] : null) ??
      (canUseShoeState && sameBaseCategory ? baseProfile?.size : null) ??
      null;
    const shoeType =
      canUseShoeState
        ? this.extractShoeType(message) ??
          (sameBaseCategory ? baseProfile?.shoeType : null) ??
          null
        : null;
    const gender = this.extractGender(message);

    return {
      category,
      brand,
      modelLine: sameBaseCategory ? (baseProfile?.modelLine ?? null) : null,
      colorFamily: color,
      colorway: sameBaseCategory ? (baseProfile?.colorway ?? null) : null,
      shoeType,
      size,
      color,
      styleTags: sameBaseCategory ? (baseProfile?.styleTags ?? []) : [],
      sceneTags: [
        ...(sameBaseCategory ? (baseProfile?.sceneTags ?? []) : []),
        ...(category === "shoe" && shoeType ? [shoeType] : []),
        ...(category === "shoe" && gender ? [gender] : []),
      ].filter((item, index, items) => items.indexOf(item) === index),
      keywords: this.buildTurnKeywords(message, sameBaseCategory ? (baseProfile?.keywords ?? []) : [], {
        brand,
        category,
        colorFamily: color,
        color,
        shoeType,
        size,
        raw: { gender },
      }),
      confidence: Math.max(baseProfile?.confidence ?? 0, 0.68),
      raw: {
        ...(sameBaseCategory ? (baseProfile?.raw ?? {}) : {}),
        source: "turn_text_query",
        latestUserMessage: message,
        gender,
        recognizedProfileOriginal:
          this.asRecord(baseProfile?.raw).recognizedProfileOriginal ??
          (baseProfile
            ? {
                brand: baseProfile.brand ?? null,
                color: baseProfile.colorFamily ?? baseProfile.color ?? null,
                shoeType: baseProfile.shoeType ?? null,
              }
            : null),
        userProfilePatch: profilePatch,
        userProfileRemove: [...profileRemove],
        userEdited:
          Object.keys(profilePatch).length > 0 || profileRemove.size > 0
            ? true
            : this.asRecord(baseProfile?.raw).userEdited === true,
      },
    };
  }

  private buildTurnKeywords(
    message: string,
    baseKeywords: string[],
    profile: Partial<ProductProfileResult>,
  ) {
    const tokens = message
      .split(/[\s,，。；;、.!?？]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    const gender =
      typeof profile.raw?.gender === "string" ? profile.raw.gender : null;
    return [
      message,
      ...baseKeywords,
      ...tokens,
      profile.brand,
      profile.modelLine,
      profile.colorFamily,
      profile.color,
      profile.shoeType,
      profile.size ? `${profile.size}码` : null,
      profile.category === "shoe" && gender === "male" ? "男鞋" : null,
      profile.category === "shoe" && gender === "female" ? "女鞋" : null,
      ...productCategoryKeywords(profile.category),
    ]
      .filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
      .map((item) => item.trim())
      .filter((item, index, items) => items.indexOf(item) === index)
      .slice(0, 16);
  }

  private shouldInheritBaseProfileBrand(
    baseProfile: ProductProfileResult | null,
  ) {
    if (!baseProfile?.brand) return false;
    const raw = this.asRecord(baseProfile.raw);
    if (raw.brandSource === "user_memory") return false;
    if (raw.initialConversationOnly === true && raw.source === "text_query") {
      return false;
    }
    return true;
  }

  private extractBrand(message: string) {
    return extractBrandHeuristic(message);
  }

  private applyCategoryChangeToFilter(
    filter: Record<string, unknown>,
    message: string,
    baseProfile: ProductProfileResult | null,
  ) {
    const categoryAnalysis = analyzeShoppingLanguage(message);
    const mentionedCategory = categoryAnalysis.categoryMentions.at(-1) ??
      normalizeProductCategoryOrNull(message);
    if (!mentionedCategory) return;
    const previousCategory = normalizeProductCategory(
      baseProfile?.category,
      mentionedCategory,
    );
    filter.categoryScope = mentionedCategory;
    if (mentionedCategory === previousCategory) return;
    for (const field of [
      "brand",
      "color",
      "size",
      "brandsInclude",
      "brandsExclude",
      "colorsInclude",
      "colorsExclude",
      "sizesInclude",
      "sizeSystem",
      "sizeMin",
      "sizeMax",
    ]) {
      filter[field] = field.endsWith("Include") || field.endsWith("Exclude") ? [] : null;
    }
    for (const field of [
      "brandsInclude",
      "brandsExclude",
      "colorsInclude",
      "colorsExclude",
      "sizesInclude",
      "sizeSystem",
      "sizeMin",
      "sizeMax",
    ]) {
      if (categoryAnalysis.filterPatch[field] !== undefined) {
        filter[field] = categoryAnalysis.filterPatch[field];
      }
    }
  }

  private hasProductSearchSignal(message: string) {
    return (
      normalizeProductCategoryOrNull(message) !== null ||
      /商品|产品|数码|电子产品|淘宝|天猫|京东|得物|拼多多|抖音|旗舰店|官方店|Nike|耐克|Adidas|阿迪|Puma|彪马|New Balance|新百伦|ASICS|Asics|亚瑟士/i.test(
        message,
      )
    );
  }

  private extractColor(message: string) {
    return extractColorHeuristic(message);
  }

  private extractShoeType(message: string) {
    if (/跑鞋|running/i.test(message)) return "running";
    if (/篮球鞋|basketball/i.test(message)) return "basketball";
    if (/板鞋|滑板|skate/i.test(message)) return "skate";
    if (/足球鞋|football/i.test(message)) return "football";
    if (/训练鞋|training/i.test(message)) return "training";
    return null;
  }

  private extractShoeSize(message: string) {
    return extractShoeSizeHeuristic(message);
  }

  private extractPriceMax(message: string) {
    return extractPriceMaxHeuristic(message);
  }

  private extractPlatforms(message: string) {
    return extractMentionedPlatforms(message);
  }

  private extractGender(message: string) {
    if (/男鞋|男子|男款|男士|男生|male|men'?s/i.test(message)) return "male";
    if (/女鞋|女子|女款|女士|女生|female|women'?s/i.test(message))
      return "female";
    return null;
  }

  private buildProfileDiff(
    before: ProductProfileResult | null,
    after: ProductProfileResult,
  ) {
    const changed: Record<string, { before: unknown; after: unknown }> = {};
    const removed: Record<string, unknown> = {};
    const added: Record<string, unknown> = {};
    for (const field of ["category", "brand", "modelLine", "colorFamily", "color", "shoeType", "size"] as const) {
      const left = before?.[field] ?? null;
      const right = after[field] ?? null;
      if (JSON.stringify(left) === JSON.stringify(right)) continue;
      if ((left === null || left === "") && right !== null && right !== "") added[field] = right;
      else if (left !== null && left !== "" && (right === null || right === "")) removed[field] = left;
      else changed[field] = { before: left, after: right };
    }
    return { added, changed, removed };
  }

  private hashVector(vector: number[]) {
    return createHash("sha256").update(JSON.stringify(vector)).digest("hex");
  }
}
