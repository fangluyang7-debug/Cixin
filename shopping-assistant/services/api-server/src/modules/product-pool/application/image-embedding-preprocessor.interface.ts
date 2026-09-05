export const IMAGE_EMBEDDING_PREPROCESSOR = Symbol('IMAGE_EMBEDDING_PREPROCESSOR');

export type ImageEmbeddingRole = 'query' | 'product_main' | 'product_style';

export interface ImageEmbeddingPreprocessInput {
  imageUrl: string;
  role: ImageEmbeddingRole;
  productId?: string | null;
  styleId?: string | null;
  tags?: Record<string, unknown>;
}

export interface ImageEmbeddingPreprocessResult {
  embeddingImageUrl: string;
  strategy: string;
  usedOriginalImage: boolean;
  metadata: Record<string, unknown>;
}

export interface ImageEmbeddingPreprocessor {
  preprocess(input: ImageEmbeddingPreprocessInput): Promise<ImageEmbeddingPreprocessResult>;
}
