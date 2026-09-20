import {
  CandidateItem,
  CandidateSnapshot,
  FilterSnapshot,
  ProductProfileSnapshot,
  QueryImagePreprocessSnapshot,
  QuerySession,
} from '@prisma/client';

export const SESSION_VIEW_ADAPTER = Symbol('SESSION_VIEW_ADAPTER');

export type SessionViewRecord = QuerySession & {
  profileSnapshot: ProductProfileSnapshot | null;
  filterSnapshots: FilterSnapshot[];
  candidateSnapshots: Array<
    CandidateSnapshot & {
      items: CandidateItem[];
      _count?: { items: number };
    }
  >;
  queryImagePreprocessSnapshots: QueryImagePreprocessSnapshot[];
};

export interface SessionViewAdapter {
  toSessionDetail(session: SessionViewRecord): Record<string, unknown>;
}
