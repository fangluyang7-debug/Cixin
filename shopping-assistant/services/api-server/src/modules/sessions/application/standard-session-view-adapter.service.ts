import { Inject, Injectable } from "@nestjs/common";
import { fromJson } from "../../../common/utils/json";
import {
  QUERY_IMAGE_PREPROCESS_ADAPTER,
  QueryImagePreprocessAdapter,
} from "./query-image-preprocess-adapter.interface";
import {
  SessionViewAdapter,
  SessionViewRecord,
} from "./session-view-adapter.interface";

@Injectable()
export class StandardSessionViewAdapterService implements SessionViewAdapter {
  constructor(
    @Inject(QUERY_IMAGE_PREPROCESS_ADAPTER)
    private readonly queryImagePreprocessAdapter: QueryImagePreprocessAdapter,
  ) {}

  toSessionDetail(session: SessionViewRecord): Record<string, unknown> {
    const profile = session.profileSnapshot;
    const profileRaw = profile
      ? fromJson<Record<string, unknown>>(profile.rawJson, {})
      : {};
    const activeFilter = session.filterSnapshots[0] ?? null;
    const activeFilterRaw = activeFilter
      ? fromJson<Record<string, unknown>>(activeFilter.rawJson, {})
      : {};
    const candidateSnapshot = session.candidateSnapshots[0] ?? null;

    return {
      session: {
        sessionId: session.id,
        status: session.status,
        stage: session.stage,
        currentTurnIndex: session.currentTurnIndex,
        entrySource: session.entrySource,
        userId: session.userId,
        startedAt: session.startedAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
        degraded: session.degraded,
      },
      productProfile: profile
        ? {
            category: profile.category,
            brand: profile.brand,
            modelLine:
              typeof profileRaw.modelLine === "string"
                ? profileRaw.modelLine
                : null,
            colorFamily:
              typeof profileRaw.colorFamily === "string"
                ? profileRaw.colorFamily
                : null,
            colorway:
              typeof profileRaw.colorway === "string"
                ? profileRaw.colorway
                : null,
            shoeType:
              typeof profileRaw.shoeType === "string"
                ? profileRaw.shoeType
                : null,
            size: profile.size,
            color: profile.color,
            styleTags: fromJson<string[]>(profile.styleTagsJson, []),
            sceneTags: fromJson<string[]>(profile.sceneTagsJson, []),
            keywords: fromJson<string[]>(profile.keywordsJson, []),
            confidence: profile.confidence,
            raw: profileRaw,
          }
        : null,
      queryImagePreprocess: session.queryImagePreprocessSnapshots[0]
        ? this.queryImagePreprocessAdapter.formatSnapshot(
            session.queryImagePreprocessSnapshots[0],
          )
        : null,
      activeFilter: activeFilter
        ? {
            priceMin: activeFilter.priceMin,
            priceMax: activeFilter.priceMax,
            platformsInclude: this.toStringArray(
              activeFilterRaw.platformsInclude,
            ),
            platformsExclude: this.toStringArray(
              activeFilterRaw.platformsExclude,
            ),
            excludedProductIds: this.toStringArray(
              activeFilterRaw.excludedProductIds,
            ),
            excludedCandidateItemIds: this.toStringArray(
              activeFilterRaw.excludedCandidateItemIds,
            ),
            timeConstraintDays: activeFilter.timeConstraintDays,
            urgentDeliveryPreferred: activeFilter.urgentDeliveryPreferred,
            stockOnly: activeFilter.stockOnly,
            shopType: activeFilter.shopType,
            color: activeFilter.color,
            brand: activeFilter.brand,
            platform: activeFilter.platform,
            sortRule: activeFilter.sortRule,
            searchPipelineMode:
              typeof activeFilterRaw.searchPipelineMode === "string"
                ? activeFilterRaw.searchPipelineMode
                : "current_ann_then_refine",
            raw: activeFilterRaw,
          }
        : null,
      candidateSummary: candidateSnapshot
        ? {
            candidateSnapshotId: candidateSnapshot.id,
            candidateCount:
              candidateSnapshot._count?.items ?? candidateSnapshot.items.length,
          }
        : null,
    };
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  }
}
