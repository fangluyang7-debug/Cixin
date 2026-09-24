import { CandidateItem } from '@prisma/client';

export const CANDIDATE_VIEW_ADAPTER = Symbol('CANDIDATE_VIEW_ADAPTER');

export interface CandidateViewAdapter {
  buildCandidateView(
    item: CandidateItem,
    sortedItems: CandidateItem[],
    priceRank: number,
  ): Record<string, unknown>;
  buildCandidateDetailView(
    item: CandidateItem,
    sortedItems: CandidateItem[],
    priceRank: number,
  ): Record<string, unknown>;
  buildAppliedFilterView(appliedFilterJson: string): Record<string, unknown>;
  buildFallbackView(payloadJson: string | null): Record<string, unknown>;
  buildSortOptions(): Array<Record<string, unknown>>;
  buildSearchProgress(items: Array<{ platformName: string; candidateItemId: string }>): Record<string, unknown>;
  buildRequiredInfoView(appliedFilter: Record<string, unknown>): Record<string, unknown>;
}
