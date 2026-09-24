export const PRODUCT_BATCH_QUALITY_ADAPTER = Symbol(
  'PRODUCT_BATCH_QUALITY_ADAPTER',
);

export interface ProductBatchQualityProduct {
  tagStatus: string;
  productUrl: string;
  sourceImageUrl: string | null;
  imagePublicUrl: string | null;
  imageBucketGroup: string | null;
  imageObjectKey: string | null;
  embeddings: Array<{ embeddingKind: string }>;
}

export interface ProductBatchQualityAudit {
  status: string;
  conflictJson: string;
}

export interface ProductBatchQualityAdapter {
  buildReport(input: {
    batch: {
      id: string;
      batchSource: string;
      status: string;
      totalCount: number;
      succeededCount: number;
      failedCount: number;
      createdAt: Date;
    };
    products: ProductBatchQualityProduct[];
    audits: ProductBatchQualityAudit[];
  }): Record<string, unknown>;
}
