import { Product } from '@prisma/client';
import { CandidateVisualVerificationResult } from '../../../adapters/model/model-adapter.interface';
import { CandidateSeed } from '../../../adapters/search-provider/search-provider.interface';

export const PRODUCT_SEARCH_RESULT_ADAPTER = Symbol(
  'PRODUCT_SEARCH_RESULT_ADAPTER',
);

export interface ProductSearchCandidateRecord {
  product: Product;
  styleId: string | null;
  recallSources: Set<'tag' | 'ann'>;
  tagMatchScore: number;
  annScore: number;
  rawAnnScore: number;
  annPassedMinScore: boolean;
  businessScore: number;
  initialScore: number;
  embeddingId?: string | null;
  imageRole?: string | null;
  embeddingKind?: string | null;
  embeddingProvider?: string | null;
  visualVerifyScore: number;
  finalScore: number;
  verification: CandidateVisualVerificationResult;
  coverImageUrl: string;
}

export interface ProductSearchResultAdapter {
  toCandidateSeed(candidate: ProductSearchCandidateRecord): CandidateSeed;
}
