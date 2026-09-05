import { CandidateItem } from '@prisma/client';
import { CandidateSeed } from '../../../adapters/search-provider/search-provider.interface';

export const CANDIDATE_ITEM_ADAPTER = Symbol('CANDIDATE_ITEM_ADAPTER');

export type CandidateItemCreateData = {
  id: string;
  snapshotId?: string;
  title: string;
  platformName: string;
  amount: string;
  currency: string;
  shopName?: string | null;
  shopType?: string | null;
  stockStatus: string;
  coverImageUrl?: string | null;
  productUrl?: string | null;
  matchSummaryJson: string;
  normalizedAttributesJson: string;
  rawPayloadJson: string;
  recommendationReasonJson: string;
  rank: number;
  pageIndex: number;
  productPoolKey?: string | null;
};

export type CandidateItemCreateManyData = CandidateItemCreateData & {
  snapshotId: string;
};

export interface CandidateItemAdapter {
  toCandidateItemData(input: {
    snapshotId?: string;
    item: CandidateSeed;
    rank: number;
    pageIndex: number;
  }): CandidateItemCreateData;
  toCandidateItemCreateManyData(input: {
    snapshotId: string;
    item: CandidateSeed;
    rank: number;
    pageIndex: number;
  }): CandidateItemCreateManyData;
  extractReturnedProductKeys(items: CandidateItem[]): string[];
  extractProductPoolKey(rawPayload: Record<string, unknown>): string | null;
}
