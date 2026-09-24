import { Injectable } from '@nestjs/common';
import { fromJson } from '../../../common/utils/json';
import {
  SearchEventAdapter,
  SessionSearchEvent,
  SearchEventReplaySession,
} from './search-event-adapter.interface';

@Injectable()
export class StandardSearchEventAdapterService implements SearchEventAdapter {
  toReplayEvents(input: {
    sessionId: string;
    session: SearchEventReplaySession;
  }): SessionSearchEvent[] {
    const { sessionId, session } = input;
    const candidateSnapshot = session.candidateSnapshots[0] ?? null;
    const preprocessSnapshot = session.queryImagePreprocessSnapshots[0] ?? null;
    const profileRaw = session.profileSnapshot
      ? fromJson<Record<string, unknown>>(session.profileSnapshot.rawJson, {})
      : {};
    const candidateItems = candidateSnapshot?.items ?? [];
    const verifiedCount = candidateItems.filter((item) => {
      const summary = fromJson<Record<string, unknown>>(
        item.matchSummaryJson,
        {},
      );
      return summary.verificationStatus === 'verified';
    }).length;

    return [
      {
        type: 'search_started',
        sessionId,
        data: {
          status: session.status,
          stage: session.stage,
          startedAt: session.startedAt.toISOString(),
        },
      },
      {
        type: 'profile_ready',
        sessionId,
        data: {
          productProfile: session.profileSnapshot
            ? {
                category: session.profileSnapshot.category,
                brand: session.profileSnapshot.brand,
                modelLine: profileRaw.modelLine ?? null,
                colorFamily: profileRaw.colorFamily ?? null,
                colorway: profileRaw.colorway ?? null,
                shoeType: profileRaw.shoeType ?? null,
                size: session.profileSnapshot.size,
                color: session.profileSnapshot.color,
                keywords: fromJson<string[]>(session.profileSnapshot.keywordsJson, []),
                confidence: session.profileSnapshot.confidence,
              }
            : null,
        },
      },
      {
        type: 'subject_detected',
        sessionId,
        data: {
          status: preprocessSnapshot?.status ?? 'not_available',
          selectedBox: preprocessSnapshot
            ? fromJson<Record<string, unknown>>(preprocessSnapshot.selectedBoxJson, {})
            : null,
          detectedBoxes: preprocessSnapshot
            ? fromJson<unknown[]>(preprocessSnapshot.detectedBoxesJson, [])
            : [],
          selectionSource: preprocessSnapshot?.selectionSource ?? null,
          imageSize: preprocessSnapshot
            ? {
                width: preprocessSnapshot.imageWidth,
                height: preprocessSnapshot.imageHeight,
              }
            : null,
        },
      },
      {
        type: 'subject_selection_updated',
        sessionId,
        data: {
          preprocessSnapshotId: preprocessSnapshot?.id ?? null,
          selectionSource: preprocessSnapshot?.selectionSource ?? null,
          status: preprocessSnapshot?.status ?? 'not_available',
        },
      },
      {
        type: 'recall_completed',
        sessionId,
        data: {
          candidateSnapshotId: candidateSnapshot?.id ?? null,
          candidateCount: candidateItems.length,
          degraded: candidateSnapshot?.degraded ?? session.degraded,
        },
      },
      {
        type: 'embedding_ready',
        sessionId,
        data: {
          preprocessSnapshotId: preprocessSnapshot?.id ?? null,
          provider: preprocessSnapshot?.embeddingProvider ?? null,
          model: preprocessSnapshot?.embeddingModel ?? null,
          dimension: preprocessSnapshot?.embeddingDimension ?? null,
          vectorHash: preprocessSnapshot?.embeddingVectorHash ?? null,
        },
      },
      {
        type: 'verify_progress',
        sessionId,
        data: {
          verifiedCount,
          totalSelectedForVerification: verifiedCount,
        },
      },
      {
        type: 'candidate_batch',
        sessionId,
        data: {
          candidateSnapshotId: candidateSnapshot?.id ?? null,
          items: candidateItems.map((item) => ({
            candidateItemId: item.id,
            title: item.title,
            platformName: item.platformName,
            price: { amount: item.amount, currency: item.currency },
            stockStatus: item.stockStatus,
            coverImageUrl: item.coverImageUrl,
            productUrl: item.productUrl,
            matchSummary: fromJson<Record<string, unknown>>(item.matchSummaryJson, {}),
          })),
        },
      },
      {
        type: 'search_completed',
        sessionId,
        data: {
          candidateSnapshotId: candidateSnapshot?.id ?? null,
          candidateCount: candidateItems.length,
          degraded: candidateSnapshot?.degraded ?? session.degraded,
          completedAt: new Date().toISOString(),
        },
      },
    ];
  }
}
