import { ProductEmbeddingKind } from './product-image-embedding-adapter.interface';

export const ANN_SEARCH_PORT = Symbol('ANN_SEARCH_PORT');

export interface AnnSearchInput {
  queryVector: number[];
  productIds?: string[];
  topK?: number;
  minScore?: number;
  embeddingKind?: ProductEmbeddingKind;
}

export interface AnnSearchResult {
  productId: string;
  styleId: string | null;
  imageRole: string;
  rawScore: number;
  score: number;
  passedMinScore: boolean;
  embeddingId: string;
  embeddingKind: string;
  provider: string;
  embeddingProvider: string;
}

export interface AnnSearchPort {
  search(input: AnnSearchInput): Promise<AnnSearchResult[]>;
}
