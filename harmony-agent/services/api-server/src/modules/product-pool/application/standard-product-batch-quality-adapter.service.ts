import { Injectable } from '@nestjs/common';
import { fromJson } from '../../../common/utils/json';
import {
  ProductBatchQualityAdapter,
  ProductBatchQualityAudit,
} from './product-batch-quality-adapter.interface';

@Injectable()
export class StandardProductBatchQualityAdapterService
  implements ProductBatchQualityAdapter
{
  buildReport(
    input: Parameters<ProductBatchQualityAdapter['buildReport']>[0],
  ): Record<string, unknown> {
    const productCount = input.products.length;
    const searchableCount = input.products.filter(
      (product) => product.tagStatus === 'verified',
    ).length;
    const imageReadyCount = input.products.filter(
      (product) =>
        Boolean(product.imagePublicUrl) ||
        Boolean(product.sourceImageUrl) ||
        Boolean(product.imageBucketGroup && product.imageObjectKey),
    ).length;
    const productUrlCount = input.products.filter((product) =>
      /^https?:\/\//i.test(product.productUrl),
    ).length;
    const visualCount = input.products.filter((product) =>
      product.embeddings.some(
        (embedding) => embedding.embeddingKind === 'visual',
      ),
    ).length;
    const multimodalCount = input.products.filter((product) =>
      product.embeddings.some(
        (embedding) => embedding.embeddingKind === 'multimodal',
      ),
    ).length;

    const rates = {
      importSuccess: this.rate(
        input.batch.succeededCount,
        input.batch.totalCount,
      ),
      searchable: this.rate(searchableCount, productCount),
      imageReady: this.rate(imageReadyCount, productCount),
      productUrlReady: this.rate(productUrlCount, productCount),
      visualEmbedding: this.rate(visualCount, productCount),
      multimodalEmbedding: this.rate(multimodalCount, productCount),
    };
    const qualityScore = Number(
      (
        rates.importSuccess * 0.3 +
        rates.searchable * 0.2 +
        rates.imageReady * 0.15 +
        rates.productUrlReady * 0.1 +
        rates.visualEmbedding * 0.15 +
        rates.multimodalEmbedding * 0.1
      ).toFixed(4),
    );

    return {
      batchId: input.batch.id,
      batchSource: input.batch.batchSource,
      status: input.batch.status,
      qualityScore,
      qualityGrade: this.grade(qualityScore),
      attentionRequired:
        input.batch.failedCount > 0 ||
        qualityScore < 0.85 ||
        input.batch.status === 'failed',
      dimensions: {
        importSuccess: this.dimension(
          input.batch.succeededCount,
          input.batch.totalCount,
        ),
        searchable: this.dimension(searchableCount, productCount),
        imageReady: this.dimension(imageReadyCount, productCount),
        productUrlReady: this.dimension(productUrlCount, productCount),
        visualEmbedding: this.dimension(visualCount, productCount),
        multimodalEmbedding: this.dimension(multimodalCount, productCount),
      },
      failureReasons: this.failureReasons(input.audits),
      auditStatusCounts: this.auditStatusCounts(input.audits),
      generatedAt: new Date().toISOString(),
    };
  }

  private failureReasons(audits: ProductBatchQualityAudit[]) {
    const counts = new Map<string, number>();
    for (const audit of audits) {
      if (!this.isFailureStatus(audit.status)) continue;
      const conflict = fromJson<Record<string, unknown>>(
        audit.conflictJson,
        {},
      );
      const reason =
        this.nonEmptyString(conflict.message) ??
        this.nonEmptyString(conflict.reason) ??
        audit.status;
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private auditStatusCounts(audits: ProductBatchQualityAudit[]) {
    const counts = new Map<string, number>();
    for (const audit of audits) {
      counts.set(audit.status, (counts.get(audit.status) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }

  private dimension(ready: number, total: number) {
    return {
      ready,
      total,
      rate: this.rate(ready, total),
    };
  }

  private rate(ready: number, total: number) {
    return total > 0 ? Number((ready / total).toFixed(4)) : 0;
  }

  private grade(score: number) {
    if (score >= 0.95) return 'A';
    if (score >= 0.85) return 'B';
    if (score >= 0.7) return 'C';
    return 'D';
  }

  private isFailureStatus(status: string) {
    return (
      status.includes('failed') ||
      status.includes('error') ||
      status.includes('conflict') ||
      status.includes('low_confidence')
    );
  }

  private nonEmptyString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }
}
