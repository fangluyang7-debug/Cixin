import { CandidateSeed } from '../../../adapters/search-provider/search-provider.interface';

export const FALLBACK_CANDIDATE_ADAPTER = Symbol('FALLBACK_CANDIDATE_ADAPTER');

export interface FallbackReasonPayload {
  degraded: true;
  reason: string;
  userMessage: string;
}

export interface FallbackCandidateAdapter {
  buildFallbackReason(reason: string): FallbackReasonPayload;
  getStableCandidateSeeds(reason: string): CandidateSeed[];
}
