import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CandidateItem } from "@prisma/client";
import { createId } from "../../../common/utils/id";
import {
  SEARCH_PROVIDER,
  SearchProvider,
} from "../../../adapters/search-provider/search-provider.interface";
import { PrismaService } from "../../../persistence/prisma/prisma.service";
import { MoreCandidatesDto } from "../dto/more-candidates.dto";
import { ShortlistCandidateDto } from "../dto/shortlist-candidate.dto";
import { TrendOutfitService } from "../../trend-outfit/application/trend-outfit.service";
import {
  CANDIDATE_CURSOR_ADAPTER,
  CandidateCursorAdapter,
} from "./candidate-cursor-adapter.interface";
import {
  CANDIDATE_ITEM_ADAPTER,
  CandidateItemAdapter,
} from "./candidate-item-adapter.interface";
import {
  CANDIDATE_SEARCH_CONTEXT_ADAPTER,
  CandidateSearchContextAdapter,
} from "./candidate-search-context-adapter.interface";
import {
  CANDIDATE_VIEW_ADAPTER,
  CandidateViewAdapter,
} from "./candidate-view-adapter.interface";

@Injectable()
export class CandidatesService {
  private readonly logger = new Logger(CandidatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SEARCH_PROVIDER)
    private readonly searchProvider: SearchProvider,
    @Inject(CANDIDATE_CURSOR_ADAPTER)
    private readonly candidateCursorAdapter: CandidateCursorAdapter,
    @Inject(CANDIDATE_ITEM_ADAPTER)
    private readonly candidateItemAdapter: CandidateItemAdapter,
    @Inject(CANDIDATE_SEARCH_CONTEXT_ADAPTER)
    private readonly candidateSearchContextAdapter: CandidateSearchContextAdapter,
    @Inject(CANDIDATE_VIEW_ADAPTER)
    private readonly candidateViewAdapter: CandidateViewAdapter,
    private readonly config: ConfigService,
    private readonly trendOutfitService: TrendOutfitService,
  ) {}

  emptyCandidateSet(appliedFilter: Record<string, unknown>) {
    return {
      candidateSnapshotId: null,
      degraded: false,
      appliedFilter,
      fallback: null,
      cursor: null,
      sortOptions: this.candidateViewAdapter.buildSortOptions(),
      searchProgress: this.candidateViewAdapter.buildSearchProgress([]),
      requiredInfo:
        this.candidateViewAdapter.buildRequiredInfoView(appliedFilter),
      items: [],
    };
  }

  async getCurrentCandidates(sessionId: string) {
    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");

    const snapshot = await this.prisma.candidateSnapshot.findFirst({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { items: true } },
        items: {
          orderBy: [{ rank: "asc" }, { amount: "asc" }],
          take: this.initialReturnLimit(),
        },
      },
    });
    if (!snapshot) throw new NotFoundException("CANDIDATE_SNAPSHOT_NOT_FOUND");

    const fallbackSnapshot = snapshot.degraded
      ? await this.prisma.fallbackSnapshot.findFirst({
          where: { sessionId },
          orderBy: { createdAt: "desc" },
        })
      : null;
    const items = snapshot.items.map((item, index) =>
      this.candidateViewAdapter.buildCandidateView(
        item,
        snapshot.items,
        index + 1,
      ),
    );
    const cursor = await this.candidateCursorAdapter.findActive(snapshot.id);
    const appliedFilter = this.candidateViewAdapter.buildAppliedFilterView(
      snapshot.appliedFilterJson,
    );

    return {
      candidateSnapshotId: snapshot.id,
      degraded: snapshot.degraded,
      appliedFilter,
      fallback: snapshot.degraded
        ? this.candidateViewAdapter.buildFallbackView(
            fallbackSnapshot?.payloadJson ?? null,
          )
        : null,
      cursor: cursor
        ? this.candidateCursorAdapter.buildCursorSummaryView(cursor)
        : null,
      sortOptions: this.candidateViewAdapter.buildSortOptions(),
      searchProgress: this.candidateViewAdapter.buildSearchProgress(
        items as Array<{ platformName: string; candidateItemId: string }>,
      ),
      requiredInfo: this.candidateViewAdapter.buildRequiredInfoView(appliedFilter),
      items,
    };
  }

  async getMoreCandidates(sessionId: string, dto: MoreCandidatesDto) {
    const limit = this.candidateCursorAdapter.normalizeLimit(dto.limit);
    const context = await this.buildMoreContext(sessionId, dto.cursor, limit);
    const previousOffset = Math.max(0, context.cursor.offset);
    if (
      context.cursor.exhausted &&
      previousOffset >= context.snapshot.items.length
    ) {
      return {
        candidateSnapshotId: context.snapshot.id,
        cursor: this.candidateCursorAdapter.buildCursorView(
          context.cursor,
          previousOffset,
          previousOffset,
        ),
        items: [],
      };
    }

    const snapshotPageItems = this.sliceSnapshotPage(
      context.snapshot.items,
      previousOffset,
      limit,
    );
    const requestedFallbackCount = limit - snapshotPageItems.length;
    let fallbackAttempted = false;
    let fallbackReturnedCount = 0;
    let appendedItems: CandidateItem[] = [];

    if (
      requestedFallbackCount > 0 &&
      context.fallbackSearchAllowed &&
      !context.cursor.exhausted &&
      this.searchProvider.searchMoreShoes
    ) {
      fallbackAttempted = true;
      const moreCandidates = await this.searchProvider.searchMoreShoes({
        keywords: context.keywords,
        filters: context.filterRaw,
        profile: context.profile,
        queryEmbedding: context.queryEmbedding,
        queryImageUrl: null,
        embeddingKind:
          context.preprocess?.selectionSource === "text_query" ||
          context.preprocess?.selectionSource === "text_turn"
            ? "multimodal"
            : "visual",
        excludeProductKeys: context.excludeProductKeys,
        limit: requestedFallbackCount,
      });
      fallbackReturnedCount = moreCandidates.length;
      const startRank = context.snapshot.items.length + 1;
      const createData = moreCandidates.map((item, index) =>
        this.candidateItemAdapter.toCandidateItemCreateManyData({
          snapshotId: context.snapshot.id,
          item,
          rank: startRank + index,
          pageIndex: Math.floor((startRank + index - 1) / limit),
        }),
      );

      if (createData.length > 0) {
        await this.prisma.candidateItem.createMany({ data: createData });
      }

      appendedItems =
        createData.length > 0
          ? await this.prisma.candidateItem.findMany({
              where: {
                snapshotId: context.snapshot.id,
                rank: {
                  gte: startRank,
                  lt: startRank + createData.length,
                },
              },
              orderBy: [{ rank: "asc" }, { amount: "asc" }],
            })
          : [];
    }

    const allItems = [...context.snapshot.items, ...appendedItems];
    const returnedItems = [...snapshotPageItems, ...appendedItems].slice(
      0,
      limit,
    );
    const newOffset = previousOffset + returnedItems.length;
    const exhausted = this.isCursorExhaustedAfterPage({
      cursorWasExhausted: context.cursor.exhausted,
      fallbackSearchAllowed: context.fallbackSearchAllowed,
      fallbackAttempted,
      fallbackRequestedCount: requestedFallbackCount,
      fallbackReturnedCount,
      newOffset,
      totalCandidateCount: allItems.length,
    });
    const cursor = await this.candidateCursorAdapter.updateAfterAppend({
      cursor: context.cursor,
      requestedLimit: limit,
      returnedCount: returnedItems.length,
      newOffset,
      exhausted,
    });
    const returnedFromRank =
      returnedItems.length > 0 ? previousOffset + 1 : newOffset;

    return {
      candidateSnapshotId: context.snapshot.id,
      cursor: this.candidateCursorAdapter.buildCursorView(
        cursor,
        returnedFromRank,
        newOffset,
      ),
      items: returnedItems.map((item, index) =>
        this.candidateViewAdapter.buildCandidateView(
          item,
          allItems,
          item.rank ?? previousOffset + index + 1,
        ),
      ),
    };
  }

  async createPaginationCursorForSnapshot(input: {
    sessionId: string;
    candidateSnapshotId: string;
    preprocessSnapshotId?: string | null;
    filter: Record<string, unknown>;
    offset: number;
    limit?: number;
    sortRule?: string | null;
    totalCandidates?: number;
    fallbackSearchAllowed?: boolean;
  }) {
    const totalCandidates = input.totalCandidates ?? input.offset;
    return this.candidateCursorAdapter.createForSnapshot({
      ...input,
      exhausted:
        input.offset >= totalCandidates && input.fallbackSearchAllowed !== true,
    });
  }

  async getCandidateDetail(candidateItemId: string) {
    const item = await this.prisma.candidateItem.findUnique({
      where: { id: candidateItemId },
      include: {
        snapshot: {
          include: {
            items: { orderBy: [{ rank: "asc" }, { amount: "asc" }] },
          },
        },
      },
    });
    if (!item) throw new NotFoundException("CANDIDATE_ITEM_NOT_FOUND");

    const priceRank =
      item.snapshot.items.findIndex((candidate) => candidate.id === item.id) +
      1;
    return this.candidateViewAdapter.buildCandidateDetailView(
      item,
      item.snapshot.items,
      priceRank,
    );
  }

  async getSessionCart(sessionId: string) {
    const session = this.toString(sessionId);
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");

    const exists = await this.prisma.querySession.findUnique({
      where: { id: session },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("SESSION_NOT_FOUND");

    const cartItems = await this.prisma.sessionCartItem.findMany({
      where: { sessionId: session },
      orderBy: [{ createdAt: "asc" }],
      include: {
        candidateItem: {
          include: {
            snapshot: {
              include: {
                items: { orderBy: [{ rank: "asc" }, { amount: "asc" }] },
              },
            },
          },
        },
      },
    });

    const items = cartItems.map((cartItem, index) =>
      this.candidateViewAdapter.buildCandidateView(
        cartItem.candidateItem,
        cartItem.candidateItem.snapshot.items,
        cartItem.candidateItem.rank ?? index + 1,
      ),
    );

    return {
      sessionId: session,
      count: items.length,
      items,
    };
  }

  async shortlistCandidate(
    sessionId: string,
    candidateItemId: string,
    dto: ShortlistCandidateDto = {},
  ) {
    const session = this.toString(sessionId);
    const candidate = this.toString(candidateItemId);
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");
    if (!candidate) throw new NotFoundException("CANDIDATE_ITEM_NOT_FOUND");

    const item = await this.prisma.candidateItem.findFirst({
      where: {
        id: candidate,
        snapshot: {
          sessionId: session,
        },
      },
      select: {
        id: true,
      },
    });
    if (!item) throw new NotFoundException("CANDIDATE_ITEM_NOT_FOUND");
    const source = this.toString(dto.source) ?? "unknown";

    await this.prisma.sessionCartItem.upsert({
      where: {
        sessionId_candidateItemId: {
          sessionId: session,
          candidateItemId: candidate,
        },
      },
      update: { source },
      create: {
        id: createId("cart_item"),
        sessionId: session,
        candidateItemId: candidate,
        source,
      },
    });

    void this.trendOutfitService
      .prewarmForCandidate({
        sessionId: session,
        candidateItemId: candidate,
        limit: this.normalizeTrendLimit(dto.limit),
      })
      .catch((error) => {
        this.logger.warn(
          `trend outfit prewarm failed for candidate ${candidate}: ${this.errorMessage(error)}`,
        );
      });

    return {
      sessionId: session,
      candidateItemId: candidate,
      selected: true,
      source,
      cart: {
        status: "stored",
      },
      trendOutfitPrewarm: {
        status: "queued",
        cacheTarget: "trend:recommend",
      },
    };
  }

  async removeFromSessionCart(sessionId: string, candidateItemId: string) {
    const session = this.toString(sessionId);
    const candidate = this.toString(candidateItemId);
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");
    if (!candidate) throw new NotFoundException("CANDIDATE_ITEM_NOT_FOUND");

    const deleted = await this.prisma.sessionCartItem.deleteMany({
      where: {
        sessionId: session,
        candidateItemId: candidate,
      },
    });

    return {
      sessionId: session,
      candidateItemId: candidate,
      selected: false,
      removed: deleted.count > 0,
    };
  }

  private async buildMoreContext(
    sessionId: string,
    cursorId: string | undefined,
    limit: number,
  ) {
    const session = await this.prisma.querySession.findUnique({
      where: { id: sessionId },
      include: {
        profileSnapshot: true,
        filterSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
        queryImagePreprocessSnapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        candidateSnapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { items: { orderBy: [{ rank: "asc" }, { amount: "asc" }] } },
        },
      },
    });
    if (!session) throw new NotFoundException("SESSION_NOT_FOUND");

    const snapshot = session.candidateSnapshots[0];
    if (!snapshot) throw new NotFoundException("CANDIDATE_SNAPSHOT_NOT_FOUND");

    const preprocess = session.queryImagePreprocessSnapshots[0] ?? null;
    const queryEmbedding =
      preprocess && preprocess.status === "ready"
        ? this.candidateSearchContextAdapter.toQueryEmbedding(preprocess)
        : [];

    const activeFilter = session.filterSnapshots[0] ?? null;
    const filterRaw =
      this.candidateSearchContextAdapter.toFilterRaw(activeFilter);
    const fallbackSearchAllowed = Boolean(
      this.searchProvider.searchMoreShoes &&
      preprocess &&
      preprocess.status === "ready" &&
      queryEmbedding.length > 0,
    );
    const usableCursor = await this.candidateCursorAdapter.resolveForSnapshot({
      cursorId,
      sessionId,
      candidateSnapshotId: snapshot.id,
      preprocessSnapshotId: preprocess?.id ?? null,
      filter: filterRaw,
      offset: Math.min(this.initialReturnLimit(), snapshot.items.length),
      limit,
      sortRule: this.toString(filterRaw.sortRule),
    });

    const profile = this.candidateSearchContextAdapter.toProfile(
      session.profileSnapshot,
    );
    const keywords = this.candidateSearchContextAdapter.toKeywords(
      session.profileSnapshot,
    );

    return {
      session,
      snapshot,
      preprocess,
      cursor: usableCursor,
      profile,
      keywords,
      filterRaw,
      queryEmbedding,
      excludeProductKeys: this.candidateItemAdapter.extractReturnedProductKeys(
        snapshot.items,
      ),
      fallbackSearchAllowed,
    };
  }

  private sliceSnapshotPage(
    items: CandidateItem[],
    consumedOffset: number,
    limit: number,
  ) {
    return [...items]
      .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0))
      .slice(consumedOffset, consumedOffset + limit);
  }

  private isCursorExhaustedAfterPage(input: {
    cursorWasExhausted: boolean;
    fallbackSearchAllowed: boolean;
    fallbackAttempted: boolean;
    fallbackRequestedCount: number;
    fallbackReturnedCount: number;
    newOffset: number;
    totalCandidateCount: number;
  }) {
    if (input.newOffset < input.totalCandidateCount) return false;
    if (input.fallbackAttempted) {
      return input.fallbackReturnedCount < input.fallbackRequestedCount;
    }
    if (input.cursorWasExhausted) return true;
    return !input.fallbackSearchAllowed;
  }

  private initialReturnLimit() {
    const configured =
      this.config.get<number>("search.initialReturnLimit") ?? 30;
    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed <= 0) return 30;
    return Math.floor(parsed);
  }

  private toString(value: unknown) {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private normalizeTrendLimit(value: unknown) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 4;
    return Math.min(8, Math.floor(parsed));
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
