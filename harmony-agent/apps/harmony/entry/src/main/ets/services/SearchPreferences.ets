import { ModelTier, TaskContext } from 'scheduler';

export enum SearchPreference { BALANCED = 'BALANCED', SPEED = 'SPEED', QUALITY = 'QUALITY' }

export function searchContext(queryLength: number, candidateCount: number, preference: SearchPreference,
  highQuality: boolean = false): TaskContext {
  const quality = highQuality || preference === SearchPreference.QUALITY;
  return { deadlineMs: 3000, freshnessMs: 4000, userVisible: true, userWaiting: true,
    targetLatencyMs: preference === SearchPreference.SPEED ? 300 : preference === SearchPreference.QUALITY ? 800 : 500,
    softDeadlineMs: 1500, accuracyFloor: quality ? ModelTier.HIGH_ACCURACY : ModelTier.LIGHTWEIGHT,
    highQuality: quality, businessImportance: 0.8, inputTokens: Math.max(1, queryLength),
    candidateCount: candidateCount, deduplicationKey: 'search-page', networkAllowed: false };
}
