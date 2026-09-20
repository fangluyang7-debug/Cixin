import { ProductProfileResult } from '../../../adapters/model/model-adapter.interface';

export const SEARCH_QUERY_EMBEDDING_ADAPTER = Symbol(
  'SEARCH_QUERY_EMBEDDING_ADAPTER',
);

export interface SearchQueryEmbeddingInput {
  keywords: string[];
  profile: ProductProfileResult;
  queryImageUrl: string | null;
}

export interface SearchQueryEmbeddingAdapter {
  buildQueryEmbedding(input: SearchQueryEmbeddingInput): Promise<number[]>;
}
