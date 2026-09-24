import {
  CandidateVisualVerificationResult,
  ProductProfileResult,
} from '../../../adapters/model/model-adapter.interface';

export const CANDIDATE_VISUAL_VERIFICATION_ADAPTER = Symbol(
  'CANDIDATE_VISUAL_VERIFICATION_ADAPTER',
);

export interface CandidateVisualVerificationAdapterInput {
  queryProfile: ProductProfileResult;
  queryImageUrl: string | null;
  candidate: {
    title: string;
    brand?: string | null;
    modelLine?: string | null;
    colorFamily?: string | null;
    colorway?: string | null;
    imageUrl?: string | null;
  };
}

export interface CandidateVisualVerificationAdapter {
  verifyCandidate(
    input: CandidateVisualVerificationAdapterInput,
  ): Promise<CandidateVisualVerificationResult>;
}
