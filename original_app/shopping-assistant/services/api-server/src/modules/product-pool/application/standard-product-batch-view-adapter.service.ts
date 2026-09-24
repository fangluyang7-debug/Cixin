import { Injectable } from '@nestjs/common';
import { ProductImportBatch } from '@prisma/client';
import { fromJson } from '../../../common/utils/json';
import {
  ProductBatchAuditStatusRow,
  ProductBatchCounts,
  ProductRecentBatchView,
  ProductBatchViewAdapter,
} from './product-batch-view-adapter.interface';

@Injectable()
export class StandardProductBatchViewAdapterService
  implements ProductBatchViewAdapter
{
  toRecentBatch(batch: ProductRecentBatchView): Record<string, unknown> {
    return {
      batchId: batch.id,
      batchSource: batch.batchSource,
      status: batch.status,
      totalCount: batch.totalCount,
      succeededCount: batch.succeededCount,
      failedCount: batch.failedCount,
      createdAt: batch.createdAt.toISOString(),
    };
  }

  toBatchSummary(
    batch: Pick<
      ProductImportBatch,
      | 'id'
      | 'batchSource'
      | 'status'
      | 'totalCount'
      | 'succeededCount'
      | 'failedCount'
      | 'rawJson'
      | 'createdAt'
    >,
    counts: ProductBatchCounts,
  ): Record<string, unknown> {
    const raw = fromJson<Record<string, unknown>>(batch.rawJson, {});
    const progress =
      raw.progress && typeof raw.progress === 'object'
        ? (raw.progress as Record<string, unknown>)
        : {};
    return {
      batchId: batch.id,
      batchSource: batch.batchSource,
      status: batch.status,
      totalCount: batch.totalCount,
      succeededCount: batch.succeededCount,
      failedCount: batch.failedCount,
      productCount: counts.productCount,
      searchableProductCount: counts.searchableProductCount,
      productsWithEmbeddingCount: counts.productsWithEmbeddingCount,
      embeddingCount: counts.embeddingCount,
      createdCount: this.numberValue(progress.createdCount),
      updatedCount: this.numberValue(progress.updatedCount),
      processedCount: this.numberValue(progress.processedCount),
      startedAt: this.stringValue(raw.startedAt),
      completedAt: this.stringValue(raw.completedAt),
      rolledBackAt: this.stringValue(raw.rolledBackAt),
      rollback: raw.rollback ?? null,
      changeCount: counts.changeCount,
      pendingRollbackChangeCount: counts.pendingRollbackChangeCount,
      canRollback:
        counts.pendingRollbackChangeCount > 0 &&
        !['queued', 'processing', 'rolled_back'].includes(batch.status),
      embeddingCoverage:
        counts.productCount > 0
          ? Number(
              (counts.productsWithEmbeddingCount / counts.productCount).toFixed(
                4,
              ),
            )
          : 0,
      createdAt: batch.createdAt.toISOString(),
    };
  }

  summarizeRaw(rawJson: string): Record<string, unknown> {
    const raw = fromJson<Record<string, unknown>>(rawJson, {});
    const items = Array.isArray(raw.items) ? raw.items : [];
    const summarized = { ...raw };
    delete summarized.items;
    return {
      ...summarized,
      itemCount: items.length,
    };
  }

  toAuditStatusCounts(rows: ProductBatchAuditStatusRow[]) {
    return rows.map((row) => ({
      status: row.status,
      count: row.count,
    }));
  }

  private numberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' ? value : null;
  }
}
