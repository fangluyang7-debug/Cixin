import { Injectable } from '@nestjs/common';
import { CandidateSeed } from '../../../adapters/search-provider/search-provider.interface';
import {
  FallbackCandidateAdapter,
  FallbackReasonPayload,
} from './fallback-candidate-adapter.interface';

@Injectable()
export class StandardFallbackCandidateAdapterService implements FallbackCandidateAdapter {
  buildFallbackReason(reason: string): FallbackReasonPayload {
    return {
      degraded: true,
      reason,
      userMessage: '当前没有拿到真实候选商品，请检查后端检索链路或稍后重试。',
    };
  }

  getStableCandidateSeeds(_reason: string): CandidateSeed[] {
    return [];
  }
}
