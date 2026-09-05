import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Product } from '@prisma/client';
import { createId } from '../../../common/utils/id';
import { fromJson, toJsonString } from '../../../common/utils/json';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { CACHE_STORE } from '../../../cache/cache.constants';
import { CacheStore } from '../../../cache/interfaces/cache-store.interface';
import { ProductTagResult } from '../../../adapters/model/model-adapter.interface';
import { StorageAdapter } from '../../../adapters/storage/storage-adapter.interface';
import { OBJECT_STORAGE_ADAPTER } from '../../../adapters/storage/storage.constants';
import { EMBEDDING_PROVIDER } from './embedding.constants';
import { EmbeddingProvider, EmbeddingResult } from './embedding-provider.interface';
import { ANN_SEARCH_PORT, AnnSearchPort } from './ann-search-port.interface';
import {
  PRODUCT_BATCH_VIEW_ADAPTER,
  ProductBatchViewAdapter,
} from './product-batch-view-adapter.interface';
import {
  PRODUCT_BATCH_QUALITY_ADAPTER,
  ProductBatchQualityAdapter,
  ProductBatchQualityProduct,
} from './product-batch-quality-adapter.interface';
import {
  PRODUCT_IMAGE_EMBEDDING_ADAPTER,
  ProductEmbeddingKind,
  ProductImageEmbeddingAdapter,
  ProductImageEmbeddingVariantInput,
} from './product-image-embedding-adapter.interface';
import {
  PRODUCT_IMAGE_CONTENT_ADAPTER,
  ProductImageContent,
  ProductImageContentAdapter,
} from './product-image-content-adapter.interface';
import {
  PRODUCT_MODEL_TAGGING_ADAPTER,
  ProductModelTaggingAdapter,
} from './product-model-tagging-adapter.interface';
import {
  PRODUCT_RAW_PAYLOAD_ADAPTER,
  ProductRawPayloadAdapter,
} from './product-raw-payload-adapter.interface';
import {
  PRODUCT_SOURCE_TAG_ADAPTER,
  ProductSourceTagAdapter,
} from './product-source-tag-adapter.interface';
import {
  PRODUCT_PERSISTENCE_ADAPTER,
  ProductPersistenceAdapter,
} from './product-persistence-adapter.interface';
import {
  ImportProductsDto,
  PRODUCT_PLATFORMS,
  PRODUCT_STOCK_STATUSES,
  ProductImportItemDto,
} from '../dto/import-products.dto';
import {
  PRODUCT_IMPORT_ADAPTER,
  ProductImportAdapter,
} from './product-import-adapter.interface';
import {
  PRODUCT_IMPORT_BATCH_STATE_ADAPTER,
  ProductImportBatchStateAdapter,
} from './product-import-batch-state-adapter.interface';
import {
  PRODUCT_IMPORT_CHANGE_ADAPTER,
  ProductImportChangeAdapter,
} from './product-import-change-adapter.interface';
import {
  PRODUCT_UPDATE_ADAPTER,
  ProductUpdateAdapter,
} from './product-update-adapter.interface';
import {
  PRODUCT_VIEW_ADAPTER,
  ProductViewAdapter,
} from './product-view-adapter.interface';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';

const PRODUCT_POOL_STATS_CACHE_KEY = 'product-pool:stats:v3';
const PRODUCT_POOL_STATS_SNAPSHOT_ID = 'default';

interface ConsensusResult {
  accepted: boolean;
  status: string;
  tag: ProductTagResult;
  conflict: Record<string, unknown>;
}

export interface ProductPoolStatsCore {
  totalProducts: number;
  searchableProducts: number;
  embeddingCount: number;
  embeddingCoverage: {
    visualProducts: number;
    multimodalProducts: number;
    visualRate: number;
    multimodalRate: number;
  };
  embeddingGroups: Array<Record<string, unknown>>;
  categoryGroups: Array<Record<string, unknown>>;
  platformGroups: Array<Record<string, unknown>>;
  tagStatusGroups: Array<Record<string, unknown>>;
  recentBatches: Array<Record<string, unknown>>;
}

export interface ProductPoolStatsResponse extends ProductPoolStatsCore {
  statsSnapshot: {
    source: 'cache' | 'snapshot' | 'computed';
    generatedAt: string;
    stale: boolean;
  };
}

interface ProductPoolStatsCacheEntry {
  payload: ProductPoolStatsCore;
  generatedAt: string;
}

interface ProductPoolStatsSnapshotRow {
  payloadJson: string;
  generatedAt: Date | string;
}

interface ListProductsInput {
  limit?: number;
  offset?: number;
  platform?: string;
  tagStatus?: string;
  batchId?: string;
  brand?: string;
  category?: string;
  keyword?: string;
  hasEmbedding?: boolean;
}

interface ListBatchesInput {
  limit?: number;
  offset?: number;
  batchSource?: string;
  status?: string;
}

interface MainEmbeddingCreateResult {
  embedding: EmbeddingResult;
  embeddingKind: ProductEmbeddingKind;
  imageRole: string;
  qualityScore: number;
}

@Injectable()
export class ProductPoolService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductPoolService.name);
  private readonly runningImportBatches = new Set<string>();
  private statsRefreshPromise: Promise<ProductPoolStatsResponse> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(CACHE_STORE)
    private readonly cache: CacheStore,
    @Inject(ANN_SEARCH_PORT)
    private readonly annSearch: AnnSearchPort,
    @Inject(PRODUCT_BATCH_VIEW_ADAPTER)
    private readonly productBatchViewAdapter: ProductBatchViewAdapter,
    @Inject(PRODUCT_BATCH_QUALITY_ADAPTER)
    private readonly productBatchQualityAdapter: ProductBatchQualityAdapter,
    @Inject(OBJECT_STORAGE_ADAPTER)
    private readonly storage: StorageAdapter,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
    @Inject(PRODUCT_IMAGE_EMBEDDING_ADAPTER)
    private readonly productImageEmbeddingAdapter: ProductImageEmbeddingAdapter,
    @Inject(PRODUCT_IMAGE_CONTENT_ADAPTER)
    private readonly productImageContentAdapter: ProductImageContentAdapter,
    @Inject(PRODUCT_MODEL_TAGGING_ADAPTER)
    private readonly productModelTaggingAdapter: ProductModelTaggingAdapter,
    @Inject(PRODUCT_RAW_PAYLOAD_ADAPTER)
    private readonly productRawPayloadAdapter: ProductRawPayloadAdapter,
    @Inject(PRODUCT_SOURCE_TAG_ADAPTER)
    private readonly productSourceTagAdapter: ProductSourceTagAdapter,
    @Inject(PRODUCT_PERSISTENCE_ADAPTER)
    private readonly productPersistenceAdapter: ProductPersistenceAdapter,
    @Inject(PRODUCT_IMPORT_ADAPTER)
    private readonly productImportAdapter: ProductImportAdapter,
    @Inject(PRODUCT_IMPORT_BATCH_STATE_ADAPTER)
    private readonly productImportBatchStateAdapter: ProductImportBatchStateAdapter,
    @Inject(PRODUCT_IMPORT_CHANGE_ADAPTER)
    private readonly productImportChangeAdapter: ProductImportChangeAdapter,
    @Inject(PRODUCT_UPDATE_ADAPTER)
    private readonly productUpdateAdapter: ProductUpdateAdapter,
    @Inject(PRODUCT_VIEW_ADAPTER)
    private readonly productViewAdapter: ProductViewAdapter,
  ) {}

  onApplicationBootstrap() {
    setTimeout(() => {
      void this.refreshStatsSnapshotInBackground('bootstrap');
    }, 0);

    const resumeOnStart =
      this.config.get<boolean>('productPool.resumeImportOnStart') ?? false;
    if (!resumeOnStart) return;

    setTimeout(() => {
      void this.resumePendingImportBatches();
    }, 0);
  }

  async importProducts(dto: ImportProductsDto) {
    const adapterResult = this.productImportAdapter.normalizeBatch(dto);
    const normalizedDto = adapterResult.dto;
    this.validateImportDto(normalizedDto);

    const batchId = createId('product_batch');
    await this.prisma.productImportBatch.create({
      data: {
        id: batchId,
        batchSource: normalizedDto.batchSource,
        status: 'queued',
        totalCount: normalizedDto.items.length,
        rawJson: this.productImportBatchStateAdapter.buildAcceptedRaw({
          batchSource: normalizedDto.batchSource,
          items: normalizedDto.items,
          adapterMetadata: adapterResult.metadata,
        }),
      },
    });

    this.scheduleImportBatch(batchId);
    void this.invalidateStatsCache('product_import_queued');

    return {
      batchId,
      batchSource: normalizedDto.batchSource,
      totalCount: normalizedDto.items.length,
      status: 'queued',
      accepted: true,
      mode: 'async',
      pollPath: `/api/v1/product-pool/batches/${batchId}`,
      duplicateStrategy: 'upsert_by_platform_externalId',
      adapter: adapterResult.metadata,
    };
  }

  async getStats(): Promise<ProductPoolStatsResponse> {
    const cached = await this.safeCacheGet<ProductPoolStatsCacheEntry>(
      PRODUCT_POOL_STATS_CACHE_KEY,
    );
    if (cached) {
      return this.withStatsSnapshotMetadata(cached.payload, {
        source: 'cache',
        generatedAt: cached.generatedAt,
      });
    }

    const snapshot = await this.readStatsSnapshot();
    if (snapshot) {
      await this.safeCacheSet(
        PRODUCT_POOL_STATS_CACHE_KEY,
        snapshot,
        this.statsCacheTtlSeconds(),
      );
      if (this.isStatsSnapshotStale(snapshot.generatedAt)) {
        void this.refreshStatsSnapshotInBackground('stale_snapshot');
      }
      return this.withStatsSnapshotMetadata(snapshot.payload, {
        source: 'snapshot',
        generatedAt: snapshot.generatedAt,
      });
    }

    return this.refreshStatsSnapshot('miss');
  }

  private async computeStatsCore(): Promise<ProductPoolStatsCore> {
    const [
      totalProducts,
      searchableProducts,
      embeddingCount,
      visualEmbeddingProducts,
      multimodalEmbeddingProducts,
      embeddingGroups,
      categoryGroups,
      platformGroups,
      tagStatusGroups,
      batches,
    ] = await Promise.all([
      this.timedStatsQuery('product.count.total', () =>
        this.prisma.product.count(),
      ),
      this.timedStatsQuery('product.count.verified', () =>
        this.prisma.product.count({ where: { tagStatus: 'verified' } }),
      ),
      this.timedStatsQuery('embedding.count.total', () =>
        this.prisma.productImageEmbedding.count(),
      ),
      this.timedStatsQuery('product.count.visual_embeddings', () =>
        this.prisma.product.count({
          where: { embeddings: { some: { embeddingKind: 'visual' } } },
        }),
      ),
      this.timedStatsQuery('product.count.multimodal_embeddings', () =>
        this.prisma.product.count({
          where: { embeddings: { some: { embeddingKind: 'multimodal' } } },
        }),
      ),
      this.timedStatsQuery('embedding.group.kind_provider_dimension', () =>
        this.prisma.productImageEmbedding.groupBy({
          by: ['embeddingKind', 'provider', 'dimension'],
          _count: { _all: true },
        }),
      ),
      this.timedStatsQuery('product.group.category', () =>
        this.prisma.product.groupBy({
          by: ['category'],
          _count: { _all: true },
        }),
      ),
      this.timedStatsQuery('product.group.platform', () =>
        this.prisma.product.groupBy({
          by: ['platform'],
          _count: { _all: true },
        }),
      ),
      this.timedStatsQuery('product.group.tag_status', () =>
        this.prisma.product.groupBy({
          by: ['tagStatus'],
          _count: { _all: true },
        }),
      ),
      this.timedStatsQuery('product_import_batch.recent', () =>
        this.prisma.productImportBatch.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            batchSource: true,
            status: true,
            totalCount: true,
            succeededCount: true,
            failedCount: true,
            createdAt: true,
          },
        }),
      ),
    ]);

    return {
      totalProducts,
      searchableProducts,
      embeddingCount,
      embeddingCoverage: {
        visualProducts: visualEmbeddingProducts,
        multimodalProducts: multimodalEmbeddingProducts,
        visualRate:
          totalProducts > 0
            ? Number((visualEmbeddingProducts / totalProducts).toFixed(4))
            : 0,
        multimodalRate:
          totalProducts > 0
            ? Number((multimodalEmbeddingProducts / totalProducts).toFixed(4))
            : 0,
      },
      embeddingGroups,
      categoryGroups: categoryGroups
        .map((group) => ({
          category: group.category,
          normalizedCategory: normalizeProductCategory(group.category, 'general'),
          count: group._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      platformGroups: platformGroups
        .map((group) => ({
          platform: group.platform,
          count: group._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      tagStatusGroups: tagStatusGroups
        .map((group) => ({
          status: group.tagStatus,
          count: group._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      recentBatches: batches.map((batch) =>
        this.productBatchViewAdapter.toRecentBatch(batch),
      ),
    };
  }

  private async refreshStatsSnapshot(
    reason: string,
  ): Promise<ProductPoolStatsResponse> {
    if (this.statsRefreshPromise) return this.statsRefreshPromise;

    this.statsRefreshPromise = (async () => {
      const startedAt = Date.now();
      const payload = await this.computeStatsCore();
      const generatedAt = new Date().toISOString();
      const cacheEntry: ProductPoolStatsCacheEntry = { payload, generatedAt };
      await Promise.all([
        this.safeCacheSet(
          PRODUCT_POOL_STATS_CACHE_KEY,
          cacheEntry,
          this.statsCacheTtlSeconds(),
        ),
        this.writeStatsSnapshot(cacheEntry),
      ]);
      const elapsedMs = Date.now() - startedAt;
      const slowMs = this.statsSlowQueryMs();
      const message = `product-pool stats refresh reason=${reason} elapsedMs=${elapsedMs}`;
      if (elapsedMs >= slowMs) this.logger.warn(message);
      else this.logger.log(message);
      return this.withStatsSnapshotMetadata(payload, {
        source: 'computed',
        generatedAt,
      });
    })().finally(() => {
      this.statsRefreshPromise = null;
    });

    return this.statsRefreshPromise;
  }

  private async refreshStatsSnapshotInBackground(reason: string) {
    try {
      await this.refreshStatsSnapshot(reason);
    } catch (error) {
      this.logger.warn(
        `product-pool stats refresh failed reason=${reason} message=${
          error instanceof Error ? error.message : 'UNKNOWN_ERROR'
        }`,
      );
    }
  }

  private async readStatsSnapshot(): Promise<ProductPoolStatsCacheEntry | null> {
    try {
      const rows = await this.prisma.$queryRaw<ProductPoolStatsSnapshotRow[]>`
        SELECT "payloadJson", "generatedAt"
        FROM "ProductPoolStatsSnapshot"
        WHERE "id" = ${PRODUCT_POOL_STATS_SNAPSHOT_ID}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      const payload = fromJson<ProductPoolStatsCore | null>(
        row.payloadJson,
        null,
      );
      if (!payload) return null;
      return {
        payload,
        generatedAt: this.toIsoDate(row.generatedAt),
      };
    } catch (error) {
      if (this.isMissingStatsSnapshotTableError(error)) return null;
      throw error;
    }
  }

  private async writeStatsSnapshot(entry: ProductPoolStatsCacheEntry) {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "ProductPoolStatsSnapshot"
          ("id", "payloadJson", "generatedAt", "createdAt", "updatedAt")
        VALUES
          (
            ${PRODUCT_POOL_STATS_SNAPSHOT_ID},
            ${toJsonString(entry.payload)},
            ${entry.generatedAt},
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        ON CONFLICT("id") DO UPDATE SET
          "payloadJson" = excluded."payloadJson",
          "generatedAt" = excluded."generatedAt",
          "updatedAt" = CURRENT_TIMESTAMP
      `;
    } catch (error) {
      if (this.isMissingStatsSnapshotTableError(error)) {
        this.logger.warn(
          'ProductPoolStatsSnapshot table is missing; run db:init/patch-sqlite-schema before relying on persistent stats snapshots',
        );
        return;
      }
      throw error;
    }
  }

  private async timedStatsQuery<T>(
    label: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      return await run();
    } finally {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= this.statsSlowQueryMs()) {
        this.logger.warn(
          `slow product-pool stats query label=${label} elapsedMs=${elapsedMs}`,
        );
      }
    }
  }

  private withStatsSnapshotMetadata(
    payload: ProductPoolStatsCore,
    meta: {
      source: ProductPoolStatsResponse['statsSnapshot']['source'];
      generatedAt: string;
    },
  ): ProductPoolStatsResponse {
    return {
      ...payload,
      statsSnapshot: {
        source: meta.source,
        generatedAt: meta.generatedAt,
        stale: this.isStatsSnapshotStale(meta.generatedAt),
      },
    };
  }

  private async safeCacheGet<T>(key: string): Promise<T | null> {
    try {
      return await this.cache.get<T>(key);
    } catch (error) {
      this.logger.warn(
        `cache get failed key=${key} message=${
          error instanceof Error ? error.message : 'UNKNOWN_ERROR'
        }`,
      );
      return null;
    }
  }

  private async safeCacheSet<T>(key: string, value: T, ttlSeconds: number) {
    try {
      await this.cache.set(key, value, ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `cache set failed key=${key} message=${
          error instanceof Error ? error.message : 'UNKNOWN_ERROR'
        }`,
      );
    }
  }

  private async invalidateStatsCache(reason: string) {
    try {
      await this.cache.delete(PRODUCT_POOL_STATS_CACHE_KEY);
    } catch (error) {
      this.logger.warn(
        `cache delete failed key=${PRODUCT_POOL_STATS_CACHE_KEY} reason=${reason} message=${
          error instanceof Error ? error.message : 'UNKNOWN_ERROR'
        }`,
      );
    }
    void this.refreshStatsSnapshotInBackground(reason);
  }

  private statsCacheTtlSeconds() {
    return this.config.get<number>('productPool.statsCacheTtlSeconds') ?? 60;
  }

  private statsSnapshotFreshSeconds() {
    return (
      this.config.get<number>('productPool.statsSnapshotFreshSeconds') ?? 60
    );
  }

  private statsSlowQueryMs() {
    return this.config.get<number>('productPool.statsSlowQueryMs') ?? 500;
  }

  private isStatsSnapshotStale(generatedAt: string) {
    const generatedAtMs = Date.parse(generatedAt);
    if (!Number.isFinite(generatedAtMs)) return true;
    return Date.now() - generatedAtMs > this.statsSnapshotFreshSeconds() * 1000;
  }

  private isMissingStatsSnapshotTableError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('ProductPoolStatsSnapshot');
  }

  private toIsoDate(value: Date | string) {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  async diagnoseAnn(input: {
    assetId?: string;
    imageUrl?: string;
    textHint?: string;
    topK?: number;
    minScore?: number;
    embeddingKind?: string;
  }) {
    this.assertRealEmbeddingProvider();

    const imageUrl = await this.resolveDiagnosticImageUrl(input);
    const topK = this.clampPositiveInteger(input.topK, this.config.get<number>('ann.topK') ?? 50, 100);
    const minScore = typeof input.minScore === 'number'
      ? input.minScore
      : this.config.get<number>('ann.minScore') ?? 0.68;
    const embeddingKind = this.normalizeEmbeddingKind(
      input.embeddingKind,
      this.annEmbeddingKind(),
    );
    const embedding = await this.embeddingProvider.embedImage({
      imageUrl,
      textHint: embeddingKind === 'visual'
        ? undefined
        : input.textHint ?? 'product similarity diagnostic',
      tags: {
        diagnostic: true,
        embeddingKind,
        assetId: input.assetId ?? null,
        imageUrl: input.imageUrl ?? null,
      },
    });
    const annResults = await this.annSearch.search({
      queryVector: embedding.vector,
      topK,
      minScore,
      embeddingKind,
    });
    const productIds = [...new Set(annResults.map((result) => result.productId))];
    const products = productIds.length > 0
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            platform: true,
            title: true,
            priceAmount: true,
            shopName: true,
            brand: true,
            modelLine: true,
            colorFamily: true,
          },
        })
      : [];
    const productsById = new Map(products.map((product) => [product.id, product]));
    const embeddingGroups = await this.getEmbeddingGroups();

    return {
      queryEmbedding: {
        provider: embedding.provider,
        modelName: embedding.modelName,
        dimension: embedding.dimension,
        vectorHash: embedding.vectorHash,
        embeddingKind,
      },
      ann: {
        provider: this.config.get<string>('ann.provider') ?? 'sqlite_vec',
        topK,
        minScore,
        returnedCount: annResults.length,
        passedMinScoreCount: annResults.filter((result) => result.passedMinScore).length,
        maxScore: annResults[0]?.score ?? 0,
        maxRawScore: annResults[0]?.rawScore ?? 0,
        embeddingGroups,
        topResults: annResults.map((result) => {
          const product = productsById.get(result.productId);
          return {
            productId: result.productId,
            styleId: result.styleId,
            title: product?.title ?? null,
            platform: product?.platform ?? null,
            priceAmount: product?.priceAmount ?? null,
            shopName: product?.shopName ?? null,
            brand: product?.brand ?? null,
            modelLine: product?.modelLine ?? null,
            colorFamily: product?.colorFamily ?? null,
            imageRole: result.imageRole,
            embeddingKind: result.embeddingKind,
            score: result.score,
            rawScore: result.rawScore,
            passedMinScore: result.passedMinScore,
            embeddingId: result.embeddingId,
            embeddingProvider: result.embeddingProvider,
          };
        }),
      },
    };
  }

  async listImportBatches(input: ListBatchesInput = {}) {
    const limit = this.clampPositiveInteger(input.limit, 50, 100);
    const offset = this.clampNonNegativeInteger(input.offset, 0);
    const where = {
      ...(this.cleanOptionalString(input.batchSource)
        ? { batchSource: this.cleanOptionalString(input.batchSource) as string }
        : {}),
      ...(this.cleanOptionalString(input.status)
        ? { status: this.cleanOptionalString(input.status) as string }
        : {}),
    };

    const [total, batches] = await Promise.all([
      this.prisma.productImportBatch.count({ where }),
      this.prisma.productImportBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
    ]);

    const items = await Promise.all(
      batches.map(async (batch) => this.buildBatchSummary(batch)),
    );

    return {
      total,
      limit,
      offset,
      items,
    };
  }

  async getImportBatch(batchId: string, options: { productLimit?: number } = {}) {
    const batch = await this.prisma.productImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('PRODUCT_IMPORT_BATCH_NOT_FOUND');

    const productLimit = this.clampPositiveInteger(options.productLimit, 50, 200);
    const [summary, auditStatusRows, products] = await Promise.all([
      this.buildBatchSummary(batch),
      this.prisma.productTagAudit.groupBy({
        by: ['status'],
        where: { importBatchId: batch.id },
        _count: { status: true },
      }),
      this.prisma.product.findMany({
        where: { importBatchId: batch.id },
        orderBy: { createdAt: 'desc' },
        take: productLimit,
        include: {
          _count: { select: { embeddings: true, tagAudits: true } },
        },
      }),
    ]);

    return {
      ...summary,
      raw: this.productBatchViewAdapter.summarizeRaw(batch.rawJson),
      auditStatusCounts: this.productBatchViewAdapter.toAuditStatusCounts(
        auditStatusRows.map((row) => ({
          status: row.status,
          count: row._count.status,
        })),
      ),
      products: products.map((product) => this.productViewAdapter.toListItem(product)),
    };
  }

  async getImportBatchQuality(batchId: string) {
    const batch = await this.prisma.productImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('PRODUCT_IMPORT_BATCH_NOT_FOUND');

    const [products, audits, changes] = await Promise.all([
      this.prisma.product.findMany({
        where: { importBatchId: batchId },
        select: {
          tagStatus: true,
          productUrl: true,
          sourceImageUrl: true,
          imagePublicUrl: true,
          imageBucketGroup: true,
          imageObjectKey: true,
          embeddings: {
            select: { embeddingKind: true },
          },
        },
      }),
      this.prisma.productTagAudit.findMany({
        where: { importBatchId: batchId },
        select: {
          status: true,
          conflictJson: true,
        },
      }),
      this.prisma.productImportChange.findMany({
        where: { batchId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          productId: true,
          afterJson: true,
        },
      }),
    ]);

    const snapshotProducts = new Map<string, ProductBatchQualityProduct>();
    for (const change of changes) {
      if (snapshotProducts.has(change.productId)) continue;
      const snapshotProduct = this.productImportChangeAdapter.toQualityProduct(
        change.afterJson,
      );
      if (snapshotProduct) {
        snapshotProducts.set(change.productId, snapshotProduct);
      }
    }

    return this.productBatchQualityAdapter.buildReport({
      batch,
      products:
        snapshotProducts.size > 0
          ? [...snapshotProducts.values()]
          : products,
      audits,
    });
  }

  async rollbackImportBatch(
    batchId: string,
    options: { dryRun?: boolean } = {},
  ) {
    const batch = await this.prisma.productImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('PRODUCT_IMPORT_BATCH_NOT_FOUND');
    if (['queued', 'processing'].includes(batch.status)) {
      throw new BadRequestException('PRODUCT_IMPORT_BATCH_ROLLBACK_BUSY');
    }

    const changes = await this.prisma.productImportChange.findMany({
      where: {
        batchId,
        rolledBackAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (changes.length === 0) {
      throw new BadRequestException('PRODUCT_IMPORT_BATCH_ROLLBACK_UNAVAILABLE');
    }

    const productIds = [...new Set(changes.map((change) => change.productId))];
    const currentProducts = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, importBatchId: true, title: true },
    });
    const currentById = new Map(
      currentProducts.map((product) => [product.id, product]),
    );
    const conflicts = changes
      .filter((change) => {
        const current = currentById.get(change.productId);
        return current ? current.importBatchId !== batchId : change.action !== 'created';
      })
      .map((change) => ({
        changeId: change.id,
        productId: change.productId,
        action: change.action,
        reason: currentById.has(change.productId)
          ? 'PRODUCT_CHANGED_BY_LATER_BATCH'
          : 'PRODUCT_MISSING',
      }));

    const preview = {
      batchId,
      batchSource: batch.batchSource,
      changeCount: changes.length,
      createdChangeCount: changes.filter((change) => change.action === 'created')
        .length,
      updatedChangeCount: changes.filter((change) => change.action === 'updated')
        .length,
      affectedProductCount: productIds.length,
      conflictCount: conflicts.length,
      conflicts,
    };
    if (options.dryRun) {
      return {
        dryRun: true,
        ...preview,
      };
    }
    if (conflicts.length > 0) {
      throw new BadRequestException({
        code: 'PRODUCT_IMPORT_BATCH_ROLLBACK_CONFLICT',
        ...preview,
      });
    }

    const rolledBackAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      let deletedProductCount = 0;
      let restoredProductCount = 0;
      let restoredEmbeddingCount = 0;

      for (const change of changes) {
        const current = await tx.product.findUnique({
          where: { id: change.productId },
          select: { id: true, importBatchId: true },
        });

        if (change.action === 'created') {
          if (!current) {
            await tx.productImportChange.update({
              where: { id: change.id },
              data: { rolledBackAt },
            });
            continue;
          }
          if (current.importBatchId !== batchId) {
            throw new BadRequestException(
              'PRODUCT_IMPORT_BATCH_ROLLBACK_CONFLICT',
            );
          }
          await tx.productImageEmbedding.deleteMany({
            where: { productId: change.productId },
          });
          await tx.productTagAudit.deleteMany({
            where: { productId: change.productId },
          });
          await tx.product.delete({
            where: { id: change.productId },
          });
          deletedProductCount += 1;
        } else {
          if (!current || current.importBatchId !== batchId) {
            throw new BadRequestException(
              'PRODUCT_IMPORT_BATCH_ROLLBACK_CONFLICT',
            );
          }
          const snapshot = this.productImportChangeAdapter.deserializeSnapshot(
            change.beforeJson,
          );
          if (!snapshot) {
            throw new BadRequestException(
              'PRODUCT_IMPORT_CHANGE_SNAPSHOT_INVALID',
            );
          }
          await tx.productImageEmbedding.deleteMany({
            where: { productId: change.productId },
          });
          await tx.productTagAudit.deleteMany({
            where: {
              productId: change.productId,
              importBatchId: batchId,
            },
          });
          await tx.product.update({
            where: { id: change.productId },
            data: snapshot.productData,
          });
          for (const embedding of snapshot.embeddings) {
            await tx.productImageEmbedding.create({ data: embedding });
          }
          restoredProductCount += 1;
          restoredEmbeddingCount += snapshot.embeddings.length;
        }

        await tx.productImportChange.update({
          where: { id: change.id },
          data: { rolledBackAt },
        });
      }

      const rollbackResult = {
        deletedProductCount,
        restoredProductCount,
        restoredEmbeddingCount,
        rolledBackChangeCount: changes.length,
      };
      await tx.productTagAudit.deleteMany({
        where: { importBatchId: batchId },
      });
      await tx.productImportBatch.update({
        where: { id: batchId },
        data: {
          status: 'rolled_back',
          rawJson: this.productImportBatchStateAdapter.buildRolledBackRaw({
            rawJson: batch.rawJson,
            rolledBackAt: rolledBackAt.toISOString(),
            result: rollbackResult,
          }),
        },
      });
      return rollbackResult;
    });

    void this.invalidateStatsCache('product_import_rolled_back');

    return {
      dryRun: false,
      ...preview,
      ...result,
      rolledBackAt: rolledBackAt.toISOString(),
    };
  }

  async retryImportBatch(batchId: string) {
    const batch = await this.prisma.productImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('PRODUCT_IMPORT_BATCH_NOT_FOUND');
    if (!this.productImportBatchStateAdapter.hasImportItems(batch.rawJson)) {
      throw new BadRequestException('PRODUCT_IMPORT_BATCH_ITEMS_NOT_AVAILABLE');
    }

    await this.prisma.productImportBatch.update({
      where: { id: batchId },
      data: {
        status: 'queued',
        succeededCount: 0,
        failedCount: 0,
        rawJson: this.productImportBatchStateAdapter.buildRetryRaw(batch.rawJson),
      },
    });
    this.scheduleImportBatch(batchId);
    void this.invalidateStatsCache('product_import_retry_queued');

    return {
      batchId,
      batchSource: batch.batchSource,
      totalCount: batch.totalCount,
      status: 'queued',
      accepted: true,
      mode: 'async_retry',
      pollPath: `/api/v1/product-pool/batches/${batchId}`,
    };
  }

  async listProducts(input: ListProductsInput = {}) {
    const limit = this.clampPositiveInteger(input.limit, 100, 200);
    const offset = this.clampNonNegativeInteger(input.offset, 0);
    const where = this.buildProductWhere(input);

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          _count: { select: { embeddings: true, tagAudits: true } },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      items: products.map((product) => this.productViewAdapter.toListItem(product)),
    };
  }

  async getProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        importBatch: true,
        embeddings: {
          orderBy: { createdAt: 'desc' },
        },
        tagAudits: {
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
      },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');

    return this.productViewAdapter.toDetail(product);
  }

  async updateProduct(productId: string, body: Record<string, unknown>) {
    const existing = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('PRODUCT_NOT_FOUND');

    const data = this.productUpdateAdapter.toProductUpdateData(body);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('PRODUCT_UPDATE_FIELDS_REQUIRED');
    }

    await this.prisma.product.update({
      where: { id: productId },
      data,
    });
    await this.prisma.productTagAudit.create({
      data: {
        id: createId('product_audit'),
        productId,
        status: 'manual_product_update',
        conflictJson: toJsonString({
          updatedFields: Object.keys(data),
        }),
      },
    });

    void this.invalidateStatsCache('product_updated');

    return this.getProduct(productId);
  }

  async deleteProducts(input: {
    productIds?: string[];
    batchId?: string;
    dryRun?: boolean;
  }) {
    const productIds = Array.isArray(input.productIds)
      ? input.productIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const batchId = this.cleanOptionalString(input.batchId);
    if (productIds.length === 0 && !batchId) {
      throw new BadRequestException('PRODUCT_DELETE_TARGET_REQUIRED');
    }

    const products = await this.prisma.product.findMany({
      where: {
        ...(productIds.length > 0 ? { id: { in: productIds } } : {}),
        ...(batchId ? { importBatchId: batchId } : {}),
      },
      select: { id: true, title: true, platform: true },
    });
    const ids = products.map((product) => product.id);
    const [embeddingCount, auditCount] = await Promise.all([
      ids.length > 0
        ? this.prisma.productImageEmbedding.count({ where: { productId: { in: ids } } })
        : Promise.resolve(0),
      ids.length > 0
        ? this.prisma.productTagAudit.count({ where: { productId: { in: ids } } })
        : Promise.resolve(0),
    ]);

    if (input.dryRun) {
      return {
        dryRun: true,
        productCount: ids.length,
        embeddingCount,
        auditCount,
        products,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      if (ids.length === 0) return;
      await tx.productImageEmbedding.deleteMany({
        where: { productId: { in: ids } },
      });
      await tx.productTagAudit.deleteMany({
        where: { productId: { in: ids } },
      });
      await tx.product.deleteMany({
        where: { id: { in: ids } },
      });
    });

    void this.invalidateStatsCache('products_deleted');

    return {
      dryRun: false,
      deletedProductCount: ids.length,
      deletedEmbeddingCount: embeddingCount,
      deletedAuditCount: auditCount,
      products,
    };
  }

  async deleteImportBatch(input: { batchId?: string; batchSource?: string; dryRun?: boolean }) {
    const batchId = this.cleanOptionalString(input.batchId);
    const batchSource = this.cleanOptionalString(input.batchSource);
    if (!batchId && !batchSource) {
      throw new BadRequestException('PRODUCT_IMPORT_BATCH_IDENTIFIER_REQUIRED');
    }

    const batches = await this.prisma.productImportBatch.findMany({
      where: {
        ...(batchId ? { id: batchId } : {}),
        ...(batchSource ? { batchSource } : {}),
      },
      select: { id: true, batchSource: true },
    });
    const batchIds = batches.map((batch) => batch.id);
    const products = batchIds.length > 0
      ? await this.prisma.product.findMany({
          where: { importBatchId: { in: batchIds } },
          select: { id: true },
        })
      : [];
    const productIds = products.map((product) => product.id);

    const [embeddingCount, productAuditCount, batchAuditCount] = await Promise.all([
      productIds.length > 0
        ? this.prisma.productImageEmbedding.count({
            where: { productId: { in: productIds } },
          })
        : Promise.resolve(0),
      productIds.length > 0
        ? this.prisma.productTagAudit.count({
            where: { productId: { in: productIds } },
          })
        : Promise.resolve(0),
      batchIds.length > 0
        ? this.prisma.productTagAudit.count({
            where: { importBatchId: { in: batchIds } },
          })
        : Promise.resolve(0),
    ]);

    if (input.dryRun) {
      return {
        dryRun: true,
        batchCount: batchIds.length,
        productCount: productIds.length,
        embeddingCount,
        auditCount: productAuditCount + batchAuditCount,
        batches,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      if (productIds.length > 0) {
        await tx.productImageEmbedding.deleteMany({
          where: { productId: { in: productIds } },
        });
        await tx.productTagAudit.deleteMany({
          where: { productId: { in: productIds } },
        });
      }
      if (batchIds.length > 0) {
        await tx.productImportChange.deleteMany({
          where: { batchId: { in: batchIds } },
        });
        await tx.productTagAudit.deleteMany({
          where: { importBatchId: { in: batchIds } },
        });
        await tx.product.deleteMany({
          where: { importBatchId: { in: batchIds } },
        });
        await tx.productImportBatch.deleteMany({
          where: { id: { in: batchIds } },
        });
      }
    });

    void this.invalidateStatsCache('product_import_batch_deleted');

    return {
      dryRun: false,
      deletedBatchCount: batchIds.length,
      deletedProductCount: productIds.length,
      deletedEmbeddingCount: embeddingCount,
      deletedAuditCount: productAuditCount + batchAuditCount,
      batches,
    };
  }

  async rebuildEmbeddings(options?: { limit?: number; embeddingKind?: string }) {
    this.assertRealEmbeddingProvider();
    const embeddingKinds = this.productEmbeddingKinds(options?.embeddingKind);

    const products = await this.prisma.product.findMany({
      where: { tagStatus: 'verified' },
      orderBy: { createdAt: 'asc' },
      take: options?.limit,
    });

    if (options?.limit) {
      await this.prisma.productImageEmbedding.deleteMany({
        where: {
          productId: { in: products.map((product) => product.id) },
          ...(options.embeddingKind
            ? { embeddingKind: this.normalizeEmbeddingKind(options.embeddingKind) }
            : {}),
        },
      });
    } else {
      await this.prisma.productImageEmbedding.deleteMany({
        where: options?.embeddingKind
          ? { embeddingKind: this.normalizeEmbeddingKind(options.embeddingKind) }
          : undefined,
      });
    }

    let succeededCount = 0;
    let failedCount = 0;
    const failures: Array<{ productId: string; title: string; message: string }> = [];
    const providerInfo: {
      provider: string | null;
      modelName: string | null;
      dimension: number | null;
    } = {
      provider: null,
      modelName: null,
      dimension: null,
    };

    for (const product of products) {
      try {
        const results = await this.createEmbeddingsForExistingProduct(
          product,
          embeddingKinds,
        );
        if (results.length === 0) {
          throw new InternalServerErrorException('PRODUCT_EMBEDDING_REBUILD_CREATED_NONE');
        }
        const first = results[0];
        if (first) {
          providerInfo.provider ??= first.provider;
          providerInfo.modelName ??= first.modelName ?? null;
          providerInfo.dimension ??= first.dimension;
        }
        succeededCount += 1;
      } catch (error) {
        failedCount += 1;
        failures.push({
          productId: product.id,
          title: product.title,
          message: error instanceof Error ? error.message : 'PRODUCT_EMBEDDING_REBUILD_FAILED',
        });
        await this.prisma.productTagAudit.create({
          data: {
            id: createId('product_audit'),
            productId: product.id,
            status: 'embedding_rebuild_failed',
            conflictJson: toJsonString({
              message: error instanceof Error ? error.message : 'PRODUCT_EMBEDDING_REBUILD_FAILED',
            }),
          },
        });
      }
    }

    void this.invalidateStatsCache('product_embeddings_rebuilt');

    return {
      totalProducts: products.length,
      embeddingKinds,
      succeededCount,
      failedCount,
      failures,
      provider: providerInfo.provider ?? this.config.get<string>('embedding.provider') ?? null,
      modelName: providerInfo.modelName ?? this.config.get<string>('embedding.modelName') ?? null,
      dimension: providerInfo.dimension ?? this.config.get<number>('embedding.dimension') ?? null,
    };
  }

  private scheduleImportBatch(batchId: string) {
    if (this.runningImportBatches.has(batchId)) return;
    this.runningImportBatches.add(batchId);
    setImmediate(() => {
      void this.processImportBatch(batchId).finally(() => {
        this.runningImportBatches.delete(batchId);
      });
    });
  }

  private async resumePendingImportBatches() {
    const limit =
      this.config.get<number>('productPool.resumeImportBatchLimit') ?? 1;
    if (limit <= 0) return;

    const batches = await this.prisma.productImportBatch.findMany({
      where: { status: { in: ['queued', 'processing'] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    for (const batch of batches) {
      this.scheduleImportBatch(batch.id);
    }
  }

  private async processImportBatch(batchId: string) {
    const batch = await this.prisma.productImportBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) return;
    if (!['queued', 'processing'].includes(batch.status)) return;

    const items = this.productImportBatchStateAdapter.normalizeItemsForProcessing({
      batchSource: batch.batchSource,
      rawJson: batch.rawJson,
    });
    if (items.length === 0) {
      await this.prisma.productImportBatch.update({
        where: { id: batchId },
        data: {
          status: 'failed',
          rawJson: this.productImportBatchStateAdapter.buildItemsUnavailableFailureRaw(
            batch.rawJson,
          ),
        },
      });
      void this.invalidateStatsCache('product_import_failed');
      return;
    }

    const startedAt = this.productImportBatchStateAdapter.getStartedAt(batch.rawJson);
    await this.prisma.productImportBatch.update({
      where: { id: batchId },
      data: {
        status: 'processing',
        totalCount: items.length,
        succeededCount: 0,
        failedCount: 0,
        rawJson: this.productImportBatchStateAdapter.buildProcessingRaw({
          rawJson: batch.rawJson,
          startedAt,
        }),
      },
    });

    let succeededCount = 0;
    let failedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    const importedProductIds: string[] = [];

    for (const item of items) {
      try {
        const result = await this.importOneProduct(batchId, item);
        importedProductIds.push(result.productId);
        if (result.action === 'updated') updatedCount += 1;
        else createdCount += 1;
        succeededCount += 1;
      } catch (error) {
        failedCount += 1;
        await this.prisma.productTagAudit.create({
          data: {
            id: createId('product_audit'),
            importBatchId: batchId,
            status: 'import_failed',
            conflictJson: toJsonString({
              title: item?.title ?? null,
              message: error instanceof Error ? error.message : 'UNKNOWN_IMPORT_ERROR',
            }),
          },
        });
      }

      await this.prisma.productImportBatch.update({
        where: { id: batchId },
        data: {
          succeededCount,
          failedCount,
          rawJson: this.productImportBatchStateAdapter.buildProgressRaw({
            rawJson: batch.rawJson,
            startedAt,
            progress: {
              succeededCount,
              failedCount,
              createdCount,
              updatedCount,
              processedCount: succeededCount + failedCount,
              importedProductIds: importedProductIds.slice(-50),
            },
          }),
        },
      });
    }

    const completedAt = new Date().toISOString();
    await this.prisma.productImportBatch.update({
      where: { id: batchId },
      data: {
        status: failedCount > 0 ? 'completed_with_errors' : 'completed',
        succeededCount,
        failedCount,
        rawJson: this.productImportBatchStateAdapter.buildCompletedRaw({
          rawJson: batch.rawJson,
          startedAt,
          completedAt,
          progress: {
            succeededCount,
            failedCount,
            createdCount,
            updatedCount,
            processedCount: succeededCount + failedCount,
            importedProductIds,
          },
        }),
      },
    });
    void this.invalidateStatsCache('product_import_completed');
  }

  private async buildBatchSummary(batch: {
    id: string;
    batchSource: string;
    status: string;
    totalCount: number;
    succeededCount: number;
    failedCount: number;
    rawJson: string;
    createdAt: Date;
  }) {
    const [
      productCount,
      searchableProductCount,
      productsWithEmbeddingCount,
      embeddingCount,
      changeCount,
      pendingRollbackChangeCount,
    ] = await Promise.all([
      this.prisma.product.count({ where: { importBatchId: batch.id } }),
      this.prisma.product.count({
        where: { importBatchId: batch.id, tagStatus: 'verified' },
      }),
      this.prisma.product.count({
        where: { importBatchId: batch.id, embeddings: { some: {} } },
      }),
      this.prisma.productImageEmbedding.count({
        where: { product: { importBatchId: batch.id } },
      }),
      this.prisma.productImportChange.count({
        where: { batchId: batch.id },
      }),
      this.prisma.productImportChange.count({
        where: { batchId: batch.id, rolledBackAt: null },
      }),
    ]);

    return this.productBatchViewAdapter.toBatchSummary(batch, {
      productCount,
      searchableProductCount,
      productsWithEmbeddingCount,
      embeddingCount,
      changeCount,
      pendingRollbackChangeCount,
    });
  }

  private buildProductWhere(input: ListProductsInput): Prisma.ProductWhereInput {
    const platform = this.cleanOptionalString(input.platform);
    const tagStatus = this.cleanOptionalString(input.tagStatus);
    const batchId = this.cleanOptionalString(input.batchId);
    const brand = this.cleanOptionalString(input.brand);
    const category = input.category
      ? normalizeProductCategory(input.category)
      : null;
    const keyword = this.cleanOptionalString(input.keyword);

    return {
      ...(platform ? { platform } : {}),
      ...(tagStatus ? { tagStatus } : {}),
      ...(batchId ? { importBatchId: batchId } : {}),
      ...(brand ? { brand } : {}),
      ...(category ? { category } : {}),
      ...(input.hasEmbedding === true ? { embeddings: { some: {} } } : {}),
      ...(input.hasEmbedding === false ? { embeddings: { none: {} } } : {}),
      ...(keyword
        ? {
            OR: [
              { title: { contains: keyword } },
              { externalId: { contains: keyword } },
              { shopName: { contains: keyword } },
              { productUrl: { contains: keyword } },
            ],
          }
        : {}),
    };
  }

  private async importOneProduct(batchId: string, item: ProductImportItemDto) {
    this.validateItem(item);

    const existingProduct = item.externalId
      ? await this.prisma.product.findFirst({
          where: { platform: item.platform, externalId: item.externalId },
        })
      : null;
    const imageContent = await this.loadImageContent(item);
    if (!imageContent) {
      throw new BadRequestException('PRODUCT_IMPORT_IMAGE_LOAD_FAILED');
    }
    const productId = existingProduct?.id ?? createId('product');
    const storedImage = await this.storage.putImage({
      assetId: createId('product_asset'),
      assetGroupId: batchId,
      variantType: 'demo_asset',
      content: imageContent.buffer,
      contentType: imageContent.contentType,
      originalFilename: imageContent.filename,
      objectKeyPrefix: 'products',
    });
    const signedImageUrl =
      (await this.storage.getSignedReadUrl?.({
        bucketGroup: storedImage.bucketGroup,
        objectKey: storedImage.objectKey,
        expiresSeconds: 900,
      })) ?? null;

    const sourceTag =
      this.productSourceTagAdapter.buildTagFromSourceAttributes(item);
    const tagInput = {
      title: item.title,
      platform: item.platform,
      brandHint: item.brandHint,
      categoryHint:
        sourceTag?.category ??
        normalizeProductCategory(item.categoryHint ?? item.title, 'general'),
      imageUrl: signedImageUrl ?? item.imageUrl ?? null,
      rawPayload: item.rawPayload,
    };
    const modelA =
      sourceTag ?? (await this.productModelTaggingAdapter.tagProduct(tagInput));
    const consensus = sourceTag
      ? this.buildSourceAttributeConsensus(sourceTag)
      : this.buildConsensus(modelA);

    const productData = this.productPersistenceAdapter.buildProductUpsertData({
      batchId,
      item,
      storedImage,
      consensus,
      tagStatus: consensus.accepted ? 'verified' : 'review_needed',
    });
    const existingEmbeddings = existingProduct
      ? await this.prisma.productImageEmbedding.findMany({
          where: { productId: existingProduct.id },
        })
      : [];
    const changeId = createId('product_change');
    await this.prisma.productImportChange.create({
      data: this.productImportChangeAdapter.buildChangeCreateData({
        changeId,
        batchId,
        productId,
        action: existingProduct ? 'updated' : 'created',
        beforeJson: existingProduct
          ? this.productImportChangeAdapter.serializeSnapshot(
              existingProduct,
              existingEmbeddings,
            )
          : '{}',
      }),
    });

    if (existingProduct) {
      await this.prisma.productImageEmbedding.deleteMany({
        where: { productId: existingProduct.id },
      });
    }

    const product = existingProduct
      ? await this.prisma.product.update({
          where: { id: existingProduct.id },
          data: productData,
        })
      : await this.prisma.product.create({
          data: {
            id: productId,
            ...productData,
          },
        });

    await this.prisma.productTagAudit.create({
      data: this.productPersistenceAdapter.buildTagAuditCreateData({
        productId: product.id,
        batchId,
        sourceTag,
        modelTag: modelA,
        consensus,
      }),
    });

    if (consensus.accepted) {
      await this.createPrimaryImageEmbedding({
        batchId,
        productId: product.id,
        item,
        tag: consensus.tag,
        storedImage,
        signedImageUrl,
      });
      await this.createStyleImageEmbeddings({
        batchId,
        productId: product.id,
        item,
        tag: consensus.tag,
      });
    }
    const importedProduct = await this.prisma.product.findUnique({
      where: { id: product.id },
    });
    const importedEmbeddings = await this.prisma.productImageEmbedding.findMany({
      where: { productId: product.id },
    });
    if (importedProduct) {
      await this.prisma.productImportChange.update({
        where: { id: changeId },
        data: {
          afterJson: this.productImportChangeAdapter.buildAfterJson(
            importedProduct,
            importedEmbeddings,
          ),
        },
      });
    }

    return {
      productId: product.id,
      action: existingProduct ? ('updated' as const) : ('created' as const),
    };
  }

  private async createPrimaryImageEmbedding(input: {
    batchId: string;
    productId: string;
    item: ProductImportItemDto;
    tag: ProductTagResult;
    storedImage: { bucketGroup: string; objectKey: string; publicUrl?: string | null } | null;
    signedImageUrl: string | null;
  }) {
    const textHint = this.buildEmbeddingText({
      title: input.item.title,
      platform: input.item.platform,
      tag: input.tag,
    });
    const tags = {
      platform: input.item.platform,
      brand: input.tag.brand,
      modelLine: input.tag.modelLine,
      colorFamily: input.tag.colorFamily,
      colorway: input.tag.colorway,
    };
    const imageUrl =
      input.signedImageUrl && !input.signedImageUrl.startsWith('mock://')
        ? input.signedImageUrl
        : input.item.imageUrl ?? null;

    const embeddings = await this.createMainEmbeddingResults({
      productId: input.productId,
      imageUrl,
      textHint,
      tags,
      embeddingKinds: this.productEmbeddingKinds(),
      auditStatus: 'embedding_image_failed',
      auditMessage: 'PRODUCT_IMAGE_EMBEDDING_FAILED',
    });

    for (const item of embeddings) {
      try {
        await this.prisma.productImageEmbedding.create({
          data: this.productImageEmbeddingAdapter.buildCreateData({
            productId: input.productId,
            imageRole: item.imageRole,
            embeddingKind: item.embeddingKind,
            sourceImageUrl: input.item.imageUrl ?? null,
            imageBucketGroup: input.storedImage?.bucketGroup ?? null,
            imageObjectKey: input.storedImage?.objectKey ?? null,
            embedding: item.embedding,
            qualityScore: item.qualityScore,
          }),
        });
      } catch (error) {
        await this.prisma.productTagAudit.create({
          data: {
            id: createId('product_audit'),
            importBatchId: input.batchId,
            productId: input.productId,
            status: `embedding_${item.embeddingKind}_failed`,
            conflictJson: toJsonString({
              embeddingKind: item.embeddingKind,
              message: error instanceof Error ? error.message : 'PRODUCT_EMBEDDING_FAILED',
            }),
          },
        });
      }
    }
  }

  private async createStyleImageEmbeddings(input: {
    batchId: string;
    productId: string;
    item: ProductImportItemDto;
    tag: ProductTagResult;
  }) {
    const styleImages = this.productRawPayloadAdapter
      .extractStyleImages(input.item.rawPayload)
      .slice(0, 12);
    if (styleImages.length === 0) return;

    const baseText = this.buildEmbeddingText({
      title: input.item.title,
      platform: input.item.platform,
      tag: input.tag,
    });

    for (const styleImage of styleImages) {
      try {
        const storedStyleImage = await this.storeStyleImage({
          productId: input.productId,
          styleId: styleImage.styleId,
          imageUrl: styleImage.imageUrl,
        });
        const signedStyleImageUrl = storedStyleImage
          ? (await this.storage.getSignedReadUrl?.({
              bucketGroup: storedStyleImage.bucketGroup,
              objectKey: storedStyleImage.objectKey,
              expiresSeconds: 900,
            })) ?? null
          : null;
        const imageUrl =
          signedStyleImageUrl && !signedStyleImageUrl.startsWith('mock://')
            ? signedStyleImageUrl
            : styleImage.imageUrl;
        const styleText = [baseText, styleImage.styleName].filter(Boolean).join(' ');
        const tags = {
          platform: input.item.platform,
          brand: input.tag.brand,
          modelLine: input.tag.modelLine,
          colorFamily: input.tag.colorFamily,
          colorway: input.tag.colorway,
          styleId: styleImage.styleId,
          styleName: styleImage.styleName,
        };
        for (const embeddingKind of this.productEmbeddingKinds()) {
          try {
            const embedding = await this.productImageEmbeddingAdapter.embedImageForVector({
              imageUrl,
              textHint: this.textHintForEmbeddingKind(embeddingKind, styleText),
              tags,
              role: 'product_style',
              embeddingKind,
              productId: input.productId,
              styleId: styleImage.styleId,
            });

            await this.prisma.productImageEmbedding.create({
              data: this.productImageEmbeddingAdapter.buildCreateData({
                productId: input.productId,
                styleId: styleImage.styleId,
                imageRole: 'style',
                embeddingKind,
                sourceImageUrl: styleImage.imageUrl,
                imageBucketGroup: storedStyleImage?.bucketGroup ?? null,
                imageObjectKey: storedStyleImage?.objectKey ?? null,
                embedding,
                qualityScore: 0.85,
              }),
            });
          } catch (error) {
            await this.prisma.productTagAudit.create({
              data: {
                id: createId('product_audit'),
                importBatchId: input.batchId,
                productId: input.productId,
                status: `style_embedding_${embeddingKind}_failed`,
                conflictJson: toJsonString({
                  embeddingKind,
                  styleId: styleImage.styleId,
                  message: error instanceof Error ? error.message : 'STYLE_EMBEDDING_FAILED',
                }),
              },
            });
          }
        }
      } catch (error) {
        await this.prisma.productTagAudit.create({
          data: {
            id: createId('product_audit'),
            importBatchId: input.batchId,
            productId: input.productId,
            status: 'style_embedding_failed',
            conflictJson: toJsonString({
              styleId: styleImage.styleId,
              message: error instanceof Error ? error.message : 'STYLE_EMBEDDING_FAILED',
            }),
          },
        });
      }
    }
  }

  private async createEmbeddingsForExistingProduct(
    product: Product,
    embeddingKinds: ProductEmbeddingKind[] = this.productEmbeddingKinds(),
  ) {
    const tag = this.productSourceTagAdapter.buildTagFromProduct(product);
    const baseText = this.buildEmbeddingText({
      title: product.title,
      platform: product.platform,
      tag,
    });
    const tags = {
      platform: product.platform,
      brand: product.brand,
      modelLine: product.modelLine,
      colorFamily: product.colorFamily,
      colorway: product.colorway,
    };
    const created: EmbeddingResult[] = [];
    const mainImageUrl = await this.resolveProductImageUrl(product);
    const mainEmbeddings = await this.createMainEmbeddingsForExistingProduct({
      product,
      imageUrl: mainImageUrl,
      textHint: baseText,
      tags,
      embeddingKinds,
    });
    for (const mainEmbedding of mainEmbeddings) {
      await this.prisma.productImageEmbedding.create({
        data: this.productImageEmbeddingAdapter.buildCreateData({
          productId: product.id,
          imageRole: mainEmbedding.imageRole,
          embeddingKind: mainEmbedding.embeddingKind,
          sourceImageUrl: product.sourceImageUrl,
          imageBucketGroup: product.imageBucketGroup,
          imageObjectKey: product.imageObjectKey,
          embedding: mainEmbedding.embedding,
          qualityScore: mainEmbedding.qualityScore,
        }),
      });
      created.push(mainEmbedding.embedding);
    }

    for (const styleImage of this.productRawPayloadAdapter
      .extractStyleImagesFromJson(product.rawPayloadJson)
      .slice(0, 12)) {
      try {
        const storedStyleImage = await this.storeStyleImage({
          productId: product.id,
          styleId: styleImage.styleId,
          imageUrl: styleImage.imageUrl,
        });
        const signedStyleImageUrl = storedStyleImage
          ? (await this.storage.getSignedReadUrl?.({
              bucketGroup: storedStyleImage.bucketGroup,
              objectKey: storedStyleImage.objectKey,
              expiresSeconds: 900,
            })) ?? null
          : null;
        const imageUrl = signedStyleImageUrl && !signedStyleImageUrl.startsWith('mock://')
          ? signedStyleImageUrl
          : styleImage.imageUrl;
        const styleText = [baseText, styleImage.styleName].filter(Boolean).join(' ');
        const styleTags = {
          ...tags,
          styleId: styleImage.styleId,
          styleName: styleImage.styleName,
        };
        for (const embeddingKind of embeddingKinds) {
          try {
            const embedding = await this.productImageEmbeddingAdapter.embedImageForVector({
              imageUrl,
              textHint: this.textHintForEmbeddingKind(embeddingKind, styleText),
              tags: styleTags,
              role: 'product_style',
              embeddingKind,
              productId: product.id,
              styleId: styleImage.styleId,
            });
            await this.prisma.productImageEmbedding.create({
              data: this.productImageEmbeddingAdapter.buildCreateData({
                productId: product.id,
                styleId: styleImage.styleId,
                imageRole: 'style',
                embeddingKind,
                sourceImageUrl: styleImage.imageUrl,
                imageBucketGroup: storedStyleImage?.bucketGroup ?? null,
                imageObjectKey: storedStyleImage?.objectKey ?? null,
                embedding,
                qualityScore: 0.85,
              }),
            });
            created.push(embedding);
          } catch (error) {
            await this.prisma.productTagAudit.create({
              data: {
                id: createId('product_audit'),
                productId: product.id,
                status: `style_embedding_${embeddingKind}_rebuild_failed`,
                conflictJson: toJsonString({
                  embeddingKind,
                  styleId: styleImage.styleId,
                  message: error instanceof Error ? error.message : 'STYLE_EMBEDDING_REBUILD_FAILED',
                }),
              },
            });
          }
        }
      } catch (error) {
        await this.prisma.productTagAudit.create({
          data: {
            id: createId('product_audit'),
            productId: product.id,
            status: 'style_embedding_rebuild_failed',
            conflictJson: toJsonString({
              styleId: styleImage.styleId,
              message: error instanceof Error ? error.message : 'STYLE_EMBEDDING_REBUILD_FAILED',
            }),
          },
        });
      }
    }

    return created;
  }

  private async createMainEmbeddingsForExistingProduct(input: {
    product: Product;
    imageUrl: string | null;
    textHint: string;
    tags: Record<string, unknown>;
    embeddingKinds: ProductEmbeddingKind[];
  }): Promise<MainEmbeddingCreateResult[]> {
    return this.createMainEmbeddingResults({
      productId: input.product.id,
      imageUrl: input.imageUrl,
      textHint: input.textHint,
      tags: input.tags,
      embeddingKinds: input.embeddingKinds,
      auditStatus: 'embedding_image_rebuild_failed',
      auditMessage: 'PRODUCT_IMAGE_EMBEDDING_REBUILD_FAILED',
    });
  }

  private async createMainEmbeddingResults(input: {
    productId: string;
    imageUrl: string | null;
    textHint: string;
    tags: Record<string, unknown>;
    embeddingKinds: ProductEmbeddingKind[];
    auditStatus: string;
    auditMessage: string;
  }): Promise<MainEmbeddingCreateResult[]> {
    if (input.imageUrl) {
      try {
        const variants = this.mainImageEmbeddingVariants(
          input.embeddingKinds,
          input.textHint,
        );
        return (await this.productImageEmbeddingAdapter.embedImageVariantsForVector({
          imageUrl: input.imageUrl,
          tags: input.tags,
          role: 'product_main',
          productId: input.productId,
          variants,
        })).map((embedding) => {
          const embeddingKind = embedding.embeddingKind ?? 'multimodal';
          return {
            embedding,
            embeddingKind,
            imageRole: this.mainImageRoleForEmbeddingKind(embeddingKind),
            qualityScore: 1,
          };
        });
      } catch (error) {
        await this.prisma.productTagAudit.create({
          data: {
            id: createId('product_audit'),
            productId: input.productId,
            status: input.auditStatus,
            conflictJson: toJsonString({
              embeddingKinds: input.embeddingKinds,
              message: error instanceof Error ? error.message : input.auditMessage,
            }),
          },
        });
      }
    }

    return this.createMainTextFallbackEmbeddings({
      imageUrl: input.imageUrl,
      textHint: input.textHint,
      tags: input.tags,
      embeddingKinds: input.embeddingKinds,
    });
  }

  private mainImageEmbeddingVariants(
    embeddingKinds: ProductEmbeddingKind[],
    textHint: string,
  ): ProductImageEmbeddingVariantInput[] {
    return embeddingKinds.map((embeddingKind) => ({
      variant: embeddingKind === 'visual' ? 'image_only' : 'image_with_tags',
      embeddingKind,
      textHint: this.textHintForEmbeddingKind(embeddingKind, textHint),
    }));
  }

  private mainImageRoleForEmbeddingKind(embeddingKind: ProductEmbeddingKind) {
    return embeddingKind === 'visual' ? 'main_image_only' : 'main_image_with_tags';
  }

  private async createMainTextFallbackEmbeddings(input: {
    imageUrl: string | null;
    textHint: string;
    tags: Record<string, unknown>;
    embeddingKinds: ProductEmbeddingKind[];
  }): Promise<MainEmbeddingCreateResult[]> {
    const created: MainEmbeddingCreateResult[] = [];
    for (const embeddingKind of input.embeddingKinds) {
      const embedding = await this.textFallbackEmbedding({
        embeddingKind,
        textHint: input.textHint,
        tags: {
          ...input.tags,
          embeddingFallback: input.imageUrl ? 'image_embedding_failed' : 'image_url_missing',
        },
      });
      if (!embedding) continue;
      created.push({
        embedding,
        embeddingKind,
        imageRole: 'main_text_fallback',
        qualityScore: input.imageUrl ? 0.45 : 0.4,
      });
    }
    return created;
  }

  private async resolveProductImageUrl(product: Product) {
    if (product.imagePublicUrl && !product.imagePublicUrl.startsWith('mock://')) {
      return product.imagePublicUrl;
    }
    if (product.sourceImageUrl && !product.sourceImageUrl.startsWith('mock://')) {
      return product.sourceImageUrl;
    }
    if (product.imageBucketGroup && product.imageObjectKey) {
      const signedUrl = await this.storage.getSignedReadUrl?.({
        bucketGroup: product.imageBucketGroup,
        objectKey: product.imageObjectKey,
        expiresSeconds: 900,
      });
      if (signedUrl && !signedUrl.startsWith('mock://')) return signedUrl;
    }
    return product.imagePublicUrl ?? product.sourceImageUrl ?? null;
  }

  private async resolveDiagnosticImageUrl(input: {
    assetId?: string;
    imageUrl?: string;
  }) {
    const imageUrl = this.cleanOptionalString(input.imageUrl);
    if (imageUrl) return imageUrl;

    const assetId = this.cleanOptionalString(input.assetId);
    if (!assetId) throw new BadRequestException('ANN_DIAGNOSTIC_IMAGE_REQUIRED');

    const asset = await this.prisma.imageAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset) throw new BadRequestException('ANN_DIAGNOSTIC_ASSET_NOT_FOUND');
    if (asset.uploadStatus !== 'uploaded') {
      throw new BadRequestException('ANN_DIAGNOSTIC_ASSET_NOT_UPLOADED');
    }

    const signedUrl = await this.storage.getSignedReadUrl?.({
      bucketGroup: asset.bucketGroup,
      objectKey: asset.objectKey,
      expiresSeconds: 900,
    });
    if (!signedUrl || signedUrl.startsWith('mock://')) {
      throw new InternalServerErrorException('ANN_DIAGNOSTIC_ASSET_SIGN_URL_FAILED');
    }
    return signedUrl;
  }

  private async getEmbeddingGroups() {
    const embeddings = await this.prisma.productImageEmbedding.findMany({
      select: {
        embeddingKind: true,
        provider: true,
        modelName: true,
        dimension: true,
      },
    });
    const groups = new Map<
      string,
      {
        embeddingKind: string;
        provider: string;
        modelName: string | null;
        dimension: number;
        count: number;
      }
    >();
    for (const embedding of embeddings) {
      const key = `${embedding.embeddingKind}:${embedding.provider}:${embedding.modelName ?? ''}:${embedding.dimension}`;
      const group = groups.get(key) ?? {
        embeddingKind: embedding.embeddingKind,
        provider: embedding.provider,
        modelName: embedding.modelName,
        dimension: embedding.dimension,
        count: 0,
      };
      group.count += 1;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }

  private productEmbeddingKinds(override?: string | null): ProductEmbeddingKind[] {
    if (override) return [this.normalizeEmbeddingKind(override)];

    const configured =
      this.config.get<string[] | string>('embedding.productEmbeddingKinds') ??
      ['visual', 'multimodal'];
    const values = Array.isArray(configured)
      ? configured
      : configured.split(',');
    const normalized = values
      .map((value) => this.normalizeEmbeddingKind(value, null))
      .filter((value): value is ProductEmbeddingKind => value !== null);
    return normalized.length > 0 ? [...new Set(normalized)] : ['visual', 'multimodal'];
  }

  private annEmbeddingKind() {
    return this.normalizeEmbeddingKind(
      this.config.get<string>('embedding.annEmbeddingKind'),
      'visual',
    );
  }

  private normalizeEmbeddingKind(
    value: unknown,
    fallback: ProductEmbeddingKind | null = 'visual',
  ): ProductEmbeddingKind {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'visual' || normalized === 'multimodal') return normalized;
    if (fallback === null) {
      throw new BadRequestException('INVALID_EMBEDDING_KIND');
    }
    return fallback;
  }

  private textHintForEmbeddingKind(
    embeddingKind: ProductEmbeddingKind,
    textHint: string,
  ) {
    return embeddingKind === 'visual' ? undefined : textHint;
  }

  private async textFallbackEmbedding(input: {
    embeddingKind: ProductEmbeddingKind;
    textHint: string;
    tags: Record<string, unknown>;
  }) {
    if (input.embeddingKind === 'visual') return null;
    return this.embeddingProvider.embedText({
      text: input.textHint,
      tags: {
        ...input.tags,
        embeddingKind: input.embeddingKind,
      },
    });
  }

  private clampPositiveInteger(
    value: unknown,
    fallback: number,
    max: number,
  ) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
  }

  private clampNonNegativeInteger(value: unknown, fallback: number) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return fallback;
    return parsed;
  }

  private assertRealEmbeddingProvider() {
    const provider = this.config.get<string>('embedding.provider');
    const allowMockProviders = this.config.get<boolean>('runtime.allowMockProviders') === true;
    if (provider === 'hash' && !allowMockProviders) {
      throw new InternalServerErrorException('HASH_EMBEDDING_PROVIDER_DISABLED_OUTSIDE_DEV');
    }
    if (!provider || provider === 'hash') {
      throw new InternalServerErrorException('REAL_EMBEDDING_PROVIDER_REQUIRED');
    }
  }

  private validateImportDto(dto: ImportProductsDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('PRODUCT_IMPORT_BODY_REQUIRED');
    }
    if (!dto.batchSource || typeof dto.batchSource !== 'string') {
      throw new BadRequestException('PRODUCT_IMPORT_BATCH_SOURCE_REQUIRED');
    }
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('PRODUCT_IMPORT_ITEMS_REQUIRED');
    }
  }

  private cleanOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private validateItem(item: ProductImportItemDto) {
    if (!item || typeof item !== 'object') {
      throw new BadRequestException('PRODUCT_IMPORT_ITEM_REQUIRED');
    }

    const requiredStrings: Array<keyof ProductImportItemDto> = [
      'platform',
      'title',
      'price',
      'currency',
      'stockStatus',
      'productUrl',
    ];
    for (const key of requiredStrings) {
      if (typeof item[key] !== 'string' || String(item[key]).trim().length === 0) {
        throw new BadRequestException(`PRODUCT_IMPORT_${String(key).toUpperCase()}_REQUIRED`);
      }
    }

    if (!PRODUCT_PLATFORMS.includes(item.platform)) {
      throw new BadRequestException('PRODUCT_IMPORT_PLATFORM_UNSUPPORTED');
    }
    if (!PRODUCT_STOCK_STATUSES.includes(item.stockStatus)) {
      throw new BadRequestException('PRODUCT_IMPORT_STOCK_STATUS_UNSUPPORTED');
    }
    if (!item.imageUrl && !item.localImagePath && !item.imageDataBase64) {
      throw new BadRequestException('PRODUCT_IMPORT_IMAGE_REQUIRED');
    }
  }

  private async loadImageContent(item: ProductImportItemDto): Promise<ProductImageContent | null> {
    return this.productImageContentAdapter.loadImageContent({
      imageDataBase64: item.imageDataBase64,
      localImagePath: item.localImagePath,
      imageUrl: item.imageUrl,
      contentType: item.imageContentType,
      filename: `${item.externalId ?? 'product'}.jpg`,
    });
  }

  private async storeStyleImage(input: {
    productId: string;
    styleId: string | null;
    imageUrl: string;
  }) {
    const imageContent = await this.productImageContentAdapter.loadImageContent({
      imageUrl: input.imageUrl,
      filename: `${input.productId}-${input.styleId ?? 'style'}.jpg`,
    });
    if (!imageContent) return null;

    try {
      return await this.storage.putImage({
        assetId: createId('product_style_asset'),
        assetGroupId: input.productId,
        variantType: 'demo_asset',
        content: imageContent.buffer,
        contentType: imageContent.contentType,
        originalFilename: imageContent.filename,
        objectKeyPrefix: 'products/styles',
      });
    } catch {
      return null;
    }
  }

  private buildProductAttributeView(rawPayloadJson: string) {
    return this.productRawPayloadAdapter.buildAttributeView(rawPayloadJson);
  }

  private buildConsensus(modelA: ProductTagResult): ConsensusResult {
    const conflict: Record<string, unknown> = {};
    const accepted = modelA.confidence >= 0.25;
    const tag = {
      category: normalizeProductCategory(modelA.category, 'general'),
      brand: modelA.brand,
      modelLine: modelA.modelLine,
      colorFamily: modelA.colorFamily,
      colorway: modelA.colorway,
      shoeType: modelA.shoeType,
      keywords: [...new Set(modelA.keywords)],
      confidence: Number(modelA.confidence.toFixed(3)),
      raw: {
        consensusSource: 'vision_model',
      },
    };

    return {
      accepted,
      status: accepted ? 'accepted' : 'low_confidence',
      tag,
      conflict,
    };
  }

  private buildSourceAttributeConsensus(tag: ProductTagResult): ConsensusResult {
    return {
      accepted: true,
      status: 'accepted_source_attributes',
      tag,
      conflict: {},
    };
  }

  private buildEmbeddingText(input: {
    title: string;
    platform: string;
    tag: ProductTagResult;
  }) {
    return [
      input.title,
      input.platform,
      input.tag.category,
      input.tag.brand,
      input.tag.modelLine,
      input.tag.colorFamily,
      input.tag.colorway,
      input.tag.shoeType,
      ...input.tag.keywords,
    ]
      .filter(Boolean)
      .join(' ');
  }

  private normalizePlatform(value: unknown): ProductImportItemDto['platform'] {
    const platform = this.toNonEmptyString(value)?.toLowerCase();
    if (platform && PRODUCT_PLATFORMS.includes(platform as ProductImportItemDto['platform'])) {
      return platform as ProductImportItemDto['platform'];
    }
    return 'manual';
  }

  private normalizeStockStatus(value: string | null): ProductImportItemDto['stockStatus'] {
    if (value === 'in_stock' || value === 'out_of_stock') return value;
    return 'unknown';
  }

  private parseDataUrl(value: string) {
    const match = value.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) return null;
    return {
      contentType: match[1] ?? 'image/jpeg',
      base64: match[2] ?? '',
    };
  }

  private getPayloadSchemaVersion(payload: unknown) {
    if (!this.isRecord(payload)) return null;
    return (
      this.toNonEmptyString(payload.schemaVersion) ??
      (Array.isArray(payload.items) ? 'product_import_items.v1' : null)
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }

  private toOptionalNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toNonEmptyString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

}
