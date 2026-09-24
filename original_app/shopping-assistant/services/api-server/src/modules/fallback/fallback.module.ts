import { Module } from '@nestjs/common';
import { FallbackService } from './application/fallback.service';
import { FALLBACK_CANDIDATE_ADAPTER } from './application/fallback-candidate-adapter.interface';
import { StandardFallbackCandidateAdapterService } from './application/standard-fallback-candidate-adapter.service';

@Module({
  providers: [
    FallbackService,
    StandardFallbackCandidateAdapterService,
    {
      provide: FALLBACK_CANDIDATE_ADAPTER,
      useExisting: StandardFallbackCandidateAdapterService,
    },
  ],
  exports: [FallbackService],
})
export class FallbackModule {}
