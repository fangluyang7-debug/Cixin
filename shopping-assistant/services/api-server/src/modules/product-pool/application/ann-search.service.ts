import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { fromJson } from '../../../common/utils/json';
import { AnnSearchInput, AnnSearchPort, AnnSearchResult } from './ann-search-port.interface';

type SearchEmbedding = {
  id: string;
  productId: string;
  styleId: string | null;
  imageRole: string;
  embeddingKind: string;
  provider: string;
  vectorJson: string;
};

type ScoreEmbeddingsResult = {
  scored: Map<string, AnnSearchResult>;
  scannedEmbeddingCount: number;
  batchCount: number;
};

@Injectable()
export class AnnSearchService implements AnnSearchPort {
  private readonly logger = new Logger(AnnSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async search(input: AnnSearchInput): Promise<AnnSearchResult[]> {
    const startedAt = Date.now();
    const productIds = input.productIds ?? [];
    const embeddingKind =
      input.embeddingKind ??
      this.config.get<'visual' | 'multimodal'>('embedding.annEmbeddingKind') ??
      'visual';
    const compatibility = this.embeddingCompatibility(input.queryVector);
    const scoreResult = await this.scoreEmbeddingsForSearch({
      embeddingKind,
      provider: compatibility.provider,
      dimension: compatibility.dimension,
      productIds,
      queryVector: input.queryVector,
    });

    const minScore = input.minScore ?? this.config.get<number>('ann.minScore') ?? 0.72;
    const topK = input.topK ?? this.config.get<number>('ann.topK') ?? 50;

    const results = [...scoreResult.scored.values()]
      .map((item) => ({
        ...item,
        passedMinScore: item.score >= minScore,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    this.logAnnSearchTiming({
      elapsedMs: Date.now() - startedAt,
      embeddingKind,
      provider: compatibility.provider,
      dimension: compatibility.dimension,
      scopedProductCount: productIds.length,
      scannedEmbeddingCount: scoreResult.scannedEmbeddingCount,
      scoredCandidateCount: scoreResult.scored.size,
      returnedCount: results.length,
      batchCount: scoreResult.batchCount,
    });
    return results;
  }

  private cosine(a: number[], b: number[]) {
    const length = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return Number((dot / (Math.sqrt(normA) * Math.sqrt(normB))).toFixed(6));
  }

  private normalizeScore(rawScore: number) {
    return Number(this.clamp01(rawScore).toFixed(6));
  }

  private clamp01(value: number) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private embeddingCompatibility(queryVector: number[]) {
    const expectedProvider = this.config.get<string>('embedding.provider');
    const expectedDimension = this.config.get<number>('embedding.dimension') ?? queryVector.length;
    if (queryVector.length !== expectedDimension) {
      throw new InternalServerErrorException('ANN_QUERY_VECTOR_DIMENSION_MISMATCH');
    }
    return {
      provider: expectedProvider,
      dimension: expectedDimension,
    };
  }

  private async scoreEmbeddingsForSearch(input: {
    embeddingKind: 'visual' | 'multimodal';
    provider?: string;
    dimension: number;
    productIds: string[];
    queryVector: number[];
  }): Promise<ScoreEmbeddingsResult> {
    const scored = new Map<string, AnnSearchResult>();
    const batchSize = Math.max(50, this.config.get<number>('ann.scanBatchSize') ?? 500);
    let cursorId: string | null = null;
    let scannedEmbeddingCount = 0;
    let batchCount = 0;

    for (;;) {
      const batchStartedAt = Date.now();
      const embeddings: SearchEmbedding[] = await this.prisma.productImageEmbedding.findMany({
        where: {
          embeddingKind: input.embeddingKind,
          ...(input.provider ? { provider: input.provider } : {}),
          dimension: input.dimension,
          ...(input.productIds.length > 0 ? { productId: { in: input.productIds } } : {}),
          ...(cursorId ? { id: { gt: cursorId } } : {}),
        },
        select: {
          id: true,
          productId: true,
          styleId: true,
          imageRole: true,
          embeddingKind: true,
          provider: true,
          vectorJson: true,
        },
        orderBy: { id: 'asc' },
        take: batchSize,
      });
      if (embeddings.length === 0) break;
      scannedEmbeddingCount += embeddings.length;
      batchCount += 1;
      this.logAnnBatchTiming({
        elapsedMs: Date.now() - batchStartedAt,
        embeddingKind: input.embeddingKind,
        batchSize: embeddings.length,
        cursorId,
      });

      for (const embedding of embeddings) {
        const vector = fromJson<number[]>(embedding.vectorJson, []);
        if (vector.length === 0) continue;
        const rawScore = this.cosine(input.queryVector, vector);
        const score = this.normalizeScore(rawScore);
        const key = `${embedding.productId}:${embedding.styleId ?? 'product'}`;
        const previous = scored.get(key);
        if (!previous || score > previous.score) {
          scored.set(key, {
            productId: embedding.productId,
            styleId: embedding.styleId,
            imageRole: embedding.imageRole,
            embeddingKind: embedding.embeddingKind,
            rawScore,
            score,
            passedMinScore: false,
            embeddingId: embedding.id,
            provider: this.config.get<string>('ann.provider') ?? 'sqlite_vec',
            embeddingProvider: embedding.provider,
          });
        }
      }

      cursorId = embeddings[embeddings.length - 1].id;
    }

    return {
      scored,
      scannedEmbeddingCount,
      batchCount,
    };
  }

  private logAnnSearchTiming(input: {
    elapsedMs: number;
    embeddingKind: string;
    provider?: string;
    dimension: number;
    scopedProductCount: number;
    scannedEmbeddingCount: number;
    scoredCandidateCount: number;
    returnedCount: number;
    batchCount: number;
  }) {
    if (input.elapsedMs < this.annSlowQueryMs()) return;
    this.logger.warn(
      [
        'slow ann search',
        `elapsedMs=${input.elapsedMs}`,
        `embeddingKind=${input.embeddingKind}`,
        `embeddingProvider=${input.provider ?? 'unknown'}`,
        `dimension=${input.dimension}`,
        `scopedProductCount=${input.scopedProductCount}`,
        `scannedEmbeddingCount=${input.scannedEmbeddingCount}`,
        `scoredCandidateCount=${input.scoredCandidateCount}`,
        `returnedCount=${input.returnedCount}`,
        `batchCount=${input.batchCount}`,
        `annProvider=${this.config.get<string>('ann.provider') ?? 'js_scan'}`,
      ].join(' '),
    );
  }

  private logAnnBatchTiming(input: {
    elapsedMs: number;
    embeddingKind: string;
    batchSize: number;
    cursorId: string | null;
  }) {
    const batchSlowMs = Math.max(250, Math.floor(this.annSlowQueryMs() / 4));
    if (input.elapsedMs < batchSlowMs) return;
    this.logger.warn(
      [
        'slow ann embedding batch',
        `elapsedMs=${input.elapsedMs}`,
        `embeddingKind=${input.embeddingKind}`,
        `batchSize=${input.batchSize}`,
        `cursorId=${input.cursorId ?? 'first'}`,
      ].join(' '),
    );
  }

  private annSlowQueryMs() {
    return this.config.get<number>('ann.slowQueryMs') ?? 2000;
  }
}
