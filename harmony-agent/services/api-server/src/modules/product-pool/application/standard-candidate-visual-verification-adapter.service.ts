import { Inject, Injectable } from '@nestjs/common';
import {
  CandidateVisualVerificationResult,
  MODEL_ADAPTER,
  ModelAdapter,
} from '../../../adapters/model/model-adapter.interface';
import {
  CandidateVisualVerificationAdapter,
  CandidateVisualVerificationAdapterInput,
} from './candidate-visual-verification-adapter.interface';

@Injectable()
export class StandardCandidateVisualVerificationAdapterService
  implements CandidateVisualVerificationAdapter
{
  constructor(
    @Inject(MODEL_ADAPTER)
    private readonly model: ModelAdapter,
  ) {}

  verifyCandidate(
    input: CandidateVisualVerificationAdapterInput,
  ): Promise<CandidateVisualVerificationResult> {
    return this.model.verifyCandidateVisualMatch({
      queryProfile: input.queryProfile,
      queryImageUrl: input.queryImageUrl,
      candidate: input.candidate,
    });
  }
}
