import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Product } from '@prisma/client';
import {
  ProductCategoryResult,
  ProductProfileResult,
} from '../../../adapters/model/model-adapter.interface';
import {
  CandidateSeed,
  SEARCH_PROVIDER,
  SearchProvider,
} from '../../../adapters/search-provider/search-provider.interface';
import { OBJECT_STORAGE_ADAPTER } from '../../../adapters/storage/storage.constants';
import { StorageAdapter } from '../../../adapters/storage/storage-adapter.interface';
import { createId } from '../../../common/utils/id';
import { fromJson, toJsonArrayString, toJsonString } from '../../../common/utils/json';
import {
  normalizeProductCategory,
  normalizeProductCategoryOrNull,
  productCategoryKeywords,
  productCategoryMatches,
} from '../../../common/catalog/product-categories';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { ANN_SEARCH_PORT, AnnSearchPort, AnnSearchResult } from '../../product-pool/application/ann-search-port.interface';
import { ProductEmbeddingKind } from '../../product-pool/application/product-image-embedding-adapter.interface';
import { PRODUCT_SEARCH_SIGNALS_ADAPTER, ProductSearchSignalsAdapter } from '../../product-pool/application/product-search-signals-adapter.interface';
import { NormalizedSubjectBoxDto } from '../dto/subject-selection.dto';
import { QueryImagePreprocessService } from './query-image-preprocess.service';
import {
  SESSION_PRODUCT_PROFILE_ADAPTER,
  SessionProductProfileAdapter,
} from './session-product-profile-adapter.interface';

export interface SearchDebugInput {
  assetId: string;
  box: NormalizedSubjectBoxDto;
  categoryHint?: string | null;
  topK?: number;
  minScore?: number;
  resultLimit?: number;
  embeddingKind?: ProductEmbeddingKind;
  runDetailed?: boolean;
  runRefined?: boolean;
}

export interface TimelineStep {
  key: string;
  label: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
}

export type DebugTaskResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; error: string }
  | { status: 'skipped'; reason: string };

@Injectable()
export class SearchDebugService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly queryImagePreprocess: QueryImagePreprocessService,
    @Inject(SESSION_PRODUCT_PROFILE_ADAPTER)
    private readonly productProfileAdapter: SessionProductProfileAdapter,
    @Inject(ANN_SEARCH_PORT)
    private readonly annSearch: AnnSearchPort,
    @Inject(SEARCH_PROVIDER)
    private readonly searchProvider: SearchProvider,
    @Inject(PRODUCT_SEARCH_SIGNALS_ADAPTER)
    private readonly productSignals: ProductSearchSignalsAdapter,
    @Inject(OBJECT_STORAGE_ADAPTER)
    private readonly storage: StorageAdapter,
  ) {}

  async run(input: SearchDebugInput) {
    const startedAt = Date.now();
    const timeline: TimelineStep[] = [];
    const categoryHint = normalizeProductCategory(input.categoryHint ?? 'general');
    const resultLimit = this.normalizePositiveInteger(input.resultLimit, 30, 100);
    const topK = this.normalizePositiveInteger(
      input.topK,
      this.config.get<number>('ann.topK') ?? 50,
      200,
    );
    const minScore = this.normalizeNumber(
      input.minScore,
      this.config.get<number>('ann.minScore') ?? 0.68,
    );
    const embeddingKind = this.normalizeEmbeddingKind(input.embeddingKind);

    const asset = await this.measure(timeline, startedAt, 'load_asset', '读取上传图片资产', async () => {
      const record = await this.prisma.imageAsset.findUnique({ where: { id: input.assetId } });
      if (!record) throw new BadRequestException('DEBUG_IMAGE_ASSET_NOT_FOUND');
      if (record.uploadStatus !== 'uploaded') {
        throw new BadRequestException('DEBUG_IMAGE_ASSET_NOT_UPLOADED');
      }
      return record;
    });

    const sessionId = createId('debug_sess');
    await this.measure(timeline, startedAt, 'create_session', '创建诊断 Session', async () => {
      await this.prisma.querySession.create({
        data: {
          id: sessionId,
          assetId: asset.id,
          userId: null,
          status: 'processing',
          stage: 'debug_preprocessing',
          entrySource: 'test_app',
          categoryHint,
          degraded: false,
          currentTurnIndex: 0,
          profileSnapshot: {
            create: {
              id: createId('profile_snap'),
              category: categoryHint,
              brand: null,
              size: null,
              color: null,
              keywordsJson: toJsonArrayString([categoryHint]),
              styleTagsJson: toJsonArrayString([]),
              sceneTagsJson: toJsonArrayString([]),
              confidence: 0,
              rawJson: toJsonString({
                source: 'debug_image_search',
                detailedProfileStatus: 'pending',
              }),
            },
          },
          filterSnapshots: {
            create: {
              id: createId('filter_snap'),
              turnIndex: 0,
              stockOnly: false,
              sortRule: 'relevance_desc',
              rawJson: toJsonString({
                sortRule: 'relevance_desc',
                stockOnly: false,
                debug: true,
              }),
            },
          },
        },
      });
    });

    let cropReadyAtMs: number | null = null;
    let cropImageUrlFromCallback: string | null = null;
    let categoryPromise: Promise<DebugTaskResult<ProductCategoryResult>> | null = null;
    let detailedPromise: Promise<DebugTaskResult<ProductProfileResult>> | null = null;

    const preprocess = await this.measure(timeline, startedAt, 'preprocess_embed', '主体裁剪标准化并生成 query embedding', async () =>
      this.queryImagePreprocess.createUserSelection({
        sessionId,
        asset,
        box: input.box,
        selectionSource: 'debug_user_selection',
        profile: null,
        embeddingKind,
        onCropReady: (event) => {
          cropReadyAtMs = Date.now() - startedAt;
          cropImageUrlFromCallback = event.queryImageUrl;
          categoryPromise = this.measureTask(
            timeline,
            startedAt,
            'category_model',
            event.localCategory
              ? '预处理类别提示'
              : '远端类别识别模型',
            () => event.localCategory
              ? Promise.resolve({
                  category: event.localCategory.category,
                  confidence: event.localCategory.confidence,
                  raw: {
                    provider: 'image_preprocessor',
                    source: event.preprocess.strategy,
                    detectedClass: event.localCategory.detectedClass,
                    preprocess: event.preprocess,
                  },
                })
              : this.productProfileAdapter.classifyProductCategory({
                  imageUrl: event.queryImageUrl,
                  categoryHint,
                }),
          );
          if (input.runDetailed !== false) {
            detailedPromise = this.measureTask(
              timeline,
              startedAt,
              'detailed_profile_model',
              '详细标签识别模型',
              () => this.productProfileAdapter.identifyProductProfile({
                assetId: asset.id,
                categoryHint,
                imageUrl: event.queryImageUrl,
              }),
            );
          }
        },
      }),
    );

    const queryImageUrl =
      preprocess.queryImageUrl ??
      cropImageUrlFromCallback ??
      await this.queryImagePreprocess.getCropImageUrl(preprocess.snapshot);
    const categoryResult =
      categoryPromise
        ? await categoryPromise
        : this.skippedTask<ProductCategoryResult>('CATEGORY_MODEL_NOT_STARTED');
    const detailedProfileResult =
      input.runDetailed === false
        ? this.skippedTask<ProductProfileResult>('DETAILED_PROFILE_DISABLED')
        : detailedPromise
          ? await detailedPromise
          : this.skippedTask<ProductProfileResult>('DETAILED_PROFILE_NOT_STARTED');
    const detailedProfile =
      detailedProfileResult.status === 'ok' ? detailedProfileResult.value : null;
    const normalizedCategory = this.extractCategory(
      categoryResult.status === 'ok' ? categoryResult.value : null,
      categoryHint,
    );
    const fastProfile = this.buildProfileForFastPath(normalizedCategory);

    const rawAnn = preprocess.queryEmbedding
      ? await this.measure(timeline, startedAt, 'raw_ann', 'ANN 原始召回', async () =>
          this.runRawAnn({
            queryEmbedding: preprocess.queryEmbedding ?? [],
            topK,
            minScore,
            category: normalizedCategory,
            embeddingKind,
          }),
        )
      : { results: [], returnedCount: 0, passedMinScoreCount: 0 };

    const fastCandidates = preprocess.queryEmbedding
      ? await this.measure(timeline, startedAt, 'fast_candidates', '当前 fast_ann 候选链路', async () =>
          this.searchProvider.searchFastAnnShoes
            ? this.searchProvider.searchFastAnnShoes({
                keywords: fastProfile.keywords,
                profile: fastProfile,
                queryEmbedding: preprocess.queryEmbedding ?? [],
                queryImageUrl,
                embeddingKind,
                category: normalizedCategory,
                filters: { sortRule: 'relevance_desc', stockOnly: false, categoryScope: normalizedCategory },
                limit: resultLimit,
              })
            : this.searchProvider.searchShoes({
                keywords: fastProfile.keywords,
                profile: fastProfile,
                queryEmbedding: preprocess.queryEmbedding ?? [],
                queryImageUrl,
                embeddingKind,
                filters: { sortRule: 'relevance_desc', stockOnly: false },
              }),
        )
      : [];

    const refinedCandidates =
      input.runRefined !== false && detailedProfile && preprocess.queryEmbedding
        ? await this.measure(timeline, startedAt, 'refined_candidates', '详细标签融合与视觉复核链路', async () =>
            this.searchProvider.searchShoes({
              keywords: detailedProfile.keywords,
              profile: detailedProfile,
              queryEmbedding: preprocess.queryEmbedding ?? [],
              queryImageUrl,
              embeddingKind,
              filters: { sortRule: 'relevance_desc', stockOnly: false },
            }),
          )
        : this.skipCandidates(
            timeline,
            startedAt,
            'refined_candidates',
            '详细标签融合与视觉复核链路',
            input.runRefined === false
              ? 'REFINED_SEARCH_DISABLED'
              : detailedProfile
                ? 'QUERY_EMBEDDING_UNAVAILABLE'
                : 'DETAILED_PROFILE_UNAVAILABLE',
          );

    const [originalImageUrl, cropImageUrl, dbStats] = await Promise.all([
      this.signedAssetUrl(asset),
      this.queryImagePreprocess.getCropImageUrl(preprocess.snapshot),
      this.getDbStats(),
    ]);

    await this.prisma.querySession.update({
      where: { id: sessionId },
      data: {
        status: 'ready',
        stage: 'debug_ready',
        degraded: false,
      },
    });

    return {
      meta: {
        sessionId,
        assetId: asset.id,
        generatedAt: new Date().toISOString(),
        totalDurationMs: Date.now() - startedAt,
        cropReadyAtMs,
        parameters: {
          topK,
          minScore,
          resultLimit,
          categoryHint,
          embeddingKind,
          runDetailed: input.runDetailed !== false,
          runRefined: input.runRefined !== false,
        },
        dbStats,
      },
      images: {
        originalImageUrl,
        cropImageUrl,
        localSubjectDetectionImageUrl:
          preprocess.localSubjectDetectionImageUrl,
        selectedBox: input.box,
        preprocessSnapshot: preprocess.formatted,
      },
      models: {
        category: categoryResult,
        detailedProfile: detailedProfileResult,
      },
      ann: rawAnn,
      fastCandidates: this.formatCandidates(fastCandidates),
      refinedCandidates: this.formatCandidates(refinedCandidates),
      timeline: timeline.sort((a, b) => a.startedAtMs - b.startedAtMs),
    };
  }

  private async runRawAnn(input: {
    queryEmbedding: number[];
    topK: number;
    minScore: number;
    category: string;
    embeddingKind: ProductEmbeddingKind;
  }) {
    const products = await this.prisma.product.findMany({
      where: { tagStatus: 'verified' },
      take: this.config.get<number>('search.productScanLimit') ?? 1000,
    });
    const scopedProducts = this.applyCategoryScope(products, input.category);
    if (scopedProducts.length === 0) {
      return {
        provider: this.config.get<string>('ann.provider') ?? 'sqlite_vec',
        embeddingKind: input.embeddingKind,
        requestedTopK: input.topK,
        minScore: input.minScore,
        candidatePoolSize: 0,
        returnedCount: 0,
        passedMinScoreCount: 0,
        topKAfterMinScore: [],
        results: [],
      };
    }
    const annResults = await this.annSearch.search({
      queryVector: input.queryEmbedding,
      productIds: scopedProducts.map((product) => product.id),
      topK: input.topK,
      minScore: input.minScore,
      embeddingKind: input.embeddingKind,
    });
    const productIds = [...new Set(annResults.map((result) => result.productId))];
    const productRecords = productIds.length > 0
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } } })
      : [];
    const productsById = new Map(productRecords.map((product) => [product.id, product]));
    const formatted = await Promise.all(
      annResults.map((result, index) =>
        this.formatAnnResult(result, productsById.get(result.productId) ?? null, index + 1),
      ),
    );

    return {
      provider: this.config.get<string>('ann.provider') ?? 'sqlite_vec',
      embeddingKind: input.embeddingKind,
      requestedTopK: input.topK,
      minScore: input.minScore,
      candidatePoolSize: scopedProducts.length,
      returnedCount: annResults.length,
      passedMinScoreCount: annResults.filter((result) => result.passedMinScore).length,
      topKAfterMinScore: formatted.filter((item) => item.passedMinScore),
      results: formatted,
    };
  }

  private async formatAnnResult(
    result: AnnSearchResult,
    product: Product | null,
    rank: number,
  ) {
    return {
      rank,
      productId: result.productId,
      styleId: result.styleId,
      imageRole: result.imageRole,
      embeddingKind: result.embeddingKind,
      score: result.score,
      rawScore: result.rawScore,
      passedMinScore: result.passedMinScore,
      embeddingId: result.embeddingId,
      embeddingProvider: result.embeddingProvider,
      product: product ? await this.formatProduct(product) : null,
    };
  }

  private async formatProduct(product: Product) {
    const rawPayload = fromJson<Record<string, unknown>>(product.rawPayloadJson, {});
    return {
      id: product.id,
      title: product.title,
      platform: product.platform,
      priceAmount: product.priceAmount,
      currency: product.currency,
      stockStatus: product.stockStatus,
      shopName: product.shopName,
      shopType: product.shopType,
      productUrl: product.productUrl,
      brand: product.brand,
      category: product.category,
      modelLine: product.modelLine,
      colorFamily: product.colorFamily,
      colorway: product.colorway,
      shoeType: product.shoeType,
      imageUrl: await this.resolveProductImageUrl(product),
      normalizedTags: fromJson<Record<string, unknown>>(product.normalizedTagsJson, {}),
      keywords: fromJson<string[]>(product.keywordsJson, []),
      rawPayload,
    };
  }

  private async resolveProductImageUrl(product: Product) {
    if (product.imagePublicUrl && !product.imagePublicUrl.startsWith('mock://')) return product.imagePublicUrl;
    if (product.sourceImageUrl && !product.sourceImageUrl.startsWith('mock://')) return product.sourceImageUrl;
    if (product.imageBucketGroup && product.imageObjectKey) {
      const signedUrl = await this.storage.getSignedReadUrl?.({
        bucketGroup: product.imageBucketGroup,
        objectKey: product.imageObjectKey,
        expiresSeconds: 900,
      });
      if (signedUrl && !signedUrl.startsWith('mock://')) return signedUrl;
    }
    return product.imagePublicUrl ?? product.sourceImageUrl ?? '';
  }

  private async signedAssetUrl(asset: { bucketGroup: string; objectKey: string }) {
    const signedUrl = await this.storage.getSignedReadUrl?.({
      bucketGroup: asset.bucketGroup,
      objectKey: asset.objectKey,
      expiresSeconds: 900,
    });
    return signedUrl && !signedUrl.startsWith('mock://') ? signedUrl : null;
  }

  private async getDbStats() {
    const [products, verifiedProducts, embeddings, embeddingGroups] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.count({ where: { tagStatus: 'verified' } }),
      this.prisma.productImageEmbedding.count(),
      this.prisma.productImageEmbedding.groupBy({
        by: ['embeddingKind', 'provider', 'dimension'],
        _count: { _all: true },
      }),
    ]);
    return { products, verifiedProducts, embeddings, embeddingGroups };
  }

  private formatCandidates(candidates: CandidateSeed[]) {
    return candidates.map((candidate, index) => ({
      rank: index + 1,
      title: candidate.title,
      platformName: candidate.platformName,
      amount: candidate.amount,
      currency: candidate.currency,
      shopName: candidate.shopName,
      shopType: candidate.shopType,
      stockStatus: candidate.stockStatus,
      coverImageUrl: candidate.coverImageUrl,
      productUrl: candidate.productUrl,
      matchSummary: candidate.matchSummary,
      normalizedAttributes: candidate.normalizedAttributes,
      rawPayload: candidate.rawPayload,
      recommendationReason: candidate.recommendationReason,
      productPoolKey: candidate.productPoolKey,
    }));
  }

  private buildProfileForFastPath(category: string) {
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
      keywords: productCategoryKeywords(category),
      confidence: 0,
      raw: { source: 'debug_fast_path_profile' },
    };
  }

  private extractCategory(value: unknown, fallback: string) {
    const category = this.asRecord(value).category;
    const normalized = typeof category === 'string' && category.trim().length > 0
      ? category.trim().toLowerCase()
      : fallback;
    return normalizeProductCategory(normalized, fallback);
  }

  private applyCategoryScope(products: Product[], category: string | null) {
    const normalized = normalizeProductCategoryOrNull(category);
    if (!normalized || normalized === 'general') {
      return products;
    }
    return products.filter((product) =>
      productCategoryMatches(product.category, normalized),
    );
  }

  private async measure<T>(
    timeline: TimelineStep[],
    originMs: number,
    key: string,
    label: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await work();
      const ended = Date.now();
      timeline.push({
        key,
        label,
        startedAtMs: started - originMs,
        endedAtMs: ended - originMs,
        durationMs: ended - started,
        status: 'ok',
      });
      return result;
    } catch (error) {
      const ended = Date.now();
      timeline.push({
        key,
        label,
        startedAtMs: started - originMs,
        endedAtMs: ended - originMs,
        durationMs: ended - started,
        status: 'error',
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      });
      throw error;
    }
  }

  private async measureTask<T>(
    timeline: TimelineStep[],
    originMs: number,
    key: string,
    label: string,
    work: () => Promise<T>,
  ): Promise<DebugTaskResult<T>> {
    try {
      return {
        status: 'ok',
        value: await this.measure(timeline, originMs, key, label, work),
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      };
    }
  }

  private skippedTask<T>(reason: string): DebugTaskResult<T> {
    return { status: 'skipped', reason };
  }

  private skipCandidates(
    timeline: TimelineStep[],
    originMs: number,
    key: string,
    label: string,
    reason: string,
  ): CandidateSeed[] {
    const now = Date.now();
    timeline.push({
      key,
      label,
      startedAtMs: now - originMs,
      endedAtMs: now - originMs,
      durationMs: 0,
      status: 'skipped',
      error: reason,
    });
    return [];
  }

  private normalizePositiveInteger(value: unknown, fallback: number, max: number) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : fallback;
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.max(1, Math.min(max, Math.floor(number)));
  }

  private normalizeNumber(value: unknown, fallback: number) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : fallback;
    return Number.isFinite(number) ? number : fallback;
  }

  private normalizeEmbeddingKind(value: unknown): ProductEmbeddingKind {
    return value === 'multimodal' ? 'multimodal' : 'visual';
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
