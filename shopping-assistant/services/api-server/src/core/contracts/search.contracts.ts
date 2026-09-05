import { ImageEmbeddingResult, NormalizedBoundingBox } from './image.contracts';
import { ProductProfileContract, StockStatus } from './product.contracts';

export type AnnSearchRequest = {
  queryEmbedding: ImageEmbeddingResult;
  filters?: Record<string, unknown>;
  limit: number;
  excludeProductKeys?: string[];
};

export type AnnSearchResultItem = {
  productPoolKey: string;
  score: number;
  rank: number;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimension: number;
  metadata: Record<string, unknown>;
};

export type AnnSearchResult = {
  provider: string;
  model: string;
  items: AnnSearchResultItem[];
  metadata: Record<string, unknown>;
};

export type CandidateSeedContract = {
  productPoolKey?: string | null;
  title: string;
  platformName: string;
  amount: string;
  currency: string;
  shopName: string;
  shopType: string;
  stockStatus: StockStatus;
  coverImageUrl: string;
  productUrl: string;
  matchSummary: {
    annScore?: number | null;
    visualMatchConfidence?: number | null;
    sameProduct?: boolean | null;
    sameColorway?: boolean | null;
    [key: string]: unknown;
  };
  normalizedAttributes: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  recommendationReason: string[];
};

export type CandidatePageRequest = {
  sessionId: string;
  cursor?: string | null;
  limit: number;
  productProfile?: ProductProfileContract | null;
  queryEmbedding: ImageEmbeddingResult;
  selectedBox?: NormalizedBoundingBox | null;
  filters?: Record<string, unknown>;
  excludeProductKeys: string[];
};

export type CandidatePageResult = {
  candidateSnapshotId: string;
  items: CandidateSeedContract[];
  cursor: {
    nextCursor?: string | null;
    hasMore: boolean;
    returnedRange: {
      from: number;
      to: number;
    };
  };
};
