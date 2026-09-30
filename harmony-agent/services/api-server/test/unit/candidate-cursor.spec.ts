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
        findFirst: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
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

  it('rebinds an implicit cursor after a profile changes the filter', async () => {
    const filter = { color: '黑色' };
    const { adapter, prisma, hash } = harness(filter);
    prisma.candidatePaginationCursor.findFirst.mockResolvedValue(cursor({ filterHash: 'old-filter' }));
    prisma.candidatePaginationCursor.create.mockImplementation(async ({ data }) => cursor({
      id: data.id, filterHash: hash, offset: data.offset,
    }));

    const renewed = await adapter.resolveForSnapshot({ sessionId: 'session_1',
      candidateSnapshotId: 'snapshot_1', preprocessSnapshotId: 'preprocess_1',
      filter, offset: 30, limit: 30 });

    expect(renewed.filterHash).toBe(hash);
    expect(renewed.offset).toBe(30);
    expect(prisma.candidatePaginationCursor.deleteMany).toHaveBeenCalledWith({
      where: { candidateSnapshotId: 'snapshot_1' },
    });
  });

  it('rejects an explicitly named cursor that no longer exists', async () => {
    const { adapter, prisma } = harness({});
    prisma.candidatePaginationCursor.findUnique.mockResolvedValue(null);
    await expect(adapter.resolveForSnapshot({ cursorId: 'deleted', sessionId: 'session_1',
      candidateSnapshotId: 'snapshot_1', filter: {}, offset: 30, limit: 30 }))
      .rejects.toBeInstanceOf(GoneException);
  });
});
