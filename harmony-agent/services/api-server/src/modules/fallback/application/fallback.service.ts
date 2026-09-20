import { Inject, Injectable } from '@nestjs/common';
import { CandidateSeed } from '../../../adapters/search-provider/search-provider.interface';
import {
  FALLBACK_CANDIDATE_ADAPTER,
  FallbackCandidateAdapter,
} from './fallback-candidate-adapter.interface';

@Injectable()
export class FallbackService {
  constructor(
    @Inject(FALLBACK_CANDIDATE_ADAPTER)
    private readonly fallbackCandidateAdapter: FallbackCandidateAdapter,
  ) {}

  buildFallbackReason(reason: string) {
    return this.fallbackCandidateAdapter.buildFallbackReason(reason);
  }

  getStableCandidateSeeds(reason: string): CandidateSeed[] {
    return this.fallbackCandidateAdapter.getStableCandidateSeeds(reason);
  }
}
