import { BadRequestException, GoneException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CandidatePaginationCursor } from '@prisma/client';
import { createHash } from 'node:crypto';
import { createId } from '../../../common/utils/id';
import { fromJson, toJsonString } from '../../../common/utils/json';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { CandidateCursorAdapter } from './candidate-cursor-adapter.interface';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class StandardCandidateCursorAdapterService implements CandidateCursorAdapter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  normalizeLimit(value: unknown) {
    if (value === undefined || value === null) {
      return this.initialReturnLimit();
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('INVALID_CANDIDATE_MORE_LIMIT');
    }
    return Math.max(1, Math.min(100, parsed));
  }

  findActive(candidateSnapshotId: string) {
    return this.prisma.candidatePaginationCursor.findFirst({
      where: {
        candidateSnapshotId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createForSnapshot(input: {
    sessionId: string;
    candidateSnapshotId: string;
    preprocessSnapshotId?: string | null;
    filter: Record<string, unknown>;
    offset: number;
    limit?: number;
    sortRule?: string | null;
    exhausted?: boolean;
  }) {
    const limit = this.normalizeLimit(input.limit);
    await this.prisma.candidatePaginationCursor.deleteMany({
      where: { candidateSnapshotId: input.candidateSnapshotId },
    });
    return this.prisma.candidatePaginationCursor.create({
      data: {
        id: createId('cand_cursor'),
        sessionId: input.sessionId,
        candidateSnapshotId: input.candidateSnapshotId,
        preprocessSnapshotId: input.preprocessSnapshotId ?? null,
        filterHash: this.hashFilter(input.filter),
        offset: input.offset,
        limit,
        sortRule: input.sortRule ?? this.toString(input.filter.sortRule),
        exhausted: input.exhausted ?? false,
        expiresAt: this.cursorExpiresAt(),
        rawJson: toJsonString({
          createdBy: 'CandidateCursorAdapter.createForSnapshot',
          filter: input.filter,
        }),
      },
    });
  }

  async resolveForSnapshot(input: {
    cursorId?: string;
    sessionId: string;
    candidateSnapshotId: string;
    preprocessSnapshotId?: string | null;
    filter: Record<string, unknown>;
    offset: number;
    limit: number;
    sortRule?: string | null;
  }) {
    const cursor = input.cursorId
      ? await this.prisma.candidatePaginationCursor.findUnique({ where: { id: input.cursorId } })
      : await this.findActive(input.candidateSnapshotId);
    const usableCursor =
      cursor ??
      (await this.createForSnapshot({
        sessionId: input.sessionId,
        candidateSnapshotId: input.candidateSnapshotId,
        preprocessSnapshotId: input.preprocessSnapshotId,
        filter: input.filter,
        offset: input.offset,
        limit: input.limit,
        sortRule: input.sortRule,
      }));

    this.assertUsable({
      cursor: usableCursor,
      sessionId: input.sessionId,
      candidateSnapshotId: input.candidateSnapshotId,
      preprocessSnapshotId: input.preprocessSnapshotId ?? null,
      filterHash: this.hashFilter(input.filter),
    });

    return usableCursor;
  }

  updateAfterAppend(input: {
    cursor: CandidatePaginationCursor;
    requestedLimit: number;
    returnedCount: number;
    newOffset: number;
    exhausted?: boolean;
  }) {
    const exhausted = input.exhausted ?? input.returnedCount < input.requestedLimit;
    return this.prisma.candidatePaginationCursor.update({
      where: { id: input.cursor.id },
      data: {
        offset: input.newOffset,
        limit: input.requestedLimit,
        exhausted,
        rawJson: toJsonString({
          ...fromJson<JsonRecord>(input.cursor.rawJson, {}),
          lastRequest: {
            requestedAt: new Date().toISOString(),
            requestedLimit: input.requestedLimit,
            returnedCount: input.returnedCount,
            previousOffset: input.cursor.offset,
            newOffset: input.newOffset,
          },
        }),
      },
    });
  }

  buildCursorView(cursor: CandidatePaginationCursor, fromRank: number, toRank: number) {
    return {
      nextCursor: cursor.id,
      hasMore: !cursor.exhausted,
      offset: cursor.offset,
      limit: cursor.limit,
      returnedRange: {
        from: fromRank,
        to: toRank,
      },
      expiresAt: cursor.expiresAt.toISOString(),
    };
  }

  buildCursorSummaryView(cursor: CandidatePaginationCursor) {
    return {
      nextCursor: cursor.id,
      hasMore: !cursor.exhausted,
      offset: cursor.offset,
      limit: cursor.limit,
      expiresAt: cursor.expiresAt.toISOString(),
    };
  }

  private assertUsable(input: {
    cursor: CandidatePaginationCursor;
    sessionId: string;
    candidateSnapshotId: string;
    preprocessSnapshotId: string | null;
    filterHash: string;
  }) {
    if (input.cursor.sessionId !== input.sessionId) {
      throw new BadRequestException('CANDIDATE_CURSOR_SESSION_MISMATCH');
    }
    if (input.cursor.candidateSnapshotId !== input.candidateSnapshotId) {
      throw new GoneException('CANDIDATE_CURSOR_EXPIRED');
    }
    if (input.cursor.preprocessSnapshotId !== input.preprocessSnapshotId) {
      throw new GoneException('CANDIDATE_CURSOR_EXPIRED');
    }
    if (input.cursor.filterHash !== input.filterHash) {
      throw new GoneException('CANDIDATE_CURSOR_EXPIRED');
    }
    if (input.cursor.expiresAt.getTime() < Date.now()) {
      throw new GoneException('CANDIDATE_CURSOR_EXPIRED');
    }
  }

  private hashFilter(filter: Record<string, unknown>) {
    return createHash('sha256').update(this.stableJson(filter)).digest('hex');
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableJson(record[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private cursorExpiresAt() {
    const hours = Number(process.env.CANDIDATE_CURSOR_TTL_HOURS ?? 24);
    const ttlMs =
      Number.isFinite(hours) && hours > 0
        ? hours * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
    return new Date(Date.now() + ttlMs);
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private initialReturnLimit() {
    const configured = this.config.get<number>('search.initialReturnLimit') ?? 30;
    const parsed = Number(configured);
    if (!Number.isFinite(parsed) || parsed <= 0) return 30;
    return Math.floor(parsed);
  }
}
