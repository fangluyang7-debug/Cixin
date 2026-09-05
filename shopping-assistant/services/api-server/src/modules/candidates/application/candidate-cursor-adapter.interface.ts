import { CandidatePaginationCursor } from '@prisma/client';

export const CANDIDATE_CURSOR_ADAPTER = Symbol('CANDIDATE_CURSOR_ADAPTER');

export type CandidateCursorView = {
  nextCursor: string;
  hasMore: boolean;
  offset: number;
  limit: number;
  returnedRange: {
    from: number;
    to: number;
  };
  expiresAt: string;
};

export type CandidateCursorSummaryView = Omit<CandidateCursorView, 'returnedRange'>;

export interface CandidateCursorAdapter {
  normalizeLimit(value: unknown): number;
  findActive(candidateSnapshotId: string): Promise<CandidatePaginationCursor | null>;
  createForSnapshot(input: {
    sessionId: string;
    candidateSnapshotId: string;
    preprocessSnapshotId?: string | null;
    filter: Record<string, unknown>;
    offset: number;
    limit?: number;
    sortRule?: string | null;
    exhausted?: boolean;
  }): Promise<CandidatePaginationCursor>;
  resolveForSnapshot(input: {
    cursorId?: string;
    sessionId: string;
    candidateSnapshotId: string;
    preprocessSnapshotId?: string | null;
    filter: Record<string, unknown>;
    offset: number;
    limit: number;
    sortRule?: string | null;
  }): Promise<CandidatePaginationCursor>;
  updateAfterAppend(input: {
    cursor: CandidatePaginationCursor;
    requestedLimit: number;
    returnedCount: number;
    newOffset: number;
    exhausted?: boolean;
  }): Promise<CandidatePaginationCursor>;
  buildCursorView(
    cursor: CandidatePaginationCursor,
    fromRank: number,
    toRank: number,
  ): CandidateCursorView;
  buildCursorSummaryView(cursor: CandidatePaginationCursor): CandidateCursorSummaryView;
}
