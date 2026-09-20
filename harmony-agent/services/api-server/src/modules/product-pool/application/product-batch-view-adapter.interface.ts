import { ProductImportBatch } from '@prisma/client';

export const PRODUCT_BATCH_VIEW_ADAPTER = Symbol(
  'PRODUCT_BATCH_VIEW_ADAPTER',
);

export interface ProductBatchCounts {
  productCount: number;
  searchableProductCount: number;
  productsWithEmbeddingCount: number;
  embeddingCount: number;
  changeCount: number;
  pendingRollbackChangeCount: number;
}

export interface ProductBatchAuditStatusRow {
  status: string;
  count: number;
}

export type ProductRecentBatchView = Pick<
  ProductImportBatch,
  | 'id'
  | 'batchSource'
  | 'status'
  | 'totalCount'
  | 'succeededCount'
  | 'failedCount'
  | 'createdAt'
>;

export interface ProductBatchViewAdapter {
  toRecentBatch(batch: ProductRecentBatchView): Record<string, unknown>;
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
  ): Record<string, unknown>;
  summarizeRaw(rawJson: string): Record<string, unknown>;
  toAuditStatusCounts(
    rows: ProductBatchAuditStatusRow[],
  ): Array<Record<string, unknown>>;
}
