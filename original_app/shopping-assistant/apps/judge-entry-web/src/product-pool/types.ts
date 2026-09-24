export type JsonRecord = Record<string, unknown>;

export interface ApiEnvelope<T> {
  success: boolean;
  requestId: string;
  data: T | null;
  error: null | {
    code: string;
    message: string;
    details?: JsonRecord;
  };
}

export interface ProductPoolStats {
  totalProducts: number;
  searchableProducts: number;
  embeddingCount: number;
  embeddingCoverage: {
    visualProducts: number;
    multimodalProducts: number;
    visualRate?: number;
    multimodalRate?: number;
  };
  categoryGroups: Array<{
    category: string | null;
    normalizedCategory: string;
    count: number;
  }>;
  platformGroups?: Array<{ platform: string; count: number }>;
  tagStatusGroups?: Array<{ status: string; count: number }>;
  recentBatches: BatchSummary[];
}

export interface BatchSummary {
  batchId: string;
  batchSource: string;
  status: string;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  productCount: number;
  searchableProductCount: number;
  productsWithEmbeddingCount: number;
  embeddingCount: number;
  embeddingCoverage: number;
  createdCount?: number;
  updatedCount?: number;
  processedCount?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  rolledBackAt?: string | null;
  changeCount?: number;
  pendingRollbackChangeCount?: number;
  canRollback?: boolean;
  createdAt: string;
}

export interface BatchList {
  total: number;
  limit: number;
  offset: number;
  items: BatchSummary[];
}

export interface ProductListItem {
  productId: string;
  importBatchId?: string | null;
  externalId?: string | null;
  platform: string;
  title: string;
  price: { amount: string; currency: string };
  stockStatus: string;
  shopName?: string | null;
  shopType?: string | null;
  productUrl: string;
  imageUrl?: string | null;
  tagStatus: string;
  tagConfidence?: number | null;
  brand?: string | null;
  category?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  embeddingReady: boolean;
  counts: {
    embeddings: number;
    tagAudits: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProductList {
  total: number;
  limit: number;
  offset: number;
  items: ProductListItem[];
}

export interface ProductDetail extends ProductListItem {
  importBatch?: {
    batchId: string;
    batchSource: string;
    status: string;
    createdAt: string;
  } | null;
  normalizedTags?: JsonRecord;
  keywords?: string[];
  rawPayload?: JsonRecord;
  embeddings?: Array<{
    embeddingId: string;
    imageRole: string;
    embeddingKind: string;
    provider: string;
    modelName?: string | null;
    dimension: number;
    qualityScore?: number | null;
    createdAt: string;
  }>;
  tagAudits?: Array<{
    auditId: string;
    status: string;
    conflict?: JsonRecord;
    createdAt: string;
  }>;
}

export interface BatchDetail extends BatchSummary {
  raw?: JsonRecord;
  auditStatusCounts: Array<{ status: string; count: number }>;
  products: ProductListItem[];
}

export interface BatchQuality {
  batchId: string;
  batchSource: string;
  status: string;
  qualityScore: number;
  qualityGrade: string;
  attentionRequired: boolean;
  dimensions: Record<
    string,
    { ready: number; total: number; rate: number }
  >;
  failureReasons: Array<{ reason: string; count: number }>;
  auditStatusCounts: Array<{ status: string; count: number }>;
  generatedAt: string;
}

export interface RollbackPreview {
  dryRun: boolean;
  batchId: string;
  batchSource: string;
  changeCount: number;
  createdChangeCount: number;
  updatedChangeCount: number;
  affectedProductCount: number;
  conflictCount: number;
  conflicts: Array<{
    changeId: string;
    productId: string;
    action: string;
    reason: string;
  }>;
}
