import {
  CandidateItem,
  CandidateSnapshot,
  ProductProfileSnapshot,
  QueryImagePreprocessSnapshot,
  QuerySession,
} from '@prisma/client';

export const SEARCH_EVENT_ADAPTER = Symbol('SEARCH_EVENT_ADAPTER');

export interface SessionSearchEvent {
  type: string;
  sessionId: string;
  data: Record<string, unknown>;
}

export type SearchEventReplaySession = QuerySession & {
  profileSnapshot: ProductProfileSnapshot | null;
  queryImagePreprocessSnapshots: QueryImagePreprocessSnapshot[];
  candidateSnapshots: Array<CandidateSnapshot & { items: CandidateItem[] }>;
};

export interface SearchEventAdapter {
  toReplayEvents(input: {
    sessionId: string;
    session: SearchEventReplaySession;
  }): SessionSearchEvent[];
}
