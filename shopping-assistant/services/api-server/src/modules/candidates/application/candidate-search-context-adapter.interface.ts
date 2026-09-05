import {
  FilterSnapshot,
  ProductProfileSnapshot,
  QueryImagePreprocessSnapshot,
} from '@prisma/client';
import { ProductProfileResult } from '../../../adapters/model/model-adapter.interface';

export const CANDIDATE_SEARCH_CONTEXT_ADAPTER = Symbol(
  'CANDIDATE_SEARCH_CONTEXT_ADAPTER',
);

export interface CandidateSearchContextAdapter {
  toQueryEmbedding(
    preprocess: Pick<QueryImagePreprocessSnapshot, 'embeddingVectorJson'> | null,
  ): number[];
  toFilterRaw(filter: Pick<FilterSnapshot, 'rawJson'> | null): Record<string, unknown>;
  toProfile(snapshot: ProductProfileSnapshot | null): ProductProfileResult | null;
  toKeywords(snapshot: Pick<ProductProfileSnapshot, 'keywordsJson' | 'category'> | null): string[];
}
