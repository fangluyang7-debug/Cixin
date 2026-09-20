import { ConfigService } from '@nestjs/config';
import { CandidatePaginationCursor } from '@prisma/client';
import { GoneException } from '@nestjs/common';
import { StandardCandidateCursorAdapterService } from '../../src/modules/candidates/application/standard-candidate-cursor-adapter.service';

function cursor(
  overrides: Partial<CandidatePaginationCursor> = {},
): CandidatePaginationCursor {
  return {
    id: 'cursor_1',
    sessionId: 'session_1',
    candidateSnapshotId: 'snapshot_1',
    preprocessSnapshotId: 'preprocess_1',
    filterHash: '',
    offset: 30,
    limit: 30,
    sortRule: 'relevance_desc',
    exhausted: false,
    expiresAt: new Date(Date.now() + 60_000),
    rawJson: '{}',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('StandardCandidateCursorAdapterService', () => {
  function harness(filter: Record<string, unknown>) {
    const prisma = {
      candidatePaginationCursor: {
        findUnique: jest.fn(),
      },
    };
    const adapter = new StandardCandidateCursorAdapterService(
      prisma as never,
      new ConfigService({ search: { initialReturnLimit: 30 } }),
    );
    const hash = (
      adapter as unknown as { hashFilter(value: Record<string, unknown>): string }
    ).hashFilter(filter);
    return { adapter, prisma, hash };
  }

  it.each([
    ['snapshot', { candidateSnapshotId: 'snapshot_2' }],
    ['preprocess snapshot', { preprocessSnapshotId: 'preprocess_2' }],
    ['filter', { filterHash: 'different' }],
    ['expiry', { expiresAt: new Date(Date.now() - 1) }],
  ])('rejects a cursor after %s changes', async (_name, overrides) => {
    const filter = { priceMax: '500', stockOnly: true };
    const { adapter, prisma, hash } = harness(filter);
    prisma.candidatePaginationCursor.findUnique.mockResolvedValue(
      cursor({ filterHash: hash, ...overrides }),
    );

    await expect(
      adapter.resolveForSnapshot({
        cursorId: 'cursor_1',
        sessionId: 'session_1',
        candidateSnapshotId: 'snapshot_1',
        preprocessSnapshotId: 'preprocess_1',
        filter,
        offset: 30,
        limit: 30,
      }),
    ).rejects.toBeInstanceOf(GoneException);
  });
});
