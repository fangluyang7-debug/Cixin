export type NormalizedBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PixelBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageAssetVariant =
  | 'compressed_recognition'
  | 'original_source'
  | 'demo_asset'
  | 'embedding_input';

export type ImageProcessingRole = 'query' | 'product_main' | 'product_style';

export type ImageObjectRef = {
  provider: string;
  bucketGroup: string;
  bucketName?: string | null;
  objectKey: string;
  publicUrl?: string | null;
  signedUrl?: string | null;
};

export type ImageAssetInput = {
  assetId?: string;
  assetGroupId?: string | null;
  variantType: ImageAssetVariant;
  sourceType: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  isPrimaryRecognitionAsset?: boolean;
  rawPayload?: Record<string, unknown>;
};

export type ImagePreprocessInput = {
  role: ImageProcessingRole;
  sourceImage: ImageObjectRef;
  selectedBox?: NormalizedBoundingBox | null;
  textHint?: string | null;
  tags?: Record<string, unknown>;
};

export type ImagePreprocessResult = {
  sourceImage: ImageObjectRef;
  embeddingImage: ImageObjectRef;
  selectedBox?: NormalizedBoundingBox | null;
  cropRegionPx?: PixelBoundingBox | null;
  imageSize?: {
    width: number;
    height: number;
  } | null;
  strategy: string;
  provider: string;
  confidence?: number | null;
  usedOriginalImage: boolean;
  failureReason?: string | null;
  metadata: Record<string, unknown>;
};

export type ImageEmbeddingResult = {
  provider: string;
  model: string;
  dimension: number;
  vector: number[];
  vectorHash: string;
  preprocess?: ImagePreprocessResult | null;
  metadata: Record<string, unknown>;
};
