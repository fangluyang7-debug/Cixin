import { Injectable } from '@nestjs/common';
import { fromJson } from '../../../common/utils/json';
import {
  NormalizedSubjectBox,
  QueryImagePreprocessAdapter,
  QueryImagePreprocessSnapshotViewRecord,
  QueryImageSubjectDetection,
} from './query-image-preprocess-adapter.interface';

@Injectable()
export class StandardQueryImagePreprocessAdapterService implements QueryImagePreprocessAdapter {
  extractSubjectDetection(raw: Record<string, unknown>): QueryImageSubjectDetection {
    const direct = this.asRecord(raw.subjectDetection);
    if (Object.keys(direct).length > 0) {
      return this.buildDetection(direct);
    }

    const modelRaw = this.asRecord(raw.raw);
    const nested = this.asRecord(modelRaw.subjectDetection);
    return this.buildDetection(nested);
  }

  normalizeUserSelectionBox(value: unknown): NormalizedSubjectBox | null {
    const record = this.asRecord(value);
    const x = this.toNumber(record.x ?? record.left);
    const y = this.toNumber(record.y ?? record.top);
    const width = this.toNumber(record.width ?? record.w);
    const height = this.toNumber(record.height ?? record.h);
    if (x === null || y === null || width === null || height === null) return null;
    if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
    if (x > 1 || y > 1 || width > 1 || height > 1) return null;
    if (x + width > 1 || y + height > 1) return null;
    if (width < 0.02 || height < 0.02) return null;

    return {
      x,
      y,
      width,
      height,
      confidence: this.toNumber(record.confidence) ?? null,
      label: typeof record.label === 'string' ? record.label : null,
    };
  }

  formatSnapshot(snapshot: QueryImagePreprocessSnapshotViewRecord): Record<string, unknown> {
    return {
      preprocessSnapshotId: snapshot.id,
      assetId: snapshot.assetId,
      status: snapshot.status,
      selectedBox: fromJson<Record<string, unknown>>(
        snapshot.selectedBoxJson,
        {},
      ),
      detectedBoxes: fromJson<unknown[]>(snapshot.detectedBoxesJson, []),
      selectionSource: snapshot.selectionSource,
      imageSize: {
        width: snapshot.imageWidth,
        height: snapshot.imageHeight,
      },
      embedding: {
        provider: snapshot.embeddingProvider,
        model: snapshot.embeddingModel,
        dimension: snapshot.embeddingDimension,
        vectorHash: snapshot.embeddingVectorHash,
      },
      cropImageRef: fromJson<Record<string, unknown>>(
        snapshot.cropImageRefJson,
        {},
      ),
      raw: fromJson<Record<string, unknown>>(snapshot.rawJson, {}),
      createdAt: snapshot.createdAt.toISOString(),
    };
  }

  private buildDetection(raw: Record<string, unknown>): QueryImageSubjectDetection {
    const detectedBoxes = this.normalizeDetectedBoxes(raw.detectedBoxes ?? raw.boxes ?? []);
    return {
      raw,
      selectedBox: this.normalizeModelBox(raw.selectedBox ?? raw.primaryBox ?? raw.bbox ?? raw.box) ?? detectedBoxes[0] ?? null,
      detectedBoxes,
      imageWidth: raw.imageWidth,
      imageHeight: raw.imageHeight,
      status: this.toString(raw.status),
    };
  }

  private normalizeDetectedBoxes(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.normalizeModelBox(item))
      .filter((item): item is NormalizedSubjectBox => Boolean(item));
  }

  private normalizeModelBox(value: unknown): NormalizedSubjectBox | null {
    const record = this.asRecord(value);
    const x = this.toNumber(record.x ?? record.left);
    const y = this.toNumber(record.y ?? record.top);
    const width = this.toNumber(record.width ?? record.w);
    const height = this.toNumber(record.height ?? record.h);
    if (x === null || y === null || width === null || height === null) return null;
    if (width <= 0 || height <= 0) return null;
    const normalized = {
      x: this.clamp(x, 0, 1),
      y: this.clamp(y, 0, 1),
      width: this.clamp(width, 0.001, 1),
      height: this.clamp(height, 0.001, 1),
      confidence: this.toNumber(record.confidence) ?? null,
      label: typeof record.label === 'string' ? record.label : null,
    };
    if (normalized.x + normalized.width > 1) {
      normalized.width = Math.max(0.001, 1 - normalized.x);
    }
    if (normalized.y + normalized.height > 1) {
      normalized.height = Math.max(0.001, 1 - normalized.y);
    }
    if (normalized.width < 0.02 || normalized.height < 0.02) return null;
    return normalized;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }
}
