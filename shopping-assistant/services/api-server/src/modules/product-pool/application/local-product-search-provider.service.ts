import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, Product } from "@prisma/client";
import {
  ProductProfileResult,
  CandidateVisualVerificationResult,
} from "../../../adapters/model/model-adapter.interface";
import {
  CandidateSeed,
  FastAnnSearchInput,
  SearchMoreInput,
  SearchProvider,
} from "../../../adapters/search-provider/search-provider.interface";
import { OBJECT_STORAGE_ADAPTER } from "../../../adapters/storage/storage.constants";
import { StorageAdapter } from "../../../adapters/storage/storage-adapter.interface";
import { CACHE_STORE } from "../../../cache/cache.constants";
import { stableHash } from "../../../cache/cache-key.util";
import { CacheStore } from "../../../cache/interfaces/cache-store.interface";
import { fromJson } from "../../../common/utils/json";
import { platformComparisonKey } from "../../../common/platforms/platform-normalization";
import { PrismaService } from "../../../persistence/prisma/prisma.service";
import {
  ANN_SEARCH_PORT,
  AnnSearchPort,
  AnnSearchResult,
} from "./ann-search-port.interface";
import {
  CANDIDATE_VISUAL_VERIFICATION_ADAPTER,
  CandidateVisualVerificationAdapter,
} from "./candidate-visual-verification-adapter.interface";
import {
  PRODUCT_SEARCH_RESULT_ADAPTER,
  ProductSearchResultAdapter,
} from "./product-search-result-adapter.interface";
import {
  PRODUCT_SEARCH_SIGNALS_ADAPTER,
  ProductSearchSignalsAdapter,
} from "./product-search-signals-adapter.interface";
import {
  SEARCH_QUERY_EMBEDDING_ADAPTER,
  SearchQueryEmbeddingAdapter,
} from "./search-query-embedding-adapter.interface";
import {
  normalizeProductCategory,
  normalizeProductCategoryOrNull,
  productCategoryKeywords,
  productCategoryMatches,
} from "../../../common/catalog/product-categories";

interface RecallCandidate {
  product: Product;
  styleId: string | null;
  recallSources: Set<"tag" | "ann">;
  tagMatchScore: number;
  annScore: number;
  rawAnnScore: number;
  annPassedMinScore: boolean;
  businessScore: number;
  initialScore: number;
  embeddingId?: string | null;
  imageRole?: string | null;
  embeddingKind?: string | null;
  embeddingProvider?: string | null;
}

interface VerifiedCandidate extends RecallCandidate {
  visualVerifyScore: number;
  finalScore: number;
  verification: CandidateVisualVerificationResult;
  coverImageUrl: string;
}

interface PriceStats {
  min: number;
  max: number;
}

const SEARCH_RESULTS_TTL_SECONDS = 20 * 60;
const EMPTY_SEARCH_RESULTS_TTL_SECONDS = 2 * 60;
const SEARCH_RESULT_POLICY_VERSION =
  "tag_then_ann_v3_match_only_backfill_v1";

@Injectable()
export class LocalProductSearchProviderService implements SearchProvider {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ANN_SEARCH_PORT)
    private readonly annSearch: AnnSearchPort,
    @Inject(SEARCH_QUERY_EMBEDDING_ADAPTER)
    private readonly queryEmbeddingAdapter: SearchQueryEmbeddingAdapter,
    @Inject(PRODUCT_SEARCH_RESULT_ADAPTER)
    private readonly searchResultAdapter: ProductSearchResultAdapter,
    @Inject(PRODUCT_SEARCH_SIGNALS_ADAPTER)
    private readonly productSignals: ProductSearchSignalsAdapter,
    @Inject(CANDIDATE_VISUAL_VERIFICATION_ADAPTER)
    private readonly visualVerificationAdapter: CandidateVisualVerificationAdapter,
    @Inject(OBJECT_STORAGE_ADAPTER)
    private readonly storage: StorageAdapter,
    @Inject(CACHE_STORE)
    private readonly cache: CacheStore,
    private readonly config: ConfigService,
  ) {}

  async searchShoes(input: {
    keywords: string[];
    filters?: Record<string, unknown>;
    profile?: ProductProfileResult | null;
    queryEmbedding?: number[];
    queryImageUrl?: string | null;
    assetId?: string;
    embeddingKind?: "visual" | "multimodal";
    limit?: number;
  }): Promise<CandidateSeed[]> {
    const searchInput = {
      ...input,
      excludeProductKeys: [],
      limit: input.limit ?? this.globalCandidateLimit(),
    };
    if (this.shouldBypassSearchResultCache(input)) {
      return this.searchInternal(searchInput);
    }
    return this.withCandidateCache(
      this.searchResultsCacheKey("search:shoes", {
        keywords: input.keywords,
        filters: input.filters ?? {},
        profile: input.profile ?? null,
        embeddingKind:
          input.embeddingKind ??
          (input.queryImageUrl ? this.annEmbeddingKind() : "multimodal"),
        queryEmbedding: input.queryEmbedding,
        excludeProductKeys: [],
        limit: this.normalizeResultLimit(searchInput.limit),
      }),
      () => this.searchInternal(searchInput),
    );
  }

  async searchFastAnnShoes(
    input: FastAnnSearchInput,
  ): Promise<CandidateSeed[]> {
    const searchInput = {
      ...input,
      excludeProductKeys: input.excludeProductKeys ?? [],
      limit: input.limit ?? this.globalCandidateLimit(),
    };
    return this.withCandidateCache(
      this.searchResultsCacheKey("search:fast-ann-shoes", {
        keywords: input.keywords,
        filters: input.filters ?? {},
        profile: input.profile ?? null,
        embeddingKind: input.embeddingKind ?? this.annEmbeddingKind(),
        queryEmbedding: input.queryEmbedding,
        excludeProductKeys: searchInput.excludeProductKeys,
        limit: this.normalizeResultLimit(searchInput.limit),
        category: input.category ?? null,
      }),
      () => this.searchAnnOnly(searchInput),
    );
  }

  async searchMoreShoes(input: SearchMoreInput): Promise<CandidateSeed[]> {
    return this.searchInternal(input);
  }

  private async searchAnnOnly(
    input: FastAnnSearchInput,
  ): Promise<CandidateSeed[]> {
    const resultLimit = this.normalizeResultLimit(input.limit);
    const excludedKeys = new Set(input.excludeProductKeys ?? []);
    const recallWindow = this.recallWindow({
      resultLimit,
      excludedCount: excludedKeys.size,
      imageSearch: true,
    });
    const profile = input.profile ?? this.profileFromKeywords(input.keywords);
    const filters = this.withProfileBrandScope(input.filters ?? {}, profile);
    const categoryScope =
      input.category ?? this.toString(filters.categoryScope) ?? profile.category;
    let products = await this.loadVerifiedProducts({
      filters,
      category: categoryScope,
    });
    if (products.length === 0 && this.isSpecificCategory(categoryScope)) {
      products = await this.loadVerifiedProducts({ filters, category: null });
    }
    if (products.length === 0 || input.queryEmbedding.length === 0) return [];

    const filteredByUser = this.applyUserFilters(products, filters);
    if (filteredByUser.length === 0) return [];

    let scopedProducts = this.applyCategoryScope(
      filteredByUser,
      categoryScope,
    );
    if (scopedProducts.length === 0) scopedProducts = filteredByUser;
    const priceStats = this.computePriceStats(scopedProducts);
    const annResults = await this.recallByAnn({
      queryEmbedding: input.queryEmbedding,
      productIds: scopedProducts.map((product) => product.id),
      topK: recallWindow,
      embeddingKind: input.embeddingKind ?? this.annEmbeddingKind(),
    });
    const tagResults = this.hasMeaningfulProfile(profile)
      ? this.recallByTags(scopedProducts, profile, priceStats, recallWindow)
      : [];
    const fusedCandidates = this.fuseCandidates({
      products: scopedProducts,
      tagResults,
      annResults,
      priceStats,
    })
      .filter(
        (candidate) =>
          !excludedKeys.has(
            this.fusionKey(candidate.product.id, candidate.styleId),
          ),
      )
      .filter((candidate) =>
        this.passesProfileCandidate(candidate, profile, filters),
      )
      .sort(
        (a, b) => b.initialScore - a.initialScore || b.annScore - a.annScore,
      )
      .slice(0, resultLimit);

    const fastPath = await Promise.all(
      fusedCandidates.map((candidate) =>
        this.fastVerify(candidate, "fast_ann_only"),
      ),
    );

    return fastPath
      .filter(
        (candidate) =>
          candidate.finalScore >=
          Math.max(this.imageBackfillMinScore(), this.resultMinScore()),
      )
      .sort((a, b) => this.compareVerifiedCandidates(a, b, filters))
      .slice(0, resultLimit)
      .map((candidate) => this.searchResultAdapter.toCandidateSeed(candidate));
  }

  private async searchInternal(input: {
    keywords: string[];
    filters?: Record<string, unknown>;
    profile?: ProductProfileResult | null;
    queryEmbedding?: number[];
    queryImageUrl?: string | null;
    assetId?: string;
    embeddingKind?: "visual" | "multimodal";
    excludeProductKeys?: string[];
    limit?: number;
  }): Promise<CandidateSeed[]> {
    const resultLimit = this.normalizeResultLimit(input.limit);
    const excludedKeys = new Set(input.excludeProductKeys ?? []);
    const queryImageUrl =
      input.queryImageUrl ??
      (input.assetId ? await this.getImageUrlForAsset(input.assetId) : null);
    const imageSearch = Boolean(
      queryImageUrl || input.assetId || input.embeddingKind === "visual",
    );
    const recallWindow = this.recallWindow({
      resultLimit,
      excludedCount: excludedKeys.size,
      imageSearch,
    });
    const profile = input.profile ?? this.profileFromKeywords(input.keywords);
    const filters = this.withProfileBrandScope(input.filters ?? {}, profile);
    const categoryScope = this.toString(filters.categoryScope) ?? profile.category;
    let products = await this.loadVerifiedProducts({
      filters,
      category: categoryScope,
    });
    if (
      products.length === 0 &&
      imageSearch &&
      this.isSpecificCategory(categoryScope)
    ) {
      products = await this.loadVerifiedProducts({ filters, category: null });
    }
    if (products.length === 0) return [];

    const filteredByUser = this.applyUserFilters(products, filters);
    if (filteredByUser.length === 0) return [];

    let scopedProducts = this.applyCategoryScope(
      filteredByUser,
      categoryScope,
    );
    if (scopedProducts.length === 0) {
      if (!imageSearch) return [];
      scopedProducts = filteredByUser;
    }
    const priceStats = this.computePriceStats(scopedProducts);

    const tagResults = this.recallByTags(
      scopedProducts,
      profile,
      priceStats,
      recallWindow,
    );
    if (tagResults.length === 0 && !imageSearch) return [];
    const tagProductIds =
      tagResults.length > 0
        ? this.uniqueProductIds(tagResults)
        : scopedProducts.map((product) => product.id);
    const queryEmbedding = input.queryEmbedding
      ? input.queryEmbedding
      : await this.queryEmbeddingAdapter.buildQueryEmbedding({
          keywords: input.keywords,
          profile,
          queryImageUrl,
        });

    const annResults = await this.recallByAnn({
      queryEmbedding,
      productIds: tagProductIds,
      topK: recallWindow,
      embeddingKind:
        input.embeddingKind ??
        (queryImageUrl ? this.annEmbeddingKind() : "multimodal"),
    });
    const fusedCandidates = this.fuseCandidates({
      products: scopedProducts,
      tagResults,
      annResults,
      priceStats,
    })
      .filter(
        (candidate) =>
          !excludedKeys.has(
            this.fusionKey(candidate.product.id, candidate.styleId),
          ),
      )
      .sort((a, b) => b.initialScore - a.initialScore);

    const strictCandidates = fusedCandidates
      .filter((candidate) =>
        this.passesProfileCandidate(candidate, profile, filters),
      )
      .filter((candidate) =>
        imageSearch
          ? candidate.recallSources.has("ann") ||
            candidate.recallSources.has("tag")
          : candidate.recallSources.has("tag"),
      )
      .sort(
        (a, b) =>
          b.annScore - a.annScore ||
          b.tagMatchScore - a.tagMatchScore ||
          b.initialScore - a.initialScore,
      )
      .slice(0, Math.max(resultLimit, this.annTopK()));

    if (strictCandidates.length === 0 && !imageSearch) return [];

    let ranked = await this.buildRankedResults({
      candidates: strictCandidates,
      profile,
      queryImageUrl,
      filters,
      resultLimit,
      minScore: imageSearch ? this.resultMinScore() : 0,
    });

    if (
      imageSearch &&
      ranked.length < this.imageBackfillMinResultCount(resultLimit)
    ) {
      ranked = await this.backfillImageResults({
        ranked,
        fusedCandidates,
        profile,
        queryImageUrl,
        filters,
        resultLimit,
      });
    }

    return ranked
      .slice(0, resultLimit)
      .map((candidate) => this.searchResultAdapter.toCandidateSeed(candidate));
  }

  private async buildRankedResults(input: {
    candidates: RecallCandidate[];
    profile: ProductProfileResult;
    queryImageUrl: string | null;
    filters: Record<string, unknown>;
    resultLimit: number;
    minScore: number;
  }) {
    if (input.candidates.length === 0) return [];

    const topForVision = input.candidates.slice(
      0,
      this.visualVerifyMaxCandidates(input.resultLimit),
    );
    const verified = await this.verifyConcurrently(
      topForVision,
      input.profile,
      input.queryImageUrl,
    );
    const visionAttemptedKeys = new Set(
      topForVision.map((candidate) => this.candidateKey(candidate)),
    );

    const fastPath = await Promise.all(
      input.candidates
        .filter(
          (candidate) => !visionAttemptedKeys.has(this.candidateKey(candidate)),
        )
        .slice(0, input.resultLimit)
        .map((candidate) => this.fastVerify(candidate)),
    );

    return this.rankVerifiedResults(
      [...verified, ...fastPath],
      input.filters,
      input.resultLimit,
      input.minScore,
    );
  }

  private async backfillImageResults(input: {
    ranked: VerifiedCandidate[];
    fusedCandidates: RecallCandidate[];
    profile: ProductProfileResult;
    queryImageUrl: string | null;
    filters: Record<string, unknown>;
    resultLimit: number;
  }) {
    const targetCount = this.imageBackfillMinResultCount(input.resultLimit);
    const existingKeys = new Set(
      input.ranked.map((candidate) => this.candidateKey(candidate)),
    );
    const backfillWindow = Math.max(
      input.resultLimit * 2,
      targetCount * this.imageBackfillCandidateMultiplier(),
    );
    const backfillCandidates = input.fusedCandidates
      .filter((candidate) => !existingKeys.has(this.candidateKey(candidate)))
      .filter((candidate) =>
        this.passesImageBackfillCandidate(
          candidate,
          input.profile,
          input.filters,
        ),
      )
      .sort(
        (a, b) => b.initialScore - a.initialScore || b.annScore - a.annScore,
      )
      .slice(0, backfillWindow);

    const backfillRanked = await this.buildRankedResults({
      candidates: backfillCandidates,
      profile: input.profile,
      queryImageUrl: input.queryImageUrl,
      filters: input.filters,
      resultLimit: input.resultLimit,
      minScore: Math.max(
        this.imageBackfillMinScore(),
        this.resultMinScore(),
      ),
    });

    return this.mergeRankedResults(
      input.ranked,
      backfillRanked,
      input.filters,
      input.resultLimit,
    );
  }

  private rankVerifiedResults(
    candidates: VerifiedCandidate[],
    filters: Record<string, unknown>,
    resultLimit: number,
    minScore: number,
  ) {
    return candidates
      .filter((candidate) => candidate.finalScore >= minScore)
      .sort((a, b) => this.compareVerifiedCandidates(a, b, filters))
      .slice(0, resultLimit);
  }

  private mergeRankedResults(
    primary: VerifiedCandidate[],
    backfill: VerifiedCandidate[],
    filters: Record<string, unknown>,
    resultLimit: number,
  ) {
    const byKey = new Map<string, VerifiedCandidate>();
    for (const candidate of [...primary, ...backfill]) {
      const key = this.candidateKey(candidate);
      const existing = byKey.get(key);
      if (!existing || candidate.finalScore > existing.finalScore) {
        byKey.set(key, candidate);
      }
    }
    return [...byKey.values()]
      .sort((a, b) => this.compareVerifiedCandidates(a, b, filters))
      .slice(0, resultLimit);
  }

  private passesImageBackfillCandidate(
    candidate: RecallCandidate,
    profile: ProductProfileResult,
    filters: Record<string, unknown>,
  ) {
    const constraints = this.asRecord(filters.profileSearchConstraints);
    const explicitBrands = this.toStringArray(filters.brandsInclude);
    const excludedBrands = this.toStringArray(filters.brandsExclude);
    const brand =
      this.toString(filters.brand) ??
      (explicitBrands.length === 0
        ? this.toString(constraints.brand) ?? this.toString(profile.brand)
        : null);
    if (
      brand &&
      !this.productMatchesBrandScope(candidate.product, brand, true)
    ) {
      return false;
    }
    if (
      explicitBrands.length > 0 &&
      !explicitBrands.some((value) =>
        this.productMatchesBrandScope(candidate.product, value, true),
      )
    ) return false;
    if (
      excludedBrands.some((value) =>
        this.productMatchesBrandScope(candidate.product, value, false),
      )
    ) return false;

    const explicitColors = this.toStringArray(filters.colorsInclude);
    const excludedColors = this.toStringArray(filters.colorsExclude);
    const explicitColor = this.toString(filters.color);
    if (
      explicitColor &&
      !this.productMatchesColorScope(candidate.product, explicitColor, true)
    ) {
      return false;
    }
    if (
      explicitColors.length > 0 &&
      !explicitColors.some((value) =>
        this.productMatchesColorScope(candidate.product, value, true),
      )
    ) return false;
    if (
      excludedColors.some((value) =>
        this.productMatchesColorScope(candidate.product, value, false),
      )
    ) return false;

    return (
      candidate.annScore >= this.imageBackfillMinAnnScore() ||
      candidate.tagMatchScore >= this.imageBackfillMinTagScore()
    );
  }

  private recallByTags(
    products: Product[],
    profile: ProductProfileResult,
    priceStats: PriceStats,
    limit: number,
  ) {
    const candidates = products
      .map((product) => ({
        product,
        styleId: null,
        recallSources: new Set<"tag" | "ann">(["tag"]),
        tagMatchScore: this.scoreTagMatch(product, profile),
        annScore: 0,
        rawAnnScore: 0,
        annPassedMinScore: false,
        businessScore: this.productSignals.deriveSignals(product, priceStats)
          .businessScore,
        initialScore: 0,
      }))
      .filter(
        (candidate) =>
          candidate.tagMatchScore >= 0.12 ||
          !this.hasMeaningfulProfile(profile),
      )
      .sort((a, b) => b.tagMatchScore - a.tagMatchScore)
      .slice(0, Math.max(limit, this.globalCandidateLimit() * 2));

    return candidates.map((candidate) => ({
      ...candidate,
      initialScore: this.scoreInitial(candidate),
    }));
  }

  private async loadVerifiedProducts(input?: {
    filters?: Record<string, unknown>;
    category?: string | null;
  }): Promise<Product[]> {
    const take = this.productScanLimit();
    const where = this.buildProductSearchWhere(input);
    return this.prisma.product.findMany({
      where,
      ...(take
        ? {
            take,
            orderBy: [{ updatedAt: "desc" as const }, { id: "asc" as const }],
          }
        : {}),
    });
  }

  private buildProductSearchWhere(input?: {
    filters?: Record<string, unknown>;
    category?: string | null;
  }): Prisma.ProductWhereInput {
    const filters = input?.filters ?? {};
    const where: Prisma.ProductWhereInput = { tagStatus: "verified" };
    const category = normalizeProductCategoryOrNull(input?.category ?? "");
    if (category && category !== "general") where.category = category;

    const platform = this.toString(filters.platform);
    const platformsInclude = this.toStringArray(filters.platformsInclude);
    if (platform) {
      where.platform = platform;
    } else if (platformsInclude.length > 0) {
      where.platform = { in: platformsInclude };
    }

    const platformsExclude = this.toStringArray(filters.platformsExclude);
    if (platformsExclude.length > 0) {
      const existing = where.platform;
      where.platform =
        existing && typeof existing === "object"
          ? { ...existing, notIn: platformsExclude }
          : { notIn: platformsExclude };
    }

    const shopType = this.toString(filters.shopType);
    if (shopType) where.shopType = shopType;
    if (filters.stockOnly === true) where.stockStatus = "in_stock";
    return where;
  }

  private async recallByAnn(input: {
    queryEmbedding: number[];
    productIds: string[];
    topK?: number;
    embeddingKind?: "visual" | "multimodal";
  }) {
    if (input.queryEmbedding.length === 0) return [];
    return this.annSearch.search({
      queryVector: input.queryEmbedding,
      productIds: input.productIds,
      topK: input.topK ?? this.annTopK(),
      minScore: this.annMinScore(),
      embeddingKind: input.embeddingKind,
    });
  }

  private uniqueProductIds(candidates: RecallCandidate[]) {
    return [
      ...new Set(
        candidates.map((candidate) => candidate.product.id).filter(Boolean),
      ),
    ];
  }

  private fuseCandidates(input: {
    products: Product[];
    tagResults: RecallCandidate[];
    annResults: AnnSearchResult[];
    priceStats: PriceStats;
  }): RecallCandidate[] {
    const productsById = new Map(
      input.products.map((product) => [product.id, product]),
    );
    const candidatesByKey = new Map<string, RecallCandidate>();
    const productKeys = new Map<string, string[]>();

    for (const annResult of input.annResults) {
      const product = productsById.get(annResult.productId);
      if (!product) continue;
      const candidate: RecallCandidate = {
        product,
        styleId: annResult.styleId,
        recallSources: new Set<"tag" | "ann">(["ann"]),
        tagMatchScore: 0,
        annScore: annResult.score,
        rawAnnScore: annResult.rawScore,
        annPassedMinScore: annResult.passedMinScore,
        businessScore: this.productSignals.deriveSignals(
          product,
          input.priceStats,
        ).businessScore,
        initialScore: 0,
        embeddingId: annResult.embeddingId,
        imageRole: annResult.imageRole,
        embeddingKind: annResult.embeddingKind,
        embeddingProvider: annResult.embeddingProvider,
      };
      candidate.initialScore = this.scoreInitial(candidate);
      const key = this.fusionKey(product.id, annResult.styleId);
      candidatesByKey.set(key, candidate);
      productKeys.set(product.id, [
        ...(productKeys.get(product.id) ?? []),
        key,
      ]);
    }

    for (const tagResult of input.tagResults) {
      const existingKey = this.pickBestExistingKey(
        productKeys.get(tagResult.product.id) ?? [],
        candidatesByKey,
      );
      const key = existingKey ?? this.fusionKey(tagResult.product.id, null);
      const existing = candidatesByKey.get(key);
      if (existing) {
        existing.recallSources.add("tag");
        existing.tagMatchScore = Math.max(
          existing.tagMatchScore,
          tagResult.tagMatchScore,
        );
        existing.initialScore = this.scoreInitial(existing);
      } else {
        const candidate = {
          ...tagResult,
          businessScore: this.productSignals.deriveSignals(
            tagResult.product,
            input.priceStats,
          ).businessScore,
        };
        candidate.initialScore = this.scoreInitial(candidate);
        candidatesByKey.set(key, candidate);
        productKeys.set(tagResult.product.id, [
          ...(productKeys.get(tagResult.product.id) ?? []),
          key,
        ]);
      }
    }

    return [...candidatesByKey.values()];
  }

  private async verifyConcurrently(
    candidates: RecallCandidate[],
    profile: ProductProfileResult,
    queryImageUrl: string | null,
  ) {
    const concurrency = this.visualVerifyConcurrency();
    const timeoutAt = Date.now() + this.visualVerifyTimeoutMs();
    const results: VerifiedCandidate[] = [];
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < candidates.length && Date.now() < timeoutAt) {
        const candidate = candidates[nextIndex];
        nextIndex += 1;
        const verified = await this.verifyOne(
          candidate,
          profile,
          queryImageUrl,
          timeoutAt,
        );
        if (verified) results.push(verified);
      }
    };

    await Promise.all(
      new Array(Math.min(concurrency, candidates.length))
        .fill(null)
        .map(() => worker()),
    );

    return results;
  }

  private async verifyOne(
    candidate: RecallCandidate,
    profile: ProductProfileResult,
    queryImageUrl: string | null,
    timeoutAt: number,
  ): Promise<VerifiedCandidate | null> {
    const candidateImageUrl = await this.resolveProductImageUrl(
      candidate.product,
    );
    const remainingMs = Math.max(1, timeoutAt - Date.now());

    try {
      const verification = await this.withTimeout(
        this.visualVerificationAdapter.verifyCandidate({
          queryProfile: profile,
          queryImageUrl,
          candidate: {
            title: candidate.product.title,
            brand: candidate.product.brand,
            modelLine: candidate.product.modelLine,
            colorFamily: candidate.product.colorFamily,
            colorway: candidate.product.colorway,
            imageUrl: candidateImageUrl,
          },
        }),
        remainingMs,
      );
      if (
        !verification.sameProduct ||
        verification.confidence < this.visualVerifyMinConfidence()
      ) {
        return null;
      }

      const visualVerifyScore = this.clamp01(verification.confidence);
      return {
        ...candidate,
        visualVerifyScore,
        finalScore: this.scoreFinal(candidate, visualVerifyScore),
        verification,
        coverImageUrl: candidateImageUrl,
      };
    } catch {
      return null;
    }
  }

  private async fastVerify(
    candidate: RecallCandidate,
    mode = "ann_tag_fast_path",
  ): Promise<VerifiedCandidate> {
    const visualVerifyScore = this.clamp01(
      candidate.annScore > 0 ? candidate.annScore : candidate.tagMatchScore,
    );
    return {
      ...candidate,
      visualVerifyScore,
      finalScore: this.scoreFinal(candidate, visualVerifyScore),
      verification: {
        sameProduct: null,
        sameColorway: null,
        confidence: visualVerifyScore,
        verificationStatus: "not_verified",
        verificationSource:
          candidate.annScore > 0 ? "ann_only" : "tag_only",
        raw: {
          mode,
          annScore: candidate.annScore,
          tagMatchScore: candidate.tagMatchScore,
          note:
            mode === "fast_ann_only"
              ? "Returned from ANN-only first screen without tag fusion or visual verification."
              : "Skipped per-candidate visual verification to keep MVP search responsive.",
        },
      },
      coverImageUrl: await this.resolveProductImageUrl(candidate.product),
    };
  }

  private passesProfileCandidate(
    candidate: RecallCandidate,
    profile: ProductProfileResult,
    filters: Record<string, unknown>,
  ) {
    const constraints = this.asRecord(filters.profileSearchConstraints);
    const explicitBrands = this.toStringArray(filters.brandsInclude);
    const brand =
      this.toString(filters.brand) ??
      (explicitBrands.length === 0
        ? this.toString(constraints.brand) ?? this.toString(profile.brand)
        : null);
    if (
      brand &&
      !this.productMatchesBrandScope(candidate.product, brand, true)
    ) {
      return false;
    }
    if (
      explicitBrands.length > 0 &&
      !explicitBrands.some((value) =>
        this.productMatchesBrandScope(candidate.product, value, true),
      )
    ) return false;
    if (
      this.toStringArray(filters.brandsExclude).some((value) =>
        this.productMatchesBrandScope(candidate.product, value, false),
      )
    ) return false;
    const explicitColors = this.toStringArray(filters.colorsInclude);
    const color =
      this.toString(filters.color) ??
      (explicitColors.length === 0
        ? this.toString(constraints.color) ??
          this.toString(profile.colorFamily ?? profile.color ?? profile.colorway)
        : null);
    if (
      color &&
      !this.productMatchesColorScope(candidate.product, color, true)
    ) {
      return false;
    }
    if (
      explicitColors.length > 0 &&
      !explicitColors.some((value) =>
        this.productMatchesColorScope(candidate.product, value, true),
      )
    ) return false;
    if (
      this.toStringArray(filters.colorsExclude).some((value) =>
        this.productMatchesColorScope(candidate.product, value, false),
      )
    ) return false;

    if (filters.requireProfileTagMatch !== true) return true;
    return candidate.recallSources.has("tag") && candidate.tagMatchScore > 0;
  }

  private applyUserFilters(
    products: Product[],
    filters: Record<string, unknown>,
  ) {
    const priceMin = this.toOptionalNumber(filters.priceMin);
    const priceMax = this.toOptionalNumber(filters.priceMax);
    const platformsInclude = new Set(
      this.toStringArray(filters.platformsInclude)
        .map((item) => platformComparisonKey(item))
        .filter((item): item is string => item !== null),
    );
    const platformsExclude = new Set(
      this.toStringArray(filters.platformsExclude)
        .map((item) => platformComparisonKey(item))
        .filter((item): item is string => item !== null),
    );
    const platform = platformComparisonKey(filters.platform);
    const stockOnly = filters.stockOnly === true;
    const freeShippingOnly = filters.freeShippingOnly === true;
    const shopType = this.toString(filters.shopType);
    const brandsInclude = this.toStringArray(filters.brandsInclude);
    const brandsExclude = this.toStringArray(filters.brandsExclude);
    const brand = this.toString(filters.brand);
    const strictBrandScope = filters.strictBrandScope === true;
    const colorsInclude = this.toStringArray(filters.colorsInclude);
    const colorsExclude = this.toStringArray(filters.colorsExclude);
    const color = this.toString(filters.color);
    const sizesInclude = this.toStringArray(filters.sizesInclude);
    const shoeType = this.toString(filters.shoeType);
    const excludedProductIds = this.toStringArray(filters.excludedProductIds);

    return products.filter((product) => {
      const amount = Number(product.priceAmount);
      const productPlatform =
        platformComparisonKey(product.platform) ?? product.platform;
      if (excludedProductIds.includes(product.id)) return false;
      if (priceMin !== null && Number.isFinite(amount) && amount < priceMin) {
        return false;
      }
      if (priceMax !== null && Number.isFinite(amount) && amount > priceMax) {
        return false;
      }
      if (
        platformsInclude.size > 0 &&
        !platformsInclude.has(productPlatform)
      ) {
        return false;
      }
      if (platformsExclude.has(productPlatform)) return false;
      if (platform && productPlatform !== platform) return false;
      if (stockOnly && product.stockStatus !== "in_stock") return false;
      if (shopType && product.shopType !== shopType) return false;
      if (freeShippingOnly && !this.productHasFreeShipping(product)) {
        return false;
      }
      if (
        brand &&
        !this.productMatchesBrandScope(product, brand, strictBrandScope)
      ) {
        return false;
      }
      if (
        brandsInclude.length > 0 &&
        !brandsInclude.some((value) =>
          this.productMatchesBrandScope(product, value, true),
        )
      ) {
        return false;
      }
      if (
        brandsExclude.some((value) =>
          this.productMatchesBrandScope(product, value, false),
        )
      ) {
        return false;
      }
      if (
        shoeType &&
        !this.matchShoeType(product.shoeType, shoeType) &&
        !this.match(product.title, shoeType)
      ) {
        return false;
      }
      if (color && !this.productMatchesColorScope(product, color, true)) {
        return false;
      }
      if (
        colorsInclude.length > 0 &&
        !colorsInclude.some((value) =>
          this.productMatchesColorScope(product, value, true),
        )
      ) {
        return false;
      }
      if (
        colorsExclude.some((value) =>
          this.productMatchesColorScope(product, value, false),
        )
      ) {
        return false;
      }
      if (
        sizesInclude.length > 0 &&
        !sizesInclude.some((value) => this.productMatchesSize(product, value))
      ) {
        return false;
      }
      return true;
    });
  }

  private productHasFreeShipping(product: Product) {
    const rawPayload = fromJson<Record<string, unknown>>(
      product.rawPayloadJson,
      {},
    );
    const fulfillment = this.asRecord(rawPayload.fulfillment);
    return fulfillment.freeShipping === true;
  }

  private async getImageUrlForAsset(assetId: string) {
    const asset = await this.prisma.imageAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset || asset.uploadStatus !== "uploaded") return null;
    return (
      (await this.storage.getSignedReadUrl?.({
        bucketGroup: asset.bucketGroup,
        objectKey: asset.objectKey,
        expiresSeconds: 900,
      })) ?? null
    );
  }

  private async resolveProductImageUrl(product: Product) {
    if (
      product.imagePublicUrl &&
      !product.imagePublicUrl.startsWith("mock://")
    ) {
      return product.imagePublicUrl;
    }
    if (
      product.sourceImageUrl &&
      !product.sourceImageUrl.startsWith("mock://")
    ) {
      return product.sourceImageUrl;
    }
    if (product.imageBucketGroup && product.imageObjectKey) {
      const signedUrl = await this.storage.getSignedReadUrl?.({
        bucketGroup: product.imageBucketGroup,
        objectKey: product.imageObjectKey,
        expiresSeconds: 900,
      });
      if (signedUrl && !signedUrl.startsWith("mock://")) return signedUrl;
    }
    return product.imagePublicUrl ?? product.sourceImageUrl ?? "";
  }

  private compareVerifiedCandidates(
    a: VerifiedCandidate,
    b: VerifiedCandidate,
    filters: Record<string, unknown>,
  ) {
    const sortRule = this.toString(filters.sortRule) ?? "relevance_desc";
    if (sortRule === "relevance_desc") {
      const preferenceDelta =
        this.preferenceScore(b.product, filters) -
        this.preferenceScore(a.product, filters);
      if (preferenceDelta !== 0) return preferenceDelta;
      return this.compareByMatchScore(a, b);
    }
    if (sortRule === "rating_desc") {
      const ratingDelta =
        this.productSignals.deriveSignals(b.product, { min: 0, max: 0 })
          .ratingScore -
        this.productSignals.deriveSignals(a.product, { min: 0, max: 0 })
          .ratingScore;
      if (Number.isFinite(ratingDelta) && ratingDelta !== 0) {
        return ratingDelta;
      }
      return this.compareByMatchScore(a, b);
    }
    if (sortRule === "delivery_asc") {
      const deliveryDelta =
        this.productSignals.deriveSignals(a.product, { min: 0, max: 0 })
          .deliveryDays -
        this.productSignals.deriveSignals(b.product, { min: 0, max: 0 })
          .deliveryDays;
      if (Number.isFinite(deliveryDelta) && deliveryDelta !== 0) {
        return deliveryDelta;
      }
      return this.compareByMatchScore(a, b);
    }

    const priceA = Number(a.product.priceAmount);
    const priceB = Number(b.product.priceAmount);
    const priceDelta = priceA - priceB;
    if (
      sortRule === "price_asc" &&
      Number.isFinite(priceDelta) &&
      priceDelta !== 0
    ) {
      return priceDelta;
    }
    if (
      sortRule === "price_desc" &&
      Number.isFinite(priceDelta) &&
      priceDelta !== 0
    ) {
      return -priceDelta;
    }
    return this.compareByMatchScore(a, b);
  }

  private compareByMatchScore(
    a: Pick<
      VerifiedCandidate,
      "annScore" | "tagMatchScore" | "visualVerifyScore" | "product"
    >,
    b: Pick<
      VerifiedCandidate,
      "annScore" | "tagMatchScore" | "visualVerifyScore" | "product"
    >,
  ) {
    const scoreDelta = this.matchSortScore(b) - this.matchSortScore(a);
    if (scoreDelta !== 0) return scoreDelta;

    const annDelta = b.annScore - a.annScore;
    if (annDelta !== 0) return annDelta;

    const tagDelta = b.tagMatchScore - a.tagMatchScore;
    if (tagDelta !== 0) return tagDelta;

    const visualDelta = b.visualVerifyScore - a.visualVerifyScore;
    if (visualDelta !== 0) return visualDelta;

    return a.product.id.localeCompare(b.product.id);
  }

  private matchSortScore(
    candidate: Pick<
      VerifiedCandidate,
      "annScore" | "tagMatchScore" | "visualVerifyScore"
    >,
  ) {
    return Number(
      this.clamp01(
        candidate.annScore * 0.55 +
          candidate.tagMatchScore * 0.35 +
          candidate.visualVerifyScore * 0.1,
      ).toFixed(6),
    );
  }

  private scoreTagMatch(product: Product, profile: ProductProfileResult) {
    let score = 0;
    if (this.matchBrand(product.brand, profile.brand)) score += 0.3;
    if (this.match(product.modelLine, profile.modelLine)) score += 0.28;
    if (
      this.productMatchesProfileColor(
        product,
        profile.colorFamily ?? profile.color,
      )
    ) {
      score += 0.18;
    }
    if (
      this.match(product.colorway, profile.colorway) ||
      this.productMatchesProfileColor(product, profile.colorway)
    ) {
      score += 0.1;
    }
    if (this.matchShoeType(product.shoeType, profile.shoeType)) score += 0.08;
    if (this.match(product.category, profile.category)) score += 0.06;
    return Number(this.clamp01(score).toFixed(6));
  }

  private scoreInitial(
    candidate: Pick<
      RecallCandidate,
      "annScore" | "tagMatchScore" | "businessScore"
    >,
  ) {
    return Number(
      this.clamp01(
        candidate.annScore * 0.55 +
          candidate.tagMatchScore * 0.35 +
          candidate.businessScore * 0.1,
      ).toFixed(6),
    );
  }

  private scoreFinal(candidate: RecallCandidate, visualVerifyScore: number) {
    return Number(
      this.clamp01(
        candidate.annScore * 0.45 +
          candidate.tagMatchScore * 0.3 +
          visualVerifyScore * 0.15 +
          candidate.businessScore * 0.1,
      ).toFixed(6),
    );
  }

  private computePriceStats(products: Product[]): PriceStats {
    const prices = products
      .map((product) => Number(product.priceAmount))
      .filter((value) => Number.isFinite(value));
    return {
      min: prices.length > 0 ? Math.min(...prices) : 0,
      max: prices.length > 0 ? Math.max(...prices) : 0,
    };
  }

  private fusionKey(productId: string, styleId: string | null) {
    return `${productId}:${styleId ?? "product"}`;
  }

  private candidateKey(
    candidate: Pick<RecallCandidate, "product" | "styleId">,
  ) {
    return this.fusionKey(candidate.product.id, candidate.styleId);
  }

  private pickBestExistingKey(
    keys: string[],
    candidatesByKey: Map<string, RecallCandidate>,
  ) {
    return keys
      .map((key) => ({ key, candidate: candidatesByKey.get(key) }))
      .filter((item): item is { key: string; candidate: RecallCandidate } =>
        Boolean(item.candidate),
      )
      .sort((a, b) => b.candidate.initialScore - a.candidate.initialScore)[0]
      ?.key;
  }

  private hasMeaningfulProfile(profile: ProductProfileResult) {
    return Boolean(
      profile.brand ||
      profile.modelLine ||
      profile.colorFamily ||
      profile.colorway ||
      profile.shoeType,
    );
  }

  private profileFromKeywords(keywords: string[]): ProductProfileResult {
    const category = normalizeProductCategory(keywords.join(" "), "general");
    return {
      category,
      brand: null,
      modelLine: null,
      colorFamily: null,
      colorway: null,
      shoeType: null,
      size: null,
      color: null,
      styleTags: [],
      sceneTags: [],
      keywords:
        keywords.length > 0 ? keywords : productCategoryKeywords(category),
      confidence: 0,
      raw: { source: "keywords_only" },
    };
  }

  private productScanLimit() {
    const configured = this.config.get<number>("search.productScanLimit");
    if (!Number.isFinite(configured) || !configured || configured <= 0) {
      return undefined;
    }
    return Math.floor(configured);
  }

  private annTopK() {
    return this.config.get<number>("ann.topK") ?? 50;
  }

  private annMinScore() {
    return this.config.get<number>("ann.minScore") ?? 0.68;
  }

  private annEmbeddingKind(): "visual" | "multimodal" {
    return this.config.get<string>("embedding.annEmbeddingKind") ===
      "multimodal"
      ? "multimodal"
      : "visual";
  }

  private globalCandidateLimit() {
    return this.config.get<number>("search.globalCandidateLimit") ?? 30;
  }

  private prefetchLimit() {
    return this.config.get<number>("search.prefetchLimit") ?? 120;
  }

  private recallWindow(input: {
    resultLimit: number;
    excludedCount: number;
    imageSearch: boolean;
  }) {
    const baseWindow = Math.max(
      this.annTopK(),
      input.resultLimit + input.excludedCount + this.globalCandidateLimit(),
    );
    if (!input.imageSearch) return baseWindow;

    const multipliedWindow = Math.ceil(
      input.resultLimit * this.imageAnnRecallMultiplier(),
    );
    const widenedWindow = Math.max(
      baseWindow,
      multipliedWindow,
      this.imageAnnRecallMinCandidates(),
    );
    return Math.min(widenedWindow, this.imageAnnRecallMaxCandidates());
  }

  private imageAnnRecallMultiplier() {
    const configured =
      this.config.get<number>("search.imageAnnRecallMultiplier") ?? 4;
    if (!Number.isFinite(configured) || configured < 1) return 1;
    return configured;
  }

  private imageAnnRecallMinCandidates() {
    const configured =
      this.config.get<number>("search.imageAnnRecallMinCandidates") ?? 360;
    if (!Number.isFinite(configured) || configured <= 0) return this.annTopK();
    return Math.floor(configured);
  }

  private imageAnnRecallMaxCandidates() {
    const configured =
      this.config.get<number>("search.imageAnnRecallMaxCandidates") ?? 800;
    if (!Number.isFinite(configured) || configured <= 0) {
      return Math.max(this.annTopK(), this.prefetchLimit());
    }
    return Math.max(this.annTopK(), Math.floor(configured));
  }

  private visualVerifyMaxCandidates(resultLimit = this.globalCandidateLimit()) {
    const configured =
      this.config.get<number>("search.visualVerifyMaxCandidates") ?? 3;
    return Math.max(0, Math.min(resultLimit, configured));
  }

  private applyCategoryScope(products: Product[], category: string | null) {
    const normalized = normalizeProductCategoryOrNull(category);
    if (!normalized || normalized === "general") {
      return products;
    }
    return products.filter((product) => {
      if (!productCategoryMatches(product.category, normalized)) return false;
      if (normalized === "shoe") return this.hasShoeTextSignal(product);
      return true;
    });
  }

  private isSpecificCategory(category: string | null | undefined) {
    const normalized = normalizeProductCategoryOrNull(category);
    return Boolean(normalized && normalized !== "general");
  }

  private hasShoeTextSignal(product: Product) {
    const haystack = [
      product.title,
      product.category,
      product.modelLine,
      product.shoeType,
      product.keywordsJson,
    ]
      .filter(Boolean)
      .join(" ");
    return /鞋|靴|sneaker|sneakers|shoe|shoes|boot|boots|sandal|trainer|trainers|runner|running|skate|basketball/i.test(
      haystack,
    );
  }

  private normalizeResultLimit(value: unknown) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : this.globalCandidateLimit();
    if (!Number.isFinite(parsed) || parsed <= 0)
      return this.globalCandidateLimit();
    return Math.max(1, Math.min(this.maxResultLimit(), Math.floor(parsed)));
  }

  private maxResultLimit() {
    return Math.max(100, this.prefetchLimit());
  }

  private visualVerifyConcurrency() {
    return Math.max(
      1,
      this.config.get<number>("search.visualVerifyConcurrency") ?? 10,
    );
  }

  private visualVerifyMinConfidence() {
    return this.config.get<number>("search.visualVerifyMinConfidence") ?? 0.5;
  }

  private resultMinScore() {
    const configured = this.config.get<number>("search.resultMinScore") ?? 0.55;
    if (!Number.isFinite(configured)) return 0.55;
    return this.clamp01(configured);
  }

  private imageBackfillMinResultCount(resultLimit: number) {
    const configured =
      this.config.get<number>("search.imageBackfillMinResultCount") ?? 20;
    if (!Number.isFinite(configured) || configured <= 0) return 0;
    return Math.min(resultLimit, Math.floor(configured));
  }

  private imageBackfillMinScore() {
    const configured =
      this.config.get<number>("search.imageBackfillMinScore") ?? 0.38;
    if (!Number.isFinite(configured)) return 0.38;
    return this.clamp01(configured);
  }

  private imageBackfillMinAnnScore() {
    const configured =
      this.config.get<number>("search.imageBackfillMinAnnScore") ?? 0.48;
    if (!Number.isFinite(configured)) return 0.48;
    return this.clamp01(configured);
  }

  private imageBackfillMinTagScore() {
    const configured =
      this.config.get<number>("search.imageBackfillMinTagScore") ?? 0.24;
    if (!Number.isFinite(configured)) return 0.24;
    return this.clamp01(configured);
  }

  private imageBackfillCandidateMultiplier() {
    const configured =
      this.config.get<number>("search.imageBackfillCandidateMultiplier") ?? 3;
    if (!Number.isFinite(configured) || configured < 1) return 1;
    return Math.floor(configured);
  }

  private meetsResultThreshold(candidate: VerifiedCandidate) {
    return candidate.finalScore >= this.resultMinScore();
  }

  private meetsImageSearchThreshold(
    candidate: VerifiedCandidate,
    imageSearch: boolean,
    filters: Record<string, unknown>,
  ) {
    if (!imageSearch || this.meetsResultThreshold(candidate)) return true;
    if (filters.requireProfileTagMatch !== true) return false;
    if (!candidate.recallSources.has("tag")) return false;
    return candidate.tagMatchScore >= this.tagOnlyResultMinScore();
  }

  private tagOnlyResultMinScore() {
    const configured = this.config.get<number>("search.tagOnlyResultMinScore");
    if (typeof configured !== "number" || !Number.isFinite(configured)) {
      return 0.3;
    }
    return this.clamp01(configured);
  }

  private searchTimeoutMs() {
    return Math.max(1000, this.config.get<number>("search.timeoutMs") ?? 8000);
  }

  private visualVerifyTimeoutMs() {
    const configured = this.config.get<number>("search.visualVerifyTimeoutMs");
    if (!Number.isFinite(configured) || !configured || configured <= 0) {
      return 5000;
    }
    return Math.max(1000, Math.floor(configured));
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
    return Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        setTimeout(() => reject(new Error("VISUAL_VERIFY_TIMEOUT")), timeoutMs);
      }),
    ]);
  }

  private toOptionalNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  }

  private toString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private withProfileBrandScope(
    filters: Record<string, unknown>,
    profile: ProductProfileResult,
  ) {
    const explicitBrands = this.toStringArray(filters.brandsInclude);
    const excludedBrands = this.toStringArray(filters.brandsExclude);
    if (explicitBrands.length > 0 || excludedBrands.length > 0) return filters;
    const brand = this.toString(profile.brand);
    if (!brand) return filters;
    return {
      ...filters,
      brand,
      strictBrandScope: true,
    };
  }

  private productMatchesSize(product: Product, size: string) {
    const normalizedSize = size.trim().replace(/\.0$/u, '');
    if (!normalizedSize) return false;
    const corpus = [
      product.title,
      product.normalizedTagsJson,
      product.rawPayloadJson,
    ].join(' ');
    return new RegExp(`(^|[^0-9])${normalizedSize.replace('.', '\\.')}(?:\\s*码|\\s*EU)?([^0-9]|$)`, 'iu').test(corpus);
  }

  private preferenceScore(product: Product, filters: Record<string, unknown>) {
    const preferences = this.asRecord(filters.preferences);
    let score = 0;
    if (preferences.freeShipping === true && this.productHasFreeShipping(product)) score += 1;
    if (this.toStringArray(preferences.shopTypes).includes(product.shopType ?? '')) score += 1;
    if (
      this.toStringArray(preferences.brands).some((brand) =>
        this.productMatchesBrandScope(product, brand, false),
      )
    ) score += 1;
    if (
      this.toStringArray(preferences.colors).some((color) =>
        this.productMatchesColorScope(product, color, false),
      )
    ) score += 1;
    const platform = platformComparisonKey(product.platform);
    if (platform && this.toStringArray(preferences.platforms).map((item) => platformComparisonKey(item)).includes(platform)) score += 1;
    const direction = this.toString(preferences.priceDirection);
    const amount = Number(product.priceAmount);
    if (direction === 'lower' && Number.isFinite(amount)) score += 1 / (1 + amount / 1000);
    if (direction === 'higher' && Number.isFinite(amount)) score += Math.min(amount / 10000, 1);
    const target = this.toOptionalNumber(filters.priceTarget);
    const tolerance = this.toOptionalNumber(filters.priceTolerance) ?? (target === null ? null : Math.max(20, target * 0.1));
    if (target !== null && tolerance !== null && Number.isFinite(amount)) {
      score += Math.max(0, 1 - Math.abs(amount - target) / Math.max(tolerance, 1));
    }
    return Math.min(score, 3);
  }

  private productMatchesBrandScope(
    product: Product,
    brand: string,
    strict: boolean,
  ) {
    const expectedBrand = this.normalizeBrand(brand);
    if (!expectedBrand) return false;
    const titleBrands = this.detectKnownBrands(product.title);
    const productBrandMatches = this.matchBrand(product.brand, brand);
    const titleBrandMatches = titleBrands.has(expectedBrand);
    if (!productBrandMatches && !titleBrandMatches) return false;
    if (!strict) return true;

    return (
      titleBrands.size === 0 ||
      (titleBrands.size === 1 && titleBrands.has(expectedBrand))
    );
  }

  private productMatchesProfileColor(
    product: Product,
    color?: string | null,
  ) {
    if (!color) return false;
    return this.productMatchesColorScope(product, color, true);
  }

  private productMatchesColorScope(
    product: Product,
    expectedColor: string,
    requireKnownColor: boolean,
  ) {
    const expectedFamilies = this.normalizeColorFamilies(expectedColor);
    if (expectedFamilies.size === 0) return false;

    const productFamilies = this.productColorFamilies(product);
    if (productFamilies.size === 0) {
      return requireKnownColor
        ? false
        : this.match(product.colorFamily, expectedColor) ||
            this.match(product.colorway, expectedColor) ||
            this.match(product.title, expectedColor);
    }

    return this.colorFamiliesCompatible(expectedFamilies, productFamilies);
  }

  private productColorFamilies(product: Product) {
    const primary = this.normalizeColorFamilies(product.colorFamily);
    if (primary.size > 0) return primary;
    const colorway = this.normalizeColorFamilies(product.colorway);
    if (colorway.size > 0) return colorway;
    return this.colorFamiliesFromValues([
      product.title,
      product.modelLine,
      product.keywordsJson,
    ]);
  }

  private colorFamiliesFromValues(values: Array<string | null | undefined>) {
    const families = new Set<string>();
    for (const value of values) {
      for (const family of this.normalizeColorFamilies(value)) {
        families.add(family);
      }
    }
    return families;
  }

  private colorFamiliesCompatible(
    expectedFamilies: Set<string>,
    productFamilies: Set<string>,
  ) {
    if (expectedFamilies.has("multi")) {
      return productFamilies.has("multi") || productFamilies.size > 1;
    }
    if (productFamilies.has("multi")) return false;
    if (expectedFamilies.size !== productFamilies.size) return false;
    return [...expectedFamilies].every((family) => productFamilies.has(family));
  }

  private normalizeColorFamilies(value?: string | null) {
    const raw = value?.trim().toLowerCase();
    const families = new Set<string>();
    if (!raw) return families;

    const compact = this.normalizeCompact(raw) ?? "";
    const has = (pattern: RegExp) => pattern.test(raw) || pattern.test(compact);
    const add = (family: string) => families.add(family);

    if (has(/blackwhite|whiteblack|黑白|熊猫|panda/i)) {
      add("black");
      add("white");
    }
    if (has(/^(multi|multicolor|multi_color)$|彩色|多色|拼色|撞色|multicolou?r|multi[-_\s]?color/i)) {
      add("multi");
    }
    if (has(/black|纯黑|黑色|黑鞋|黑款|雅黑/u)) add("black");
    if (has(/white|offwhite|ivory|纯白|白色|白鞋|小白鞋|米白|奶白|象牙白|乳白/u)) {
      add("white");
    }
    if (has(/gray|grey|silver|灰色|灰鞋|银色|银灰/u)) add("gray");
    if (has(/blue|navy|蓝色|蓝鞋|藏青|宝蓝|天蓝/u)) add("blue");
    if (has(/red|红色|红鞋|酒红|枣红/u)) add("red");
    if (has(/green|绿色|绿鞋|军绿|墨绿/u)) add("green");
    if (has(/yellow|gold|黄色|黄鞋|金色|金黄/u)) add("yellow");
    if (has(/brown|khaki|tan|棕色|棕鞋|褐色|咖色|卡其/u)) add("brown");
    if (has(/beige|cream|米色|杏色|奶油色/u)) add("beige");
    if (has(/pink|粉色|粉鞋|玫粉/u)) add("pink");
    if (has(/purple|violet|紫色|紫鞋/u)) add("purple");
    if (has(/orange|橙色|橘色|橙鞋|橘鞋/u)) add("orange");

    return families;
  }

  private detectKnownBrands(value?: string | null) {
    const compact = this.normalizeCompact(value) ?? "";
    const detected = new Set<string>();
    for (const [canonical, aliases] of Object.entries(
      this.brandAliasGroups(),
    )) {
      if (aliases.some((alias) => alias !== "nb" && compact.includes(alias))) {
        detected.add(canonical);
      }
    }
    return detected;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private match(left?: string | null, right?: string | null) {
    if (!right) return false;
    if (!left) return false;
    const normalizedLeft = this.normalize(left);
    const normalizedRight = this.normalize(right);
    if (!normalizedLeft || !normalizedRight) return false;
    return (
      normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft)
    );
  }

  private matchBrand(left?: string | null, right?: string | null) {
    if (!right || !left) return false;
    const normalizedLeft = this.normalizeBrand(left);
    const normalizedRight = this.normalizeBrand(right);
    if (!normalizedLeft || !normalizedRight) return false;
    return (
      normalizedLeft === normalizedRight ||
      normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft)
    );
  }

  private matchShoeType(left?: string | null, right?: string | null) {
    if (!right || !left) return false;
    const normalizedLeft = this.normalizeShoeType(left);
    const normalizedRight = this.normalizeShoeType(right);
    if (!normalizedLeft || !normalizedRight) return false;
    return normalizedLeft === normalizedRight;
  }

  private normalize(value?: string | null) {
    return value?.trim().toLowerCase() ?? null;
  }

  private normalizeBrand(value?: string | null) {
    const token = this.normalizeCompact(value);
    if (!token) return null;
    for (const [canonical, aliases] of Object.entries(
      this.brandAliasGroups(),
    )) {
      if (aliases.includes(token)) return canonical;
    }
    return token;
  }

  private brandAliasGroups(): Record<string, string[]> {
    return {
      puma: ["puma", "彪马"],
      nike: ["nike", "耐克"],
      adidas: ["adidas", "阿迪达斯", "阿迪"],
      jordan: ["jordan", "乔丹"],
      converse: ["converse", "匡威"],
      vans: ["vans", "万斯"],
      newbalance: ["newbalance", "nb", "新百伦"],
      lining: ["lining", "李宁"],
      anta: ["anta", "安踏"],
      xtep: ["xtep", "特步"],
    };
  }

  private normalizeShoeType(value?: string | null) {
    const token = this.normalizeCompact(value);
    if (!token) return null;
    const aliases: Record<string, string> = {
      lifestyle: "lifestyle",
      lifestyleshoes: "lifestyle",
      casual: "lifestyle",
      casualshoes: "lifestyle",
      休闲鞋: "lifestyle",
      板鞋: "skate",
      skate: "skate",
      skateshoes: "skate",
      running: "running",
      runningshoes: "running",
      跑鞋: "running",
      basketball: "basketball",
      basketballshoes: "basketball",
      篮球鞋: "basketball",
      training: "training",
      trainingshoes: "training",
      训练鞋: "training",
      boot: "boot",
      boots: "boot",
      靴子: "boot",
      sandal: "sandal",
      sandals: "sandal",
      凉鞋: "sandal",
    };
    return aliases[token] ?? token;
  }

  private normalizeCompact(value?: string | null) {
    return (
      value
        ?.trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "") ?? null
    );
  }

  private clamp01(value: number) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private shouldBypassSearchResultCache(input: {
    queryEmbedding?: number[];
    queryImageUrl?: string | null;
  }) {
    return Boolean(
      input.queryImageUrl &&
      (!input.queryEmbedding || input.queryEmbedding.length === 0),
    );
  }

  private searchResultsCacheKey(
    namespace: "search:shoes" | "search:fast-ann-shoes",
    input: {
      keywords: string[];
      filters: Record<string, unknown>;
      profile: ProductProfileResult | null;
      embeddingKind: "visual" | "multimodal";
      queryEmbedding?: number[];
      excludeProductKeys: string[];
      limit: number;
      category?: string | null;
    },
  ) {
    return `${namespace}:${stableHash({
      resultPolicyVersion: SEARCH_RESULT_POLICY_VERSION,
      resultMinScore: this.resultMinScore(),
      keywords: input.keywords.map((keyword) => keyword.trim()),
      filters: input.filters,
      profile: input.profile,
      embeddingKind: input.embeddingKind,
      queryEmbeddingHash: input.queryEmbedding
        ? stableHash(input.queryEmbedding)
        : null,
      excludeProductKeys: [...new Set(input.excludeProductKeys)].sort(),
      limit: input.limit,
      category: input.category ?? null,
    })}`;
  }

  private async withCandidateCache(
    key: string,
    buildCandidates: () => Promise<CandidateSeed[]>,
  ) {
    const cached = await this.safeGet<CandidateSeed[]>(key);
    if (cached !== null) return cached;

    const candidates = await buildCandidates();
    await this.safeSet(
      key,
      candidates,
      candidates.length === 0
        ? EMPTY_SEARCH_RESULTS_TTL_SECONDS
        : SEARCH_RESULTS_TTL_SECONDS,
    );
    return candidates;
  }

  private async safeGet<T>(key: string): Promise<T | null> {
    try {
      return await this.cache.get<T>(key);
    } catch {
      return null;
    }
  }

  private async safeSet<T>(key: string, value: T, ttlSeconds: number) {
    try {
      await this.cache.set(key, value, ttlSeconds);
    } catch {
      // Cache is an acceleration layer; searches must continue without it.
    }
  }
}
