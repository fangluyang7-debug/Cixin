export const QUERY_IMAGE_PREPROCESS_ADAPTER = Symbol('QUERY_IMAGE_PREPROCESS_ADAPTER');

export interface NormalizedSubjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number | null;
  label?: string | null;
}

export interface QueryImageSubjectDetection {
  raw: Record<string, unknown>;
  selectedBox: NormalizedSubjectBox | null;
  detectedBoxes: NormalizedSubjectBox[];
  imageWidth?: unknown;
  imageHeight?: unknown;
  status: string | null;
}

export interface QueryImagePreprocessSnapshotViewRecord {
  id: string;
  assetId: string;
  selectedBoxJson: string;
  detectedBoxesJson: string;
  selectionSource: string;
  status: string;
  imageWidth: number | null;
  imageHeight: number | null;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingDimension: number | null;
  embeddingVectorHash: string | null;
  cropImageRefJson: string;
  rawJson: string;
  createdAt: Date;
}

export interface QueryImagePreprocessAdapter {
  extractSubjectDetection(raw: Record<string, unknown>): QueryImageSubjectDetection;
  normalizeUserSelectionBox(value: unknown): NormalizedSubjectBox | null;
  formatSnapshot(snapshot: QueryImagePreprocessSnapshotViewRecord): Record<string, unknown>;
}
