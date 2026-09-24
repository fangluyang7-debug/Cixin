import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { ImageAsset } from "@prisma/client";
import { CACHE_STORE } from "../../../cache/cache.constants";
import { stableHash } from "../../../cache/cache-key.util";
import { CacheStore } from "../../../cache/interfaces/cache-store.interface";
import { PrismaService } from "../../../persistence/prisma/prisma.service";
import { createId } from "../../../common/utils/id";
import {
  fromJson,
  toJsonArrayString,
  toJsonString,
} from "../../../common/utils/json";
import {
  MODEL_ADAPTER,
  ModelAdapter,
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
import { SuggestionsService } from "../../suggestions/application/suggestions.service";
import {
  CANDIDATE_ITEM_ADAPTER,
  CandidateItemAdapter,
} from "../../candidates/application/candidate-item-adapter.interface";
import {
  CANDIDATE_SEARCH_CONTEXT_ADAPTER,
  CandidateSearchContextAdapter,
} from "../../candidates/application/candidate-search-context-adapter.interface";
import {
  UserMemoryContext,
  UserMemoryContextService,
} from "../../user-memory/application/user-memory-context.service";
import { PromptRegistryService } from "../../prompt-assets/application/prompt-registry.service";
import { ProfileSchemaRegistryService } from "../../prompt-assets/application/profile-schema-registry.service";
import {
  SEARCH_QUERY_EMBEDDING_ADAPTER,
  SearchQueryEmbeddingAdapter,
} from "../../product-pool/application/search-query-embedding-adapter.interface";
import { CreateSessionDto } from "../dto/create-session.dto";
import { CreateTextSessionDto } from "../dto/create-text-session.dto";
import { UpdateProductProfileDto } from "../dto/update-product-profile.dto";
import { analyzeShoppingLanguage } from "../../../common/shopping/shopping-language-analyzer";
import { validateShoppingMessage } from "../../../common/shopping/shopping-message-validation";
import {
  NormalizedSubjectBoxDto,
  UpdateSubjectSelectionDto,
} from "../dto/subject-selection.dto";
import { QueryImagePreprocessService } from "./query-image-preprocess.service";
import {
  SESSION_PRODUCT_PROFILE_ADAPTER,
  SessionProductProfileAdapter,
} from "./session-product-profile-adapter.interface";
import {
  SESSION_VIEW_ADAPTER,
  SessionViewAdapter,
} from "./session-view-adapter.interface";
import {
  getProductCategoryDefinition,
  normalizeProductCategory,
  productCategoryKeywords,
} from "../../../common/catalog/product-categories";
import {
  extractBrand as extractBrandHeuristic,
  extractColor as extractColorHeuristic,
  extractPriceMax as extractPriceMaxHeuristic,
  extractShoeSize as extractShoeSizeHeuristic,
  extractShoppingFilterPatch,
} from "../../../common/shopping/shopping-filter-heuristics";
import {
  extractMentionedPlatforms,
  normalizePlatformKey,
} from "../../../common/platforms/platform-normalization";

interface SearchResult {
  candidates: CandidateSeed[];
  fallback: ReturnType<FallbackService["buildFallbackReason"]> | null;
}

interface CreateSessionOptions {
  userId?: string | null;
}

const RECOGNITION_CACHE_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SESSION_PRODUCT_PROFILE_ADAPTER)
    private readonly productProfileAdapter: SessionProductProfileAdapter,
    @Inject(SESSION_VIEW_ADAPTER)
    private readonly sessionViewAdapter: SessionViewAdapter,
    @Inject(SEARCH_PROVIDER)
    private readonly searchProvider: SearchProvider,
    @Inject(CANDIDATE_ITEM_ADAPTER)
    private readonly candidateItemAdapter: CandidateItemAdapter,
    @Inject(CANDIDATE_SEARCH_CONTEXT_ADAPTER)
    private readonly candidateSearchContextAdapter: CandidateSearchContextAdapter,
    @Inject(SEARCH_QUERY_EMBEDDING_ADAPTER)
    private readonly searchQueryEmbeddingAdapter: SearchQueryEmbeddingAdapter,
    private readonly fallbackService: FallbackService,
    private readonly candidatesService: CandidatesService,
    private readonly suggestionsService: SuggestionsService,
    private readonly userMemoryContext: UserMemoryContextService,
    private readonly queryImagePreprocess: QueryImagePreprocessService,
    private readonly promptRegistry: PromptRegistryService,
    private readonly profileSchemaRegistry: ProfileSchemaRegistryService,
    private readonly config: ConfigService,
    @Inject(CACHE_STORE)
    private readonly cache: CacheStore,
    @Inject(MODEL_ADAPTER)
    private readonly modelAdapter: ModelAdapter,
  ) {}

  async createSession(
    dto: CreateSessionDto,
    options: CreateSessionOptions = {},
  ) {
    this.validateCreateSessionDto(dto);

    const asset = await this.prisma.imageAsset.findUnique({
      where: { id: dto.assetId },
    });
    if (!asset) throw new NotFoundException("IMAGE_ASSET_NOT_FOUND");

    const sessionId = createId("sess");
    const category = normalizeProductCategory(dto.categoryHint ?? "general");
    const hasInitialSubjectSelection = !!dto.initialSubjectSelection?.box;
    const initialSubjectSelection =
      dto.initialSubjectSelection?.box ?? this.defaultInitialSubjectSelection();

    if (!initialSubjectSelection) {
      const profile = await this.identifyInitialProfileOrPending({
        asset,
        categoryHint: category,
      });
      const userMemoryFilter = options.userId
        ? await this.userMemoryContext.getDefaultFilter(
            options.userId,
            category,
          )
        : {};
      const initialFilter = this.withResolvedSearchPipelineMode({
        sortRule: "relevance_desc",
        stockOnly: false,
        ...userMemoryFilter,
        ...(dto.filters ?? {}),
      });

      await this.prisma.querySession.create({
        data: {
          id: sessionId,
          assetId: asset.id,
          userId: options.userId ?? null,
          status: "processing",
          stage: "profile_ready",
          entrySource: dto.entrySource ?? "android_app",
          categoryHint: category,
          degraded: false,
          currentTurnIndex: 0,
          profileSnapshot: {
            create: {
              id: createId("profile_snap"),
              category: profile.category,
              brand: profile.brand,
              size: profile.size,
              color: profile.color,
              keywordsJson: toJsonArrayString(profile.keywords),
              styleTagsJson: toJsonArrayString(profile.styleTags),
              sceneTagsJson: toJsonArrayString(profile.sceneTags),
              confidence: profile.confidence,
              rawJson: toJsonString({
                ...profile.raw,
                modelLine: profile.modelLine ?? null,
                colorFamily: profile.colorFamily ?? null,
                colorway: profile.colorway ?? null,
                shoeType: profile.shoeType ?? null,
              }),
            },
          },
          filterSnapshots: {
            create: {
              id: createId("filter_snap"),
              turnIndex: 0,
              stockOnly: false,
              sortRule: "relevance_desc",
              platform:
                this.toStringArray(initialFilter.platformsInclude).length === 1
                  ? this.toStringArray(initialFilter.platformsInclude)[0]
                  : null,
              rawJson: toJsonString(initialFilter),
            },
          },
        },
      });

      const preprocess = await this.queryImagePreprocess.createInitial({
        sessionId,
        asset,
        profile,
      });
      const pipelineMode = this.resolveSearchPipelineMode(initialFilter);
      const searchFilter =
        pipelineMode === "light_tag_ann_fusion"
          ? this.withProfileSearchConstraints(initialFilter, profile)
          : initialFilter;
      const searchResult = preprocess.queryEmbedding
        ? await this.searchShoesWithFallback({
            keywords: profile.keywords,
            profile,
            assetId: dto.assetId,
            queryEmbedding: preprocess.queryEmbedding,
            queryImageUrl: preprocess.queryImageUrl,
            filters: searchFilter,
            embeddingKind:
              pipelineMode === "light_tag_ann_fusion" ? "visual" : undefined,
          })
        : {
            candidates: [],
            fallback: this.fallbackService.buildFallbackReason(
              "SUBJECT_SELECTION_REQUIRED",
            ),
          };
      const candidateSnapshotId = await this.writeCandidateSnapshot({
        sessionId,
        turnIndex: 0,
        candidates: searchResult.candidates,
        fallback: searchResult.fallback,
        appliedFilter: searchFilter,
        extraAppliedFilter: {
          searchPipelineMode: pipelineMode,
        },
      });
      await this.candidatesService.createPaginationCursorForSnapshot({
        sessionId,
        candidateSnapshotId,
        preprocessSnapshotId: preprocess.snapshot.id,
        filter: searchFilter,
        offset: this.initialConsumedOffset(searchResult.candidates.length),
        limit: this.initialReturnLimit(),
        totalCandidates: searchResult.candidates.length,
        fallbackSearchAllowed: this.searchMoreFallbackAllowed(
          preprocess.queryEmbedding,
        ),
        sortRule: this.toString(searchFilter.sortRule),
      });
      await this.prisma.querySession.update({
        where: { id: sessionId },
        data: {
          status: searchResult.fallback ? "degraded_ready" : "ready",
          stage:
            searchResult.fallback?.reason === "SUBJECT_SELECTION_REQUIRED"
              ? "subject_selection_required"
              : "candidate_ready",
          degraded: searchResult.fallback !== null,
        },
      });

      return this.getSession(sessionId);
    }

    const userMemoryFilter = options.userId
      ? await this.userMemoryContext.getDefaultFilter(options.userId, category)
      : {};
    const initialFilter = this.withResolvedSearchPipelineMode({
      sortRule: "relevance_desc",
      stockOnly: false,
      ...userMemoryFilter,
      ...(dto.filters ?? {}),
    });
    const pendingProfile = this.buildPendingImageProfile(category);

    await this.prisma.querySession.create({
      data: {
        id: sessionId,
        assetId: asset.id,
        userId: options.userId ?? null,
        status: "processing",
        stage: "preprocessing",
        entrySource: dto.entrySource ?? "android_app",
        categoryHint: category,
        degraded: false,
        currentTurnIndex: 0,
        profileSnapshot: {
          create: {
            id: createId("profile_snap"),
            category: pendingProfile.category,
            brand: pendingProfile.brand,
            size: pendingProfile.size,
            color: pendingProfile.color,
            keywordsJson: toJsonArrayString(pendingProfile.keywords),
            styleTagsJson: toJsonArrayString(pendingProfile.styleTags),
            sceneTagsJson: toJsonArrayString(pendingProfile.sceneTags),
            confidence: pendingProfile.confidence,
            rawJson: toJsonString({
              ...pendingProfile.raw,
              modelLine: pendingProfile.modelLine ?? null,
              colorFamily: pendingProfile.colorFamily ?? null,
              colorway: pendingProfile.colorway ?? null,
              shoeType: pendingProfile.shoeType ?? null,
            }),
          },
        },
        filterSnapshots: {
          create: {
            id: createId("filter_snap"),
            turnIndex: 0,
            stockOnly: false,
            sortRule: "relevance_desc",
            platform:
              this.toStringArray(initialFilter.platformsInclude).length === 1
                ? this.toStringArray(initialFilter.platformsInclude)[0]
                : null,
            rawJson: toJsonString(initialFilter),
          },
        },
      },
    });

    let detailedProfileStarted = false;
    let categoryPromise: Promise<string> | null = null;
    let detailedProfilePromise: Promise<ProductProfileResult | null> | null =
      null;
    const startCropDrivenJobs = (event: {
      queryImageUrl: string;
      selectedBox?: unknown;
      localCategory: {
        category: string;
        confidence: number;
        detectedClass: string;
      } | null;
    }) => {
      if (detailedProfileStarted) return;
      detailedProfileStarted = true;
      categoryPromise = event.localCategory
        ? Promise.resolve(
            this.normalizeSupportedCategory(
              event.localCategory.category,
              category,
            ),
          )
        : this.classifyCategoryForAnn({
            imageUrl: event.queryImageUrl,
            categoryHint: category,
          });
      detailedProfilePromise = this.runDetailedProfileJob({
        sessionId,
        asset,
        categoryHint: category,
        queryImageUrl: event.queryImageUrl,
        box: event.selectedBox,
      });
      void detailedProfilePromise;
    };

    const preprocess = await this.queryImagePreprocess.createUserSelection({
      sessionId,
      asset,
      box: initialSubjectSelection,
      selectionSource: hasInitialSubjectSelection
        ? (dto.initialSubjectSelection?.selectionSource ?? "user_initial")
        : "auto",
      profile: null,
      onCropReady: (event) => startCropDrivenJobs(event),
    });
    if (!detailedProfileStarted && preprocess.queryImageUrl) {
      startCropDrivenJobs({
        queryImageUrl: preprocess.queryImageUrl,
        selectedBox: initialSubjectSelection,
        localCategory: null,
      });
    }

    const annCategory = await this.awaitCategoryOrFallback(
      categoryPromise,
      category,
    );
    const fastProfile = this.buildPendingImageProfile(annCategory);
    const fastFilter: Record<string, unknown> = {
      ...initialFilter,
      categoryScope: annCategory,
    };
    const pipelineMode = this.resolveSearchPipelineMode(fastFilter);
    const searchResult = preprocess.queryEmbedding
      ? pipelineMode === "light_tag_ann_fusion"
        ? await this.searchLightTagAnnFusionWithFallback({
            sessionId,
            asset,
            categoryHint: annCategory,
            box: initialSubjectSelection,
            profilePromise: detailedProfilePromise,
            queryEmbedding: preprocess.queryEmbedding,
            queryImageUrl: preprocess.queryImageUrl,
            filters: fastFilter,
          })
        : await this.searchFastAnnShoesWithFallback({
            keywords: fastProfile.keywords,
            profile: fastProfile,
            assetId: dto.assetId,
            queryEmbedding: preprocess.queryEmbedding,
            queryImageUrl: preprocess.queryImageUrl,
            filters: fastFilter,
            category: annCategory,
            embeddingKind: "visual",
          })
      : {
          candidates: [],
          fallback: this.fallbackService.buildFallbackReason(
            "SUBJECT_SELECTION_REQUIRED",
          ),
        };
    const candidateSnapshotId = await this.writeCandidateSnapshot({
      sessionId,
      turnIndex: 0,
      candidates: searchResult.candidates,
      fallback: searchResult.fallback,
      appliedFilter: fastFilter,
      extraAppliedFilter: {
        searchMode:
          pipelineMode === "light_tag_ann_fusion"
            ? "light_tag_ann_fusion"
            : "fast_ann",
        searchPipelineMode: pipelineMode,
        detailedProfileStatus: detailedProfileStarted
          ? "running"
          : "not_started",
        subjectSelectionSnapshotId: preprocess.snapshot.id,
      },
    });
    await this.candidatesService.createPaginationCursorForSnapshot({
      sessionId,
      candidateSnapshotId,
      preprocessSnapshotId: preprocess.snapshot.id,
      filter: fastFilter,
      offset: this.initialConsumedOffset(searchResult.candidates.length),
      limit: this.initialReturnLimit(),
      totalCandidates: searchResult.candidates.length,
      fallbackSearchAllowed: this.searchMoreFallbackAllowed(
        preprocess.queryEmbedding,
      ),
      sortRule: this.toString(fastFilter.sortRule),
    });
    await this.prisma.querySession.update({
      where: { id: sessionId },
      data: {
        status: searchResult.fallback ? "degraded_ready" : "ready",
        stage:
          searchResult.fallback?.reason === "SUBJECT_SELECTION_REQUIRED"
            ? "subject_selection_required"
            : "candidate_ready",
        degraded: searchResult.fallback !== null,
      },
    });

    return {
      ...(await this.getSession(sessionId)),
      imageSearch: {
        searchMode:
          pipelineMode === "light_tag_ann_fusion"
            ? "light_tag_ann_fusion"
            : "fast_ann",
        searchPipelineMode: pipelineMode,
        categoryScope: annCategory,
        detailedProfileStatus: detailedProfileStarted
          ? "running"
          : "not_started",
        candidateSnapshotId,
      },
    };
  }

  async createTextSession(
    dto: CreateTextSessionDto,
    options: CreateSessionOptions = {},
  ) {
    this.validateCreateTextSessionDto(dto);

    const sessionId = createId("sess");
    const assetId = createId("asset");
    const assetGroupId = createId("asset_group");
    const message = validateShoppingMessage(dto.message, {
      requiredCode: "TEXT_SESSION_MESSAGE_REQUIRED",
      tooLongCode: "TEXT_SESSION_MESSAGE_TOO_LONG",
    });
    const languageAnalysis = analyzeShoppingLanguage(message);
    const category = normalizeProductCategory(
      dto.categoryHint ?? languageAnalysis.categoryMentions.at(-1) ?? languageAnalysis.correctedText,
    );
    const keywords = this.normalizeKeywords(dto.keywords, message);
    const userMemoryContext = options.userId
      ? await this.userMemoryContext.getContext(options.userId, category)
      : null;
    const profile = this.buildTextProfile(
      message,
      keywords,
      userMemoryContext?.derived ?? null,
      category,
    );
    if (languageAnalysis.route !== "search") {
      return this.createConversationOnlyTextSession({
        dto,
        options,
        sessionId,
        assetId,
        assetGroupId,
        category,
        message,
        keywords,
        profile,
        intent:
          languageAnalysis.route === "clarification"
            ? "ask_clarification"
            : "general_chat",
        assistantMessageOverride: languageAnalysis.clarificationMessage,
      });
    }
    const userMemoryFilter = userMemoryContext
      ? this.buildDefaultFilterFromMemory(userMemoryContext.derived, category)
      : {};
    const initialFilter = this.buildInitialTextFilter(
      message,
      userMemoryFilter,
      dto.filters,
    );
    initialFilter.categoryScope ??= category;
    const queryEmbedding =
      await this.searchQueryEmbeddingAdapter.buildQueryEmbedding({
        keywords,
        profile,
        queryImageUrl: null,
      });
    const searchResult = await this.searchShoesWithFallback({
      keywords,
      profile,
      queryEmbedding,
      filters: initialFilter,
    });
    const assistantMessage = this.buildInitialTextSearchAssistantMessage({
      message,
      candidates: searchResult.candidates,
      fallback: searchResult.fallback,
      effectiveFilter: initialFilter,
    });

    await this.prisma.imageAsset.create({
      data: {
        id: assetId,
        assetGroupId,
        variantType: "demo_asset",
        isPrimaryRecognitionAsset: false,
        sourceType: "text_query",
        bucketGroup: "text-query",
        objectKey: `sessions/${sessionId}/text-query.json`,
        uploadStatus: "registered",
      },
    });
    await this.prisma.querySession.create({
      data: {
        id: sessionId,
        assetId,
        userId: options.userId ?? null,
        status: "processing",
        stage: "profile_ready",
        entrySource: dto.entrySource ?? "android_app",
        categoryHint: category,
        degraded: false,
        currentTurnIndex: 0,
        profileSnapshot: {
          create: {
            id: createId("profile_snap"),
            category: profile.category,
            brand: profile.brand,
            size: profile.size,
            color: profile.color,
            keywordsJson: toJsonArrayString(profile.keywords),
            styleTagsJson: toJsonArrayString(profile.styleTags),
            sceneTagsJson: toJsonArrayString(profile.sceneTags),
            confidence: profile.confidence,
            rawJson: toJsonString({
              ...profile.raw,
              modelLine: profile.modelLine ?? null,
              colorFamily: profile.colorFamily ?? null,
              colorway: profile.colorway ?? null,
              shoeType: profile.shoeType ?? null,
            }),
          },
        },
        filterSnapshots: {
          create: {
            id: createId("filter_snap"),
            turnIndex: 0,
            priceMin: this.toString(initialFilter.priceMin),
            priceMax: this.toString(initialFilter.priceMax),
            stockOnly: initialFilter.stockOnly === true,
            platform:
              this.toStringArray(initialFilter.platformsInclude).length === 1
                ? this.toStringArray(initialFilter.platformsInclude)[0]
                : this.toString(initialFilter.platform),
            sortRule: this.toString(initialFilter.sortRule) ?? "relevance_desc",
            rawJson: toJsonString(initialFilter),
          },
        },
        conversationMessages: {
          create: [
            {
              id: createId("conv_msg"),
              turnIndex: 0,
              role: "user",
              content: message,
              metadataJson: toJsonString({ source: "text_session_api" }),
            },
            {
              id: createId("conv_msg"),
              turnIndex: 0,
              role: "assistant",
              content: assistantMessage,
              metadataJson: toJsonString({
                source: "text_session_api",
                fallbackReason: searchResult.fallback?.reason ?? null,
              }),
            },
          ],
        },
      },
    });

    const preprocessSnapshot =
      await this.prisma.queryImagePreprocessSnapshot.create({
        data: {
          id: createId("query_pre"),
          sessionId,
          assetId,
          selectedBoxJson: "{}",
          detectedBoxesJson: "[]",
          selectionSource: "text_query",
          status: "ready",
          embeddingProvider: "search_query_adapter",
          embeddingModel: "text_query",
          embeddingDimension: queryEmbedding.length,
          embeddingVectorHash: this.hashVector(queryEmbedding),
          embeddingVectorJson: toJsonString(queryEmbedding),
          cropImageRefJson: "{}",
          rawJson: toJsonString({
            source: "text_query",
            message,
            keywords,
          }),
        },
      });
    const candidateSnapshotId = await this.writeCandidateSnapshot({
      sessionId,
      turnIndex: 0,
      candidates: searchResult.candidates,
      fallback: searchResult.fallback,
      appliedFilter: initialFilter,
    });
    await this.candidatesService.createPaginationCursorForSnapshot({
      sessionId,
      candidateSnapshotId,
      preprocessSnapshotId: preprocessSnapshot.id,
      filter: initialFilter,
      offset: this.initialConsumedOffset(searchResult.candidates.length),
      limit: this.initialReturnLimit(),
      totalCandidates: searchResult.candidates.length,
      fallbackSearchAllowed: this.searchMoreFallbackAllowed(queryEmbedding),
      sortRule: this.toString(initialFilter.sortRule),
    });
    await this.prisma.querySession.update({
      where: { id: sessionId },
      data: {
        status: searchResult.fallback ? "degraded_ready" : "ready",
        stage: "candidate_ready",
        degraded: searchResult.fallback !== null,
      },
    });

    const candidates =
      await this.candidatesService.getCurrentCandidates(sessionId);
    const suggestions = await this.suggestionsService.getSuggestions(sessionId);

    return {
      ...(await this.getSession(sessionId)),
      assistantMessage,
      effectiveFilter: initialFilter,
      conversationState: {
        stateChangingTurn: true,
        actionType: "initial_product_search",
      },
      candidates,
      suggestions,
      fallback: searchResult.fallback,
      textQuery: {
        message,
        keywords,
        candidateSnapshotId,
        intent: "initial_product_search",
        stateChangingTurn: true,
      },
    };
  }

  async getSession(sessionId: string) {
    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
      include: {
        profileSnapshot: true,
        filterSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
        candidateSnapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            _count: { select: { items: true } },
            items: {
              orderBy: [{ rank: "asc" }, { amount: "asc" }],
              take: this.initialReturnLimit(),
            },
          },
        },
        queryImagePreprocessSnapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");
    return this.sessionViewAdapter.toSessionDetail(session);
  }

  async updateSubjectSelection(
    sessionId: string,
    dto: UpdateSubjectSelectionDto,
  ) {
    if (!dto || typeof dto !== "object") {
      throw new BadRequestException("SUBJECT_SELECTION_BODY_REQUIRED");
    }
    if (!dto.box) {
      throw new BadRequestException("SUBJECT_SELECTION_BOX_REQUIRED");
    }

    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
      include: {
        profileSnapshot: true,
        filterSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");

    const assetId = dto.assetId ?? session.assetId;
    const asset = await this.prisma.imageAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) throw new NotFoundException("IMAGE_ASSET_NOT_FOUND");

    const profile = this.candidateSearchContextAdapter.toProfile(
      session.profileSnapshot,
    );
    const activeFilter = session.filterSnapshots[0] ?? null;
    const filterRaw =
      this.candidateSearchContextAdapter.toFilterRaw(activeFilter);
    filterRaw.searchPipelineMode = this.resolveSearchPipelineMode(filterRaw);
    const preprocess = await this.queryImagePreprocess.createUserSelection({
      sessionId,
      asset,
      box: dto.box,
      selectionSource: dto.selectionSource ?? "user_adjusted",
      profile,
    });

    const searchFilter = profile
      ? this.withProfileSearchConstraints(filterRaw, profile)
      : filterRaw;
    const searchResult = await this.searchShoesWithFallback({
      keywords: this.candidateSearchContextAdapter.toKeywords(
        session.profileSnapshot,
      ),
      profile: profile ?? undefined,
      assetId: asset.id,
      queryEmbedding: preprocess.queryEmbedding,
      queryImageUrl: preprocess.queryImageUrl,
      filters: searchFilter,
      embeddingKind:
        this.resolveSearchPipelineMode(filterRaw) === "light_tag_ann_fusion"
          ? "visual"
          : undefined,
    });
    const candidateSnapshotId = await this.writeCandidateSnapshot({
      sessionId,
      turnIndex: session.currentTurnIndex,
      candidates: searchResult.candidates,
      fallback: searchResult.fallback,
      appliedFilter: searchFilter,
      extraAppliedFilter: {
        searchPipelineMode: this.resolveSearchPipelineMode(filterRaw),
        subjectSelectionSnapshotId: preprocess.snapshot.id,
      },
    });
    await this.candidatesService.createPaginationCursorForSnapshot({
      sessionId,
      candidateSnapshotId,
      preprocessSnapshotId: preprocess.snapshot.id,
      filter: searchFilter,
      offset: this.initialConsumedOffset(searchResult.candidates.length),
      limit: this.initialReturnLimit(),
      totalCandidates: searchResult.candidates.length,
      fallbackSearchAllowed: this.searchMoreFallbackAllowed(
        preprocess.queryEmbedding,
      ),
      sortRule: this.toString(searchFilter.sortRule),
    });
    await this.prisma.querySession.update({
      where: { id: sessionId },
      data: {
        status: searchResult.fallback ? "degraded_ready" : "ready",
        stage: "candidate_ready",
        degraded: searchResult.fallback !== null,
      },
    });

    return {
      ...(await this.getSession(sessionId)),
      subjectSelection: {
        preprocessSnapshotId: preprocess.snapshot.id,
        candidateSnapshotId,
      },
    };
  }

  async updateProductProfile(sessionId: string, dto: UpdateProductProfileDto) {
    if (!dto || typeof dto !== "object") {
      throw new BadRequestException("PRODUCT_PROFILE_BODY_REQUIRED");
    }

    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
      include: {
        profileSnapshot: true,
        filterSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
        queryImagePreprocessSnapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        candidateSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");

    const baseProfile =
      this.candidateSearchContextAdapter.toProfile(session.profileSnapshot) ??
      this.buildPendingImageProfile(session.categoryHint ?? "general");
    const profile = this.mergeUserProductProfile(baseProfile, dto);
    await this.writeDetailedProfileSnapshot(sessionId, profile, {
      detailedProfileStatus: "ready",
      source: "user_profile_edit",
      userEdited: true,
    });

    const preprocess = session.queryImagePreprocessSnapshots[0] ?? null;
    const queryEmbedding =
      preprocess && preprocess.status === "ready"
        ? this.candidateSearchContextAdapter.toQueryEmbedding(preprocess)
        : [];
    const queryImageUrl =
      preprocess && preprocess.status === "ready"
        ? await this.queryImagePreprocess.getCropImageUrl(preprocess)
        : null;
    const activeFilter = session.filterSnapshots[0] ?? null;
    const filterRaw = {
      ...this.candidateSearchContextAdapter.toFilterRaw(activeFilter),
      ...(dto.filters ?? {}),
    };
    filterRaw.searchPipelineMode = this.resolveSearchPipelineMode(filterRaw);
    filterRaw.categoryScope ??= profile.category;

    const searchFilter = profile
      ? this.withProfileSearchConstraints(filterRaw, profile)
      : filterRaw;
    const searchResult = await this.searchShoesWithFallback({
      keywords: profile.keywords,
      profile,
      assetId: session.assetId,
      queryEmbedding: queryEmbedding.length > 0 ? queryEmbedding : undefined,
      queryImageUrl,
      filters: searchFilter,
      embeddingKind: queryEmbedding.length > 0 ? "visual" : undefined,
    });
    const sourceCandidateSnapshotId = session.candidateSnapshots[0]?.id ?? null;
    const candidateSnapshotId = await this.writeCandidateSnapshot({
      sessionId,
      turnIndex: session.currentTurnIndex,
      candidates: searchResult.candidates,
      fallback: searchResult.fallback,
      appliedFilter: searchFilter,
      extraAppliedFilter: {
        searchMode: "profile_edit_fusion",
        searchPipelineMode: this.resolveSearchPipelineMode(filterRaw),
        sourceCandidateSnapshotId,
        subjectSelectionSnapshotId: preprocess?.id ?? null,
        userEditedProfile: true,
      },
    });
    await this.candidatesService.createPaginationCursorForSnapshot({
      sessionId,
      candidateSnapshotId,
      preprocessSnapshotId: preprocess?.id ?? null,
      filter: searchFilter,
      offset: this.initialConsumedOffset(searchResult.candidates.length),
      limit: this.initialReturnLimit(),
      totalCandidates: searchResult.candidates.length,
      fallbackSearchAllowed: this.searchMoreFallbackAllowed(queryEmbedding),
      sortRule: this.toString(searchFilter.sortRule),
    });
    await this.prisma.querySession.update({
      where: { id: sessionId },
      data: {
        status: searchResult.fallback ? "degraded_ready" : "ready",
        stage: "candidate_ready",
        degraded: searchResult.fallback !== null,
      },
    });

    return {
      ...(await this.getSession(sessionId)),
      profileUpdate: {
        status: searchResult.fallback ? "degraded_ready" : "ready",
        searchMode: "profile_edit_fusion",
        searchPipelineMode: this.resolveSearchPipelineMode(filterRaw),
        candidateSnapshotId,
      },
    };
  }

  async refineCandidates(sessionId: string) {
    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
      include: {
        profileSnapshot: true,
        filterSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
        queryImagePreprocessSnapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        candidateSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");

    const preprocess = session.queryImagePreprocessSnapshots[0] ?? null;
    if (!preprocess || preprocess.status !== "ready") {
      throw new BadRequestException("QUERY_IMAGE_PREPROCESS_NOT_READY");
    }

    const detailedProfileStatus = this.detailedProfileStatus(
      session.profileSnapshot,
    );
    if (detailedProfileStatus !== "ready") {
      return {
        ...(await this.getSession(sessionId)),
        refine: {
          status:
            detailedProfileStatus === "failed" ? "tag_failed" : "tag_pending",
          detailedProfileStatus,
          candidateSnapshotId: session.candidateSnapshots[0]?.id ?? null,
        },
      };
    }

    const queryEmbedding =
      this.candidateSearchContextAdapter.toQueryEmbedding(preprocess);
    if (queryEmbedding.length === 0) {
      throw new BadRequestException("QUERY_EMBEDDING_VECTOR_NOT_AVAILABLE");
    }

    const profile = this.candidateSearchContextAdapter.toProfile(
      session.profileSnapshot,
    );
    if (!profile) {
      throw new BadRequestException("DETAILED_PROFILE_NOT_READY");
    }

    const activeFilter = session.filterSnapshots[0] ?? null;
    const filterRaw =
      this.candidateSearchContextAdapter.toFilterRaw(activeFilter);
    filterRaw.searchPipelineMode = this.resolveSearchPipelineMode(filterRaw);
    const searchFilter = this.withProfileSearchConstraints(filterRaw, profile);
    const queryImageUrl =
      await this.queryImagePreprocess.getCropImageUrl(preprocess);
    const searchResult = await this.searchShoesWithFallback({
      keywords: this.candidateSearchContextAdapter.toKeywords(
        session.profileSnapshot,
      ),
      profile,
      assetId: session.assetId,
      queryEmbedding,
      queryImageUrl,
      filters: searchFilter,
      embeddingKind:
        this.resolveSearchPipelineMode(filterRaw) === "light_tag_ann_fusion"
          ? "visual"
          : undefined,
    });
    const sourceCandidateSnapshotId = session.candidateSnapshots[0]?.id ?? null;
    const candidateSnapshotId = await this.writeCandidateSnapshot({
      sessionId,
      turnIndex: session.currentTurnIndex,
      candidates: searchResult.candidates,
      fallback: searchResult.fallback,
      appliedFilter: searchFilter,
      extraAppliedFilter: {
        searchMode: "refined_fusion",
        searchPipelineMode: this.resolveSearchPipelineMode(filterRaw),
        sourceCandidateSnapshotId,
        subjectSelectionSnapshotId: preprocess.id,
        detailedProfileStatus: "ready",
      },
    });
    await this.candidatesService.createPaginationCursorForSnapshot({
      sessionId,
      candidateSnapshotId,
      preprocessSnapshotId: preprocess.id,
      filter: searchFilter,
      offset: this.initialConsumedOffset(searchResult.candidates.length),
      limit: this.initialReturnLimit(),
      totalCandidates: searchResult.candidates.length,
      fallbackSearchAllowed: this.searchMoreFallbackAllowed(queryEmbedding),
      sortRule: this.toString(searchFilter.sortRule),
    });
    await this.prisma.querySession.update({
      where: { id: sessionId },
      data: {
        status: searchResult.fallback ? "degraded_ready" : "ready",
        stage: "candidate_ready",
        degraded: searchResult.fallback !== null,
      },
    });

    return {
      ...(await this.getSession(sessionId)),
      refine: {
        status: searchResult.fallback ? "degraded_ready" : "ready",
        searchMode: "refined_fusion",
        candidateSnapshotId,
      },
    };
  }

  private async createConversationOnlyTextSession(input: {
    dto: CreateTextSessionDto;
    options: CreateSessionOptions;
    sessionId: string;
    assetId: string;
    assetGroupId: string;
    category: string;
    message: string;
    keywords: string[];
    profile: ProductProfileResult;
    intent?: "general_chat" | "ask_clarification";
    assistantMessageOverride?: string | null;
  }) {
    const semantic = analyzeShoppingLanguage(input.message);
    const initialFilter = this.withResolvedSearchPipelineMode({
      sortRule: "relevance_desc",
      stockOnly: false,
      ...(semantic.rejectedOperations.length === 0 ? semantic.filterPatch : {}),
      ...(input.dto.filters ?? {}),
    });
    for (const field of semantic.filterRemove) delete initialFilter[field];
    initialFilter.categoryScope ??= input.category;
    const assistantMessage =
      input.assistantMessageOverride ??
      await this.buildInitialConversationAssistantMessage({
        message: input.message,
        profile: input.profile,
        userId: input.options.userId ?? null,
        category: input.category,
      });

    await this.prisma.imageAsset.create({
      data: {
        id: input.assetId,
        assetGroupId: input.assetGroupId,
        variantType: "demo_asset",
        isPrimaryRecognitionAsset: false,
        sourceType: "text_query",
        bucketGroup: "text-query",
        objectKey: `sessions/${input.sessionId}/text-chat.json`,
        uploadStatus: "registered",
      },
    });
    await this.prisma.querySession.create({
      data: {
        id: input.sessionId,
        assetId: input.assetId,
        userId: input.options.userId ?? null,
        status: "ready",
        stage: "conversation_ready",
        entrySource: input.dto.entrySource ?? "android_app",
        categoryHint: input.category,
        degraded: false,
        currentTurnIndex: 0,
        profileSnapshot: {
          create: {
            id: createId("profile_snap"),
            category: input.profile.category,
            brand: input.profile.brand,
            size: input.profile.size,
            color: input.profile.color,
            keywordsJson: toJsonArrayString(input.profile.keywords),
            styleTagsJson: toJsonArrayString(input.profile.styleTags),
            sceneTagsJson: toJsonArrayString(input.profile.sceneTags),
            confidence: input.profile.confidence,
            rawJson: toJsonString({
              ...input.profile.raw,
              modelLine: input.profile.modelLine ?? null,
              colorFamily: input.profile.colorFamily ?? null,
              colorway: input.profile.colorway ?? null,
              shoeType: input.profile.shoeType ?? null,
              initialConversationOnly: true,
            }),
          },
        },
        filterSnapshots: {
          create: {
            id: createId("filter_snap"),
            turnIndex: 0,
            stockOnly: false,
            sortRule: "relevance_desc",
            rawJson: toJsonString(initialFilter),
          },
        },
        conversationMessages: {
          create: [
            {
              id: createId("conv_msg"),
              turnIndex: 0,
              role: "user",
              content: input.message,
              metadataJson: toJsonString({ source: "text_session_api" }),
            },
            {
              id: createId("conv_msg"),
              turnIndex: 0,
              role: "assistant",
              content: assistantMessage,
              metadataJson: toJsonString({
                source: "text_session_api",
                intent: input.intent ?? "general_chat",
                stateChangingTurn: false,
              }),
            },
          ],
        },
      },
    });

    const candidateSnapshotId =
      input.intent === "ask_clarification"
        ? null
        : await this.writeCandidateSnapshot({
            sessionId: input.sessionId,
            turnIndex: 0,
            candidates: [],
            fallback: null,
            appliedFilter: initialFilter,
            extraAppliedFilter: {
              conversationIntent: input.intent ?? "general_chat",
              stateChangingTurn: false,
            },
          });

    const candidates = candidateSnapshotId
      ? await this.candidatesService.getCurrentCandidates(input.sessionId)
      : this.candidatesService.emptyCandidateSet(initialFilter);
    const suggestions = await this.suggestionsService.getSuggestions(
      input.sessionId,
    );

    return {
      ...(await this.getSession(input.sessionId)),
      assistantMessage,
      intent: input.intent ?? "general_chat",
      effectiveFilter: initialFilter,
      conversationState: {
        stateChangingTurn: false,
        actionType: "conversation_only",
      },
      candidates,
      suggestions,
      fallback: null,
      textQuery: {
        message: input.message,
        keywords: input.keywords,
        candidateSnapshotId,
        stateChangingTurn: false,
      },
    };
  }

  private buildPendingImageProfile(category: string): ProductProfileResult {
    const normalizedCategory = normalizeProductCategory(category);
    return {
      category: normalizedCategory,
      brand: null,
      modelLine: null,
      colorFamily: null,
      colorway: null,
      shoeType: null,
      size: null,
      color: null,
      styleTags: [],
      sceneTags: [],
      keywords: productCategoryKeywords(normalizedCategory),
      confidence: 0,
      raw: {
        source: "fast_image_session_placeholder",
        detailedProfileStatus: "pending",
      },
    };
  }

  private defaultInitialSubjectSelection(): NormalizedSubjectBoxDto {
    return {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      confidence: 0.6,
      label: "full_image_fallback",
    };
  }

  private async searchLightTagAnnFusionWithFallback(input: {
    sessionId: string;
    asset: Pick<ImageAsset, "id" | "bucketGroup" | "objectKey">;
    categoryHint: string;
    box?: unknown;
    profilePromise?: Promise<ProductProfileResult | null> | null;
    queryEmbedding: number[];
    queryImageUrl?: string | null;
    filters: Record<string, unknown>;
  }): Promise<SearchResult> {
    const profile = await this.identifyLightweightProfileOrNull({
      sessionId: input.sessionId,
      asset: input.asset,
      categoryHint: input.categoryHint,
      box: input.box,
      profilePromise: input.profilePromise,
      queryImageUrl: input.queryImageUrl,
    });
    if (!profile || !this.hasLightweightSearchSignals(profile)) {
      const fallbackProfile = this.buildPendingImageProfile(input.categoryHint);
      return this.searchFastAnnShoesWithFallback({
        keywords: fallbackProfile.keywords,
        profile: fallbackProfile,
        assetId: input.asset.id,
        queryEmbedding: input.queryEmbedding,
        queryImageUrl: input.queryImageUrl,
        filters: input.filters,
        category:
          fallbackProfile.category === "general"
            ? undefined
            : fallbackProfile.category,
        embeddingKind: "visual",
      });
    }

    const runSearch = (resolvedProfile: ProductProfileResult) => {
      const keywords =
        resolvedProfile.keywords.length > 0
          ? resolvedProfile.keywords
          : productCategoryKeywords(resolvedProfile.category);
      const searchFilter = this.withProfileSearchConstraints(
        input.filters,
        resolvedProfile,
      );
      Object.assign(input.filters, searchFilter);

      return this.searchShoesWithFallback({
        keywords,
        profile: {
          ...resolvedProfile,
          keywords,
        },
        assetId: input.asset.id,
        queryEmbedding: input.queryEmbedding,
        queryImageUrl: input.queryImageUrl,
        filters: searchFilter,
        embeddingKind: "visual",
      });
    };

    return runSearch(profile);
  }

  private async identifyLightweightProfileOrNull(input: {
    sessionId: string;
    asset: Pick<ImageAsset, "id" | "bucketGroup" | "objectKey">;
    categoryHint: string;
    queryImageUrl?: string | null;
    box?: unknown;
    profilePromise?: Promise<ProductProfileResult | null> | null;
  }): Promise<ProductProfileResult | null> {
    if (!input.queryImageUrl) return null;

    const cacheKey = this.recognitionCacheKey({
      asset: input.asset,
      categoryHint: input.categoryHint,
      box: input.box,
    });
    const cached = await this.safeCacheGet<ProductProfileResult>(cacheKey);
    if (cached) {
      await this.writeDetailedProfileSnapshot(input.sessionId, cached, {
        detailedProfileStatus: "ready",
        sourceImage: "query_crop",
        lightweightProfile: true,
      });
      return cached;
    }

    if (input.profilePromise) {
      try {
        const profile = await this.withTimeout(
          input.profilePromise,
          this.lightweightProfileWaitMs(),
        );
        if (profile) return profile;
      } catch {
        // Keep the first screen bounded; the background profile job continues.
      }
    } else {
      const readyProfile = await this.waitForDetailedProfile(
        input.sessionId,
        this.lightweightProfileWaitMs(),
      );
      if (readyProfile) return readyProfile;
    }

    return null;
  }

  private async identifyInitialProfileOrPending(input: {
    asset: Pick<ImageAsset, "id" | "bucketGroup" | "objectKey">;
    categoryHint: string;
  }): Promise<ProductProfileResult> {
    const cacheKey = this.recognitionCacheKey({
      asset: input.asset,
      categoryHint: input.categoryHint,
    });
    const cached = await this.safeCacheGet<ProductProfileResult>(cacheKey);
    if (cached) return cached;

    try {
      const profile = await this.productProfileAdapter.identifyProductProfile({
        assetId: input.asset.id,
        categoryHint: input.categoryHint,
      });
      await this.safeCacheSet(cacheKey, profile, RECOGNITION_CACHE_TTL_SECONDS);
      return profile;
    } catch (error) {
      const profile = this.buildPendingImageProfile(input.categoryHint);
      return {
        ...profile,
        raw: {
          ...profile.raw,
          detailedProfileStatus: "failed",
          error:
            error instanceof Error ? error.message : "UNKNOWN_PROFILE_ERROR",
        },
      };
    }
  }

  private async classifyCategoryForAnn(input: {
    imageUrl: string;
    categoryHint: string;
  }) {
    try {
      const category = await this.withTimeout(
        this.productProfileAdapter.classifyProductCategory({
          imageUrl: input.imageUrl,
          categoryHint: input.categoryHint,
        }),
        this.categoryRecognitionTimeoutMs(),
      );
      return this.normalizeSupportedCategory(
        category.category,
        input.categoryHint,
      );
    } catch {
      return this.normalizeSupportedCategory(input.categoryHint, "general");
    }
  }

  private async awaitCategoryOrFallback(
    categoryPromise: Promise<string> | null,
    categoryHint: string,
  ) {
    if (!categoryPromise) {
      return this.normalizeSupportedCategory(categoryHint, "general");
    }
    try {
      return await this.withTimeout(
        categoryPromise,
        this.categoryRecognitionTimeoutMs(),
      );
    } catch {
      return this.normalizeSupportedCategory(categoryHint, "general");
    }
  }

  private async runDetailedProfileJob(input: {
    sessionId: string;
    asset: Pick<ImageAsset, "id" | "bucketGroup" | "objectKey">;
    categoryHint: string;
    queryImageUrl: string;
    box?: unknown;
  }): Promise<ProductProfileResult | null> {
    try {
      await this.markDetailedProfileStatus(input.sessionId, "running", {
        sourceImage: "query_crop",
        categoryHint: input.categoryHint,
      });
      const cacheKey = this.recognitionCacheKey({
        asset: input.asset,
        categoryHint: input.categoryHint,
        box: input.box,
      });
      const cached = await this.safeCacheGet<ProductProfileResult>(cacheKey);
      const profile =
        cached ??
        (await this.withTimeout(
          this.productProfileAdapter.identifyProductProfile({
            assetId: input.asset.id,
            categoryHint: input.categoryHint,
            imageUrl: input.queryImageUrl,
          }),
          this.detailedProfileTimeoutMs(),
        ));
      if (!cached) {
        await this.safeCacheSet(
          cacheKey,
          profile,
          RECOGNITION_CACHE_TTL_SECONDS,
        );
      }
      await this.writeDetailedProfileSnapshot(input.sessionId, profile, {
        detailedProfileStatus: "ready",
        sourceImage: "query_crop",
      });
      return profile;
    } catch (error) {
      try {
        await this.markDetailedProfileStatus(input.sessionId, "failed", {
          error:
            error instanceof Error ? error.message : "UNKNOWN_PROFILE_ERROR",
        });
      } catch {
        // The fast ANN result must remain usable even if the background status update fails.
      }
      return null;
    }
  }

  private async writeDetailedProfileSnapshot(
    sessionId: string,
    profile: ProductProfileResult,
    rawPatch: Record<string, unknown>,
  ) {
    const existing = await this.prisma.productProfileSnapshot.findUnique({
      where: { sessionId },
    });
    const existingRaw = existing
      ? fromJson<Record<string, unknown>>(existing.rawJson, {})
      : {};
    if (existingRaw.userEdited === true && rawPatch.userEdited !== true) {
      await this.prisma.productProfileSnapshot.update({
        where: { sessionId },
        data: {
          rawJson: toJsonString({
            ...existingRaw,
            detailedProfileStatus:
              rawPatch.detailedProfileStatus ??
              existingRaw.detailedProfileStatus ??
              "ready",
            latestRecognitionUpdate: rawPatch,
            recognizedProfileOriginal: {
              category: profile.category,
              brand: profile.brand ?? null,
              modelLine: profile.modelLine ?? null,
              colorFamily: profile.colorFamily ?? null,
              colorway: profile.colorway ?? null,
              shoeType: profile.shoeType ?? null,
              size: profile.size ?? null,
              color: profile.color ?? null,
              styleTags: profile.styleTags,
              sceneTags: profile.sceneTags,
              keywords: profile.keywords,
              confidence: profile.confidence,
            },
            updatedAt: new Date().toISOString(),
          }),
        },
      });
      return;
    }
    const data = {
      category: profile.category,
      brand: profile.brand,
      size: profile.size,
      color: profile.color,
      keywordsJson: toJsonArrayString(profile.keywords),
      styleTagsJson: toJsonArrayString(profile.styleTags),
      sceneTagsJson: toJsonArrayString(profile.sceneTags),
      confidence: profile.confidence,
      rawJson: toJsonString({
        ...profile.raw,
        ...rawPatch,
        modelLine: profile.modelLine ?? null,
        colorFamily: profile.colorFamily ?? null,
        colorway: profile.colorway ?? null,
        shoeType: profile.shoeType ?? null,
        updatedAt: new Date().toISOString(),
      }),
    };
    await this.prisma.productProfileSnapshot.upsert({
      where: { sessionId },
      create: {
        id: createId("profile_snap"),
        sessionId,
        ...data,
      },
      update: data,
    });
  }

  private async markDetailedProfileStatus(
    sessionId: string,
    status: "pending" | "running" | "ready" | "failed",
    patch: Record<string, unknown> = {},
  ) {
    const snapshot = await this.prisma.productProfileSnapshot.findUnique({
      where: { sessionId },
    });
    const raw = snapshot
      ? fromJson<Record<string, unknown>>(snapshot.rawJson, {})
      : {};
    const category = normalizeProductCategory(
      patch.categoryHint ?? raw.categoryHint ?? raw.category,
      "general",
    );
    await this.prisma.productProfileSnapshot.upsert({
      where: { sessionId },
      create: {
        id: createId("profile_snap"),
        sessionId,
        category,
        brand: null,
        size: null,
        color: null,
        keywordsJson: toJsonArrayString(productCategoryKeywords(category)),
        styleTagsJson: toJsonArrayString([]),
        sceneTagsJson: toJsonArrayString([]),
        confidence: 0,
        rawJson: toJsonString({
          source: "fast_image_session_placeholder",
          ...patch,
          detailedProfileStatus: status,
          updatedAt: new Date().toISOString(),
        }),
      },
      update: {
        rawJson: toJsonString({
          ...raw,
          ...patch,
          detailedProfileStatus: status,
          updatedAt: new Date().toISOString(),
        }),
      },
    });
  }

  private detailedProfileStatus(
    snapshot: { rawJson: string } | null,
  ): "pending" | "running" | "ready" | "failed" {
    if (!snapshot) return "pending";
    const raw = fromJson<Record<string, unknown>>(snapshot.rawJson, {});
    const status = this.toString(raw.detailedProfileStatus);
    if (status === "pending" || status === "running" || status === "failed") {
      return status;
    }
    if (status === "ready") return "ready";
    return "ready";
  }

  private async waitForDetailedProfile(
    sessionId: string,
    timeoutMs: number,
  ): Promise<ProductProfileResult | null> {
    const deadline = Date.now() + timeoutMs;
    do {
      const snapshot = await this.prisma.productProfileSnapshot.findUnique({
        where: { sessionId },
      });
      const status = this.detailedProfileStatus(snapshot);
      if (status === "ready" && snapshot) {
        return this.candidateSearchContextAdapter.toProfile(snapshot);
      }
      if (status === "failed") return null;
      await this.delay(100);
    } while (Date.now() < deadline);
    return null;
  }

  private mergeUserProductProfile(
    base: ProductProfileResult,
    dto: UpdateProductProfileDto,
  ): ProductProfileResult {
    const baseRaw =
      typeof base.raw === "object" && base.raw !== null && !Array.isArray(base.raw)
        ? base.raw
        : {};
    const existingUserPatch =
      typeof baseRaw.userProfilePatch === "object" &&
      baseRaw.userProfilePatch !== null &&
      !Array.isArray(baseRaw.userProfilePatch)
        ? (baseRaw.userProfilePatch as Record<string, unknown>)
        : {};
    const category = dto.category
      ? normalizeProductCategory(dto.category, base.category)
      : base.category;
    const keywords = this.cleanStringArray(dto.keywords);
    const nextKeywords =
      keywords.length > 0
        ? keywords
        : base.keywords.length > 0
          ? base.keywords
          : productCategoryKeywords(category);

    return {
      category,
      brand: this.optionalPatchString(dto.brand, base.brand),
      modelLine: this.optionalPatchString(dto.modelLine, base.modelLine),
      colorFamily: this.optionalPatchString(dto.colorFamily, base.colorFamily),
      colorway: this.optionalPatchString(dto.colorway, base.colorway),
      shoeType: this.optionalPatchString(dto.shoeType, base.shoeType),
      size: this.optionalPatchString(dto.size, base.size),
      color: this.optionalPatchString(dto.color, base.color),
      styleTags:
        dto.styleTags !== undefined
          ? this.cleanStringArray(dto.styleTags)
          : base.styleTags,
      sceneTags:
        dto.sceneTags !== undefined
          ? this.cleanStringArray(dto.sceneTags)
          : base.sceneTags,
      keywords: nextKeywords,
      confidence:
        typeof dto.confidence === "number" && Number.isFinite(dto.confidence)
          ? Math.max(0, Math.min(1, dto.confidence))
          : base.confidence,
      raw: {
        ...base.raw,
        userEdited: true,
        recognizedProfileOriginal:
          baseRaw.recognizedProfileOriginal ?? {
            category: base.category,
            brand: base.brand ?? null,
            modelLine: base.modelLine ?? null,
            colorFamily: base.colorFamily ?? null,
            colorway: base.colorway ?? null,
            shoeType: base.shoeType ?? null,
            size: base.size ?? null,
            color: base.color ?? null,
          },
        userProfilePatch: {
          ...existingUserPatch,
          ...this.definedProfilePatch(dto),
        },
      },
    };
  }

  private definedProfilePatch(dto: UpdateProductProfileDto) {
    const patch: Record<string, unknown> = {};
    for (const field of [
      "category",
      "brand",
      "modelLine",
      "colorFamily",
      "colorway",
      "shoeType",
      "size",
      "color",
      "styleTags",
      "sceneTags",
      "keywords",
      "confidence",
    ] as const) {
      if (dto[field] !== undefined) patch[field] = dto[field];
    }
    return patch;
  }

  private optionalPatchString(
    value: unknown,
    fallback: string | null | undefined,
  ) {
    if (value === undefined) return fallback ?? null;
    if (value === null) return null;
    return this.toString(value);
  }

  private cleanStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value
          .map((item) => this.toString(item))
          .filter((item): item is string => Boolean(item)),
      ),
    ];
  }

  private withProfileSearchConstraints(
    filters: Record<string, unknown>,
    profile: ProductProfileResult,
  ): Record<string, unknown> {
    const explicitBrands = this.toStringArray(filters.brandsInclude);
    const excludedBrands = this.toStringArray(filters.brandsExclude);
    const profileBrand = this.toString(profile.brand);
    const brand =
      explicitBrands.length === 0 && excludedBrands.length === 0
        ? profileBrand
        : null;
    const shoeType =
      profile.category === "shoe" ? this.toString(profile.shoeType) : null;
    return {
      ...filters,
      ...(brand
        ? { brand, strictBrandScope: true, requireProfileTagMatch: true }
        : {}),
      profileSearchConstraints: {
        brand: brand ?? null,
        shoeType: shoeType ?? null,
        color: null,
        recognizedColorSignal: this.toString(
          profile.colorFamily ?? profile.color ?? profile.colorway,
        ),
        source: "product_profile",
      },
    };
  }

  private hasLightweightSearchSignals(profile: ProductProfileResult) {
    const generalKeywords = new Set(productCategoryKeywords("general"));
    return Boolean(
      this.toString(profile.brand) ||
        this.toString(profile.modelLine) ||
        this.toString(profile.colorFamily) ||
        this.toString(profile.colorway) ||
        this.toString(profile.shoeType) ||
        this.toString(profile.color) ||
        profile.category !== "general" ||
        profile.keywords.some(
          (keyword) =>
            Boolean(this.toString(keyword)) && !generalKeywords.has(keyword),
        ),
    );
  }

  private withResolvedSearchPipelineMode(
    filters: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...filters,
      searchPipelineMode: this.resolveSearchPipelineMode(filters),
    };
  }

  private resolveSearchPipelineMode(
    filters?: Record<string, unknown> | null,
  ): ProductSearchPipelineMode {
    const requested = this.toString(filters?.searchPipelineMode);
    if (
      requested === "current_ann_then_refine" ||
      requested === "light_tag_ann_fusion"
    ) {
      return requested;
    }
    const configured = this.config.get<string>("search.pipelineMode");
    return configured === "light_tag_ann_fusion"
      ? "light_tag_ann_fusion"
      : "current_ann_then_refine";
  }

  private normalizeSupportedCategory(category: unknown, fallback: string) {
    return normalizeProductCategory(category, fallback);
  }

  private categoryRecognitionTimeoutMs() {
    const configured =
      this.config.get<number>("search.categoryRecognitionTimeoutMs") ?? 30000;
    return Number.isFinite(configured) && configured > 0
      ? Math.max(1000, Math.floor(configured))
      : 30000;
  }

  private initialDetailedProfileWaitMs() {
    const configured =
      this.config.get<number>("search.initialDetailedProfileWaitMs") ?? 1500;
    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : 1500;
  }

  private lightweightProfileWaitMs() {
    const configured =
      this.config.get<number>("search.lightweightProfileWaitMs") ??
      this.detailedProfileTimeoutMs();
    return Number.isFinite(configured) && configured > 0
      ? Math.max(1000, Math.floor(configured))
      : this.detailedProfileTimeoutMs();
  }

  private detailedProfileTimeoutMs() {
    const configured =
      this.config.get<number>("search.detailedProfileTimeoutMs") ?? 30000;
    return Number.isFinite(configured) && configured > 0
      ? Math.max(1000, Math.floor(configured))
      : 30000;
  }

  private validateCreateSessionDto(dto: CreateSessionDto) {
    if (!dto || typeof dto !== "object") {
      throw new BadRequestException("SESSION_BODY_REQUIRED");
    }

    if (!dto.assetId) {
      throw new BadRequestException("ASSET_ID_REQUIRED");
    }

    if (dto.categoryHint) normalizeProductCategory(dto.categoryHint);
  }

  private validateCreateTextSessionDto(dto: CreateTextSessionDto) {
    if (!dto || typeof dto !== "object") {
      throw new BadRequestException("TEXT_SESSION_BODY_REQUIRED");
    }
    validateShoppingMessage(dto.message, {
      requiredCode: "TEXT_SESSION_MESSAGE_REQUIRED",
      tooLongCode: "TEXT_SESSION_MESSAGE_TOO_LONG",
    });
    if (dto.categoryHint) normalizeProductCategory(dto.categoryHint);
  }

  private shouldStartProductSearch(message: string) {
    const normalized = message.trim();
    if (
      /^(你好|您好|嗨|哈喽|hello|hi|hey|谢谢|感谢|thanks|thank you|你是谁|你能做什么|在吗|辛苦了)[\s。！？!?]*$/i.test(
        normalized,
      )
    ) {
      return false;
    }
    if (this.isAdviceFirstQuestion(normalized)) {
      return false;
    }
    return /鞋|运动|跑步|跑鞋|篮球鞋|板鞋|休闲鞋|小白鞋|相机|数码相机|单反|微单|耳机|耳麦|蓝牙耳机|智能手表|数码手表|电子手表|手表|手机|智能手机|电脑|笔记本|笔记本电脑|台式机|平板|平板电脑|键盘|机械键盘|鼠标|数码产品|电子产品|sneaker|shoe|shoes|camera|dslr|mirrorless|headphone|headphones|earphone|earbuds|headset|smartwatch|watch|phone|smartphone|iphone|computer|laptop|notebook|desktop|tablet|ipad|keyboard|mouse|nike|耐克|adidas|阿迪|puma|彪马|asics|亚瑟士|new balance|淘宝|天猫|京东|得物|拼多多|预算|价格|价位|有货|现货|旗舰店|官方店|找|搜索|买|推荐|\d{2,5}\s*(元|块|rmb|RMB|¥|以内|以下|以上)/i.test(
      normalized,
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

  private async buildInitialConversationAssistantMessage(input: {
    message: string;
    profile: ProductProfileResult;
    userId: string | null;
    category: string;
  }) {
    if (this.isSimpleGeneralChat(input.message)) {
      return this.buildLocalGeneralChatAssistantMessage(input.message);
    }
    const userMemoryContext = input.userId
      ? await this.userMemoryContext.getContext(input.userId, input.category)
      : null;
    if (this.isAdviceFirstQuestion(input.message)) {
      return this.buildLocalShoppingAdviceAssistantMessage(
        input.message,
        input.profile.category,
        userMemoryContext?.derived ?? null,
      );
    }
    try {
      const prompt = this.promptRegistry.getConversationPrompt(input.category);
      const outputSchema = this.promptRegistry.getFilterOutputSchema();
      const profileSchema = this.profileSchemaRegistry.getProfileSchema(
        input.category,
      );
      const parsed = await this.modelAdapter.parseConversationTurn({
        sessionId: "initial_text_session",
        turnIndex: 0,
        latestUserMessage: input.message,
        productProfile: input.profile,
        effectiveFilter: {},
        userMemoryContext: userMemoryContext as unknown as Record<
          string,
          unknown
        > | null,
        conversationSummary: null,
        recentMessages: [
          {
            turnIndex: 0,
            role: "user",
            content: input.message,
            metadata: { source: "text_session_api" },
            createdAt: new Date().toISOString(),
          },
        ],
        candidateSummary: [],
        prompt,
        outputSchema,
        profileSchema,
      });
      const assistantMessage = parsed.assistantMessage.trim();
      if (
        assistantMessage.length > 0 &&
        (this.isCapabilityQuestion(input.message) ||
          !this.isCapabilityIntroAssistantMessage(assistantMessage))
      ) {
        return assistantMessage;
      }
    } catch {
      // Keep the first-chat endpoint usable when the chat model is unavailable.
    }
    return this.buildLocalGeneralChatAssistantMessage(input.message);
  }

  private isSimpleGeneralChat(message: string) {
    return (
      /^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|谢谢|感谢|thanks|thank you)([，,\s]*(你是谁|你能做什么|介绍一下|有什么用))?[\s。！？!?]*$/i.test(
        message.trim(),
      ) || /你是谁|你能做什么|你可以做什么|介绍一下自己/i.test(message)
    );
  }

  private buildLocalGeneralChatAssistantMessage(message: string) {
    if (this.isCapabilityQuestion(message)) {
      return "我是购物比价助手，可以帮你拍照找同款、比较候选商品、解释推荐原因，也可以按预算、平台和库存继续筛选。";
    }
    if (/累|疲惫|不想|烦|压力|焦虑|写代码|加班/i.test(message)) {
      return "那就先别硬扛了，先休息十分钟，回来只做一个最小任务，比如把报错读明白或先改一个最确定的问题。";
    }
    return "在的，直接说现在想聊什么。";
  }

  private isCapabilityQuestion(message: string) {
    return /你是谁|你能做什么|你可以做什么|怎么用|如何使用|介绍一下/i.test(
      message,
    );
  }

  private isCapabilityIntroAssistantMessage(message: string) {
    return /我在|你可以问我|我可以帮你|拍照找同款|按预算|筛选商品|比较候选|能力|功能/i.test(
      message,
    );
  }

  private buildInitialTextSearchAssistantMessage(input: {
    message: string;
    candidates: CandidateSeed[];
    fallback: SearchResult["fallback"];
    effectiveFilter: Record<string, unknown>;
  }) {
    if (input.fallback || input.candidates.length === 0) {
      return "已按你的描述搜索，但当前条件下暂时没有找到合适商品。你可以放宽预算、平台或颜色条件试试。";
    }

    const subject = this.buildSearchSubject(
      input.message,
      input.effectiveFilter,
    );
    return `好的，已为您搜索 ${subject}，找到 ${input.candidates.length} 个结果。你可以继续说“只看500元以下”“只看黑色”“按价格从低到高”。`;
  }

  private buildLocalShoppingAdviceAssistantMessage(
    message: string,
    category: string,
    memory: UserMemoryContext["derived"] | null,
  ) {
    const normalizedCategory = normalizeProductCategory(category, "general");
    if (normalizedCategory !== "shoe") {
      return this.buildLocalCategoryAdviceAssistantMessage(
        message,
        normalizedCategory,
      );
    }
    const gender = this.extractShoppingGender(message, memory);
    const genderPrefix =
      gender === "male" ? "男生" : gender === "female" ? "女生" : "";

    if (/通勤|上班|上课/i.test(message)) {
      const subject = genderPrefix ? `${genderPrefix}通勤的话` : "通勤鞋的话";
      return `${subject}，我会优先推荐三类：简洁跑鞋、低帮板鞋和德训鞋/复古休闲鞋。每天走路多就优先看缓震和支撑，想更好搭配就选黑白灰、米色这类低调配色。通勤场景重点看舒适、耐脏、低调和好搭配。需要我直接帮你搜索具体商品吗？`;
    }
    if (/跑步|跑鞋|慢跑|长跑|短跑|running/i.test(message)) {
      const subject = genderPrefix ? `${genderPrefix}跑步鞋` : "跑步鞋";
      return `${subject}建议先看缓震、支撑和鞋楦是否合脚。日常慢跑优先选稳定缓震跑鞋，配速训练可以看更轻的训练鞋，脚宽就避开过窄鞋型。需要我按这个方向帮你搜一批具体款吗？`;
    }
    if (/篮球|basketball/i.test(message)) {
      const subject = genderPrefix ? `${genderPrefix}篮球鞋` : "篮球鞋";
      return `${subject}优先看包裹、抓地和侧向支撑。外场多就选耐磨大底，后卫打法可以偏轻快，锋线或体重大一些可以优先缓震和稳定。需要我直接帮你搜索具体商品吗？`;
    }
    if (
      /休闲|日常|逛街|小白鞋|板鞋|德训|复古|casual|lifestyle/i.test(message)
    ) {
      const subject = genderPrefix ? `${genderPrefix}日常休闲鞋` : "日常休闲鞋";
      return `${subject}我会优先看低帮板鞋、复古跑鞋和德训鞋。想百搭就选黑白灰或米色，想显轻快可以选浅色鞋面，日常穿重点看脚感、耐脏和搭配宽容度。需要我按这个方向帮你搜一批具体款吗？`;
    }

    return "选鞋我会先看使用场景、预算、脚感需求和搭配风格。走路多优先缓震和支撑，想百搭优先低调配色，运动场景再按跑步、篮球或训练细分。需要我按这个方向帮你搜一批具体款吗？";
  }

  private buildLocalCategoryAdviceAssistantMessage(
    message: string,
    category: string,
  ) {
    if (category === "computer") {
      const student = /学生|上课|学习|校园|大学|高中/i.test(message);
      if (/笔记本|laptop|notebook|便携/i.test(message) || student) {
        const subject = student ? "学生用电脑" : "笔记本电脑";
        return `${subject}我会先看预算、便携性、续航、性能和售后。上课和宿舍两头带建议优先轻薄本或全能本，至少 16GB 内存和 512GB 固态；如果要剪视频、建模或游戏，再看独显和散热。需要我按这个方向帮你搜索具体型号吗？`;
      }
      return "选电脑我会先看预算、用途、便携性、性能、屏幕和售后。办公学习优先轻薄本，创作和游戏再看独显、散热和扩展能力。需要我按这个方向帮你搜索具体型号吗？";
    }

    const label = getProductCategoryDefinition(category).labelZh;
    if (category === "phone") {
      return "选手机我会先看预算、系统偏好、续航、拍照、性能和存储。日常使用优先续航和手感，游戏或拍照再分别看芯片、散热和影像配置。需要我按这个方向帮你搜索具体机型吗？";
    }
    if (category === "headphones") {
      return "选耳机我会先看佩戴方式、降噪、音质、通话和续航。通勤优先主动降噪和佩戴稳定，运动场景重点看防水和不易掉。需要我按这个方向帮你搜索具体型号吗？";
    }
    return `选${label}我会先看使用场景、预算、核心参数和售后，再按你的偏好缩小范围。需要我按这个方向帮你搜索具体商品吗？`;
  }

  private extractShoppingGender(
    message: string,
    memory: UserMemoryContext["derived"] | null,
  ): "male" | "female" | null {
    return (
      this.normalizeGender(message) ??
      this.normalizeGender(memory?.shoppingGender)
    );
  }

  private normalizeGender(value: unknown): "male" | "female" | null {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!text) return null;
    if (/女|female|women|woman|girl/.test(text)) return "female";
    if (/男|male|men|man|boy/.test(text)) return "male";
    return null;
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

  private normalizeKeywords(keywords: unknown, message: string) {
    const explicit = Array.isArray(keywords)
      ? keywords
          .filter((keyword): keyword is string => typeof keyword === "string")
          .map((keyword) => keyword.trim())
          .filter((keyword) => keyword.length > 0)
      : [];
    const tokens = message
      .split(/[\s,，。；;、.!?？]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    const unique = Array.from(new Set([message, ...explicit, ...tokens]));
    return unique.slice(0, 12);
  }

  private buildTextProfile(
    message: string,
    keywords: string[],
    memory: UserMemoryContext["derived"] | null,
    categoryHint = "general",
  ): ProductProfileResult {
    const lower = message.toLowerCase();
    const normalizedHint = normalizeProductCategory(categoryHint, "general");
    const category =
      normalizedHint === "general"
        ? normalizeProductCategory(message, "general")
        : normalizedHint;
    const colorFamily = extractColorHeuristic(message);
    const memoryColor =
      memory?.preferredColors.length === 1 ? memory.preferredColors[0] : null;
    const preferredBrands =
      category === "shoe" ? (memory?.favoriteBrands ?? []) : [];
    return {
      category,
      brand: this.extractBrand(message),
      modelLine: null,
      colorFamily: colorFamily ?? memoryColor,
      colorway: null,
      shoeType:
        category === "shoe" && /跑鞋|running/.test(lower) ? "running" : null,
      size:
        category === "shoe"
          ? (this.extractShoeSize(message) ?? memory?.shoeSize ?? null)
          : null,
      color: colorFamily ?? memoryColor,
      styleTags: [],
      sceneTags: [],
      keywords:
        keywords.length > 0 ? keywords : productCategoryKeywords(category),
      confidence: 0.62,
      raw: {
        source: "text_query",
        userMessage: message,
        preferredBrands,
      },
    };
  }

  private buildDefaultFilterFromMemory(
    memory: UserMemoryContext["derived"],
    categoryHint = "general",
  ): Record<string, unknown> {
    const category = normalizeProductCategory(categoryHint, "general");
    const filter: Record<string, unknown> = {
      platformsExclude: memory.excludedPlatforms.map((platform) =>
        this.normalizePlatform(platform),
      ),
    };
    const preferredPlatforms = memory.preferredPlatforms
      .map((platform) => this.normalizePlatform(platform))
      .filter((platform) => platform.length > 0);
    if (preferredPlatforms.length > 0) {
      filter.platformsInclude = [...new Set(preferredPlatforms)];
    }
    if (memory.preferredColors.length === 1)
      filter.color = memory.preferredColors[0];
    if (category === "shoe" && memory.shoeSize) filter.size = memory.shoeSize;
    return filter;
  }

  private buildInitialTextFilter(
    message: string,
    userMemoryFilter: Record<string, unknown>,
    explicitFilter?: Record<string, unknown>,
  ): Record<string, unknown> {
    return this.withResolvedSearchPipelineMode({
      sortRule: "relevance_desc",
      stockOnly: false,
      ...userMemoryFilter,
      ...analyzeShoppingLanguage(message).filterPatch,
      ...(explicitFilter ?? {}),
    });
  }

  private filterFromText(message: string): Record<string, unknown> {
    return extractShoppingFilterPatch(message);
  }

  private extractPriceMax(message: string) {
    return extractPriceMaxHeuristic(message);
  }

  private extractPlatforms(message: string) {
    return extractMentionedPlatforms(message);
  }

  private extractBrand(message: string) {
    return extractBrandHeuristic(message);
  }

  private extractShoeSize(message: string) {
    return extractShoeSizeHeuristic(message);
  }

  private normalizePlatform(platform: string) {
    return normalizePlatformKey(platform) ?? platform.trim().toLowerCase();
  }

  private hashVector(vector: number[]) {
    return createHash("sha256").update(JSON.stringify(vector)).digest("hex");
  }

  private recognitionCacheKey(input: {
    asset: Pick<ImageAsset, "id" | "bucketGroup" | "objectKey">;
    categoryHint: string;
    box?: unknown;
  }) {
    const assetIdentity =
      input.asset.bucketGroup && input.asset.objectKey
        ? `asset-${stableHash({
            bucketGroup: input.asset.bucketGroup,
            objectKey: input.asset.objectKey,
          })}`
        : `id-${input.asset.id}`;
    const boxHash = input.box ? stableHash(input.box) : null;
    return boxHash
      ? `recognition:${assetIdentity}:${input.categoryHint}:${boxHash}`
      : `recognition:${assetIdentity}:${input.categoryHint}`;
  }

  private async safeCacheGet<T>(key: string): Promise<T | null> {
    try {
      return await this.cache.get<T>(key);
    } catch {
      return null;
    }
  }

  private async safeCacheSet<T>(key: string, value: T, ttlSeconds: number) {
    try {
      await this.cache.set(key, value, ttlSeconds);
    } catch {
      // Cache is an acceleration layer; session persistence must not depend on it.
    }
  }

  private async searchShoesWithFallback(input: {
    keywords: string[];
    filters?: Record<string, unknown>;
    profile?: ProductProfileResult;
    assetId?: string;
    queryEmbedding?: number[];
    queryImageUrl?: string | null;
    embeddingKind?: "visual" | "multimodal";
    limit?: number;
  }): Promise<SearchResult> {
    try {
      const candidates = await this.searchProvider.searchShoes({
        ...input,
        limit: input.limit ?? this.searchPrefetchLimit(),
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

  private async searchFastAnnShoesWithFallback(input: {
    keywords: string[];
    filters?: Record<string, unknown>;
    profile?: ProductProfileResult;
    assetId?: string;
    queryEmbedding: number[];
    queryImageUrl?: string | null;
    category?: string | null;
    embeddingKind?: "visual" | "multimodal";
    limit?: number;
  }): Promise<SearchResult> {
    try {
      const candidates = this.searchProvider.searchFastAnnShoes
        ? await this.searchProvider.searchFastAnnShoes({
            ...input,
            limit: input.limit ?? this.searchPrefetchLimit(),
          })
        : await this.searchProvider.searchShoes({
            ...input,
            limit: input.limit ?? this.searchPrefetchLimit(),
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

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        setTimeout(() => reject(new Error("SESSION_TASK_TIMEOUT")), timeoutMs);
      }),
    ]);
  }

  private delay(timeoutMs: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  }

  private async writeCandidateSnapshot(input: {
    sessionId: string;
    turnIndex: number;
    candidates: CandidateSeed[];
    fallback: SearchResult["fallback"];
    appliedFilter: Record<string, unknown>;
    extraAppliedFilter?: Record<string, unknown>;
  }) {
    const candidateSnapshotId = createId("cand_snap");
    await this.prisma.$transaction(async (tx) => {
      await tx.candidateSnapshot.create({
        data: {
          id: candidateSnapshotId,
          sessionId: input.sessionId,
          turnIndex: input.turnIndex,
          degraded: input.fallback !== null,
          appliedFilterJson: toJsonString({
            ...input.appliedFilter,
            ...(input.extraAppliedFilter ?? {}),
            fallbackReason: input.fallback?.reason ?? null,
          }),
        },
      });

      const itemData = input.candidates.map((item, index) =>
        this.candidateItemAdapter.toCandidateItemCreateManyData({
          snapshotId: candidateSnapshotId,
          item,
          rank: index + 1,
          pageIndex: Math.floor(index / this.initialReturnLimit()),
        }),
      );
      if (itemData.length > 0) {
        await tx.candidateItem.createMany({ data: itemData });
      }

      if (input.fallback) {
        await tx.fallbackSnapshot.create({
          data: {
            id: createId("fallback_snap"),
            sessionId: input.sessionId,
            reason: input.fallback.reason,
            payloadJson: toJsonString(input.fallback),
          },
        });
      }
    });
    return candidateSnapshotId;
  }

  private toString(value: unknown) {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
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

  private normalizePositiveLimit(value: unknown, fallback: number) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }
}
