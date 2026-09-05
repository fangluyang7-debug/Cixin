import { EmbeddingResult } from './embedding-provider.interface';
import {
  ImageEmbeddingPreprocessResult,
  ImageEmbeddingRole,
} from './image-embedding-preprocessor.interface';

export const PRODUCT_IMAGE_EMBEDDING_ADAPTER = Symbol('PRODUCT_IMAGE_EMBEDDING_ADAPTER');

export const PRODUCT_EMBEDDING_KINDS = ['visual', 'multimodal'] as const;
export type ProductEmbeddingKind = (typeof PRODUCT_EMBEDDING_KINDS)[number];

export interface ProductImageEmbeddingResult extends EmbeddingResult {
  preprocess: ImageEmbeddingPreprocessResult;
  variant?: string;
  embeddingKind?: ProductEmbeddingKind;
}

export interface ProductImageEmbeddingVariantInput {
  variant: string;
  embeddingKind: ProductEmbeddingKind;
  textHint?: string | null;
  tags?: Record<string, unknown>;
}

export interface ProductImageEmbeddingCreateData {
  id: string;
  productId: string;
  styleId: string | null;
  imageRole: string;
  embeddingKind: ProductEmbeddingKind;
  sourceImageUrl: string | null;
  imageBucketGroup: string | null;
  imageObjectKey: string | null;
  provider: string;
  modelName: string;
  dimension: number;
  vectorJson: string;
  vectorHash: string;
  qualityScore: number;
  preprocessJson: string;
}

export interface ProductImageEmbeddingAdapter {
  embedImageForVector(input: {
    imageUrl: string;
    textHint?: string | null;
    tags: Record<string, unknown>;
    role: ImageEmbeddingRole;
    embeddingKind: ProductEmbeddingKind;
    productId?: string | null;
    styleId?: string | null;
  }): Promise<ProductImageEmbeddingResult>;

  embedImageVariantsForVector(input: {
    imageUrl: string;
    tags: Record<string, unknown>;
    role: ImageEmbeddingRole;
    productId?: string | null;
    styleId?: string | null;
    variants: ProductImageEmbeddingVariantInput[];
  }): Promise<ProductImageEmbeddingResult[]>;

  toPreprocessMetadata(preprocess: ImageEmbeddingPreprocessResult): Record<string, unknown>;

  toOptionalPreprocessMetadata(
    embedding: EmbeddingResult | ProductImageEmbeddingResult,
  ): Record<string, unknown>;

  buildCreateData(input: {
    productId: string;
    styleId?: string | null;
    imageRole: string;
    embeddingKind: ProductEmbeddingKind;
    sourceImageUrl?: string | null;
    imageBucketGroup?: string | null;
    imageObjectKey?: string | null;
    embedding: EmbeddingResult | ProductImageEmbeddingResult;
    qualityScore: number;
  }): ProductImageEmbeddingCreateData;
}
