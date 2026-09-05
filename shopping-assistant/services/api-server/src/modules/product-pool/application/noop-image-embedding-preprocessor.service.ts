import { Injectable } from '@nestjs/common';
import {
  ImageEmbeddingPreprocessInput,
  ImageEmbeddingPreprocessResult,
  ImageEmbeddingPreprocessor,
} from './image-embedding-preprocessor.interface';

@Injectable()
export class NoopImageEmbeddingPreprocessorService implements ImageEmbeddingPreprocessor {
  async preprocess(input: ImageEmbeddingPreprocessInput): Promise<ImageEmbeddingPreprocessResult> {
    return {
      embeddingImageUrl: input.imageUrl,
      strategy: 'none',
      usedOriginalImage: true,
      metadata: {
        role: input.role,
        productId: input.productId ?? null,
        styleId: input.styleId ?? null,
      },
    };
  }
}
