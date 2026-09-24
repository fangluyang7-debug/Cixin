import { Inject, Injectable } from '@nestjs/common';
import { createId } from '../../../common/utils/id';
import { toJsonString } from '../../../common/utils/json';
import { EMBEDDING_PROVIDER } from './embedding.constants';
import { EmbeddingProvider, EmbeddingResult } from './embedding-provider.interface';
import {
  IMAGE_EMBEDDING_PREPROCESSOR,
  ImageEmbeddingPreprocessResult,
  ImageEmbeddingPreprocessor,
} from './image-embedding-preprocessor.interface';
import {
  ProductEmbeddingKind,
  ProductImageEmbeddingAdapter,
  ProductImageEmbeddingResult,
  ProductImageEmbeddingVariantInput,
} from './product-image-embedding-adapter.interface';

@Injectable()
export class StandardProductImageEmbeddingAdapterService implements ProductImageEmbeddingAdapter {
  constructor(
    @Inject(IMAGE_EMBEDDING_PREPROCESSOR)
    private readonly imagePreprocessor: ImageEmbeddingPreprocessor,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  async embedImageForVector(input: {
    imageUrl: string;
    textHint?: string | null;
    tags: Record<string, unknown>;
    role: 'query' | 'product_main' | 'product_style';
    embeddingKind: 'visual' | 'multimodal';
    productId?: string | null;
    styleId?: string | null;
  }): Promise<ProductImageEmbeddingResult> {
    const [result] = await this.embedImageVariantsForVector({
      imageUrl: input.imageUrl,
      tags: input.tags,
      role: input.role,
      productId: input.productId,
      styleId: input.styleId,
      variants: [
        {
          variant: 'default',
          embeddingKind: input.embeddingKind,
          textHint: input.textHint,
        },
      ],
    });

    if (!result) {
      throw new Error('PRODUCT_IMAGE_EMBEDDING_VARIANT_MISSING');
    }
    return result;
  }

  async embedImageVariantsForVector(input: {
    imageUrl: string;
    tags: Record<string, unknown>;
    role: 'query' | 'product_main' | 'product_style';
    productId?: string | null;
    styleId?: string | null;
    variants: ProductImageEmbeddingVariantInput[];
  }): Promise<ProductImageEmbeddingResult[]> {
    const preprocessed = await this.imagePreprocessor.preprocess({
      imageUrl: input.imageUrl,
      role: input.role,
      productId: input.productId ?? null,
      styleId: input.styleId ?? null,
      tags: input.tags,
    });

    const preprocessMetadata = this.toPreprocessMetadata(preprocessed);
    const results: ProductImageEmbeddingResult[] = [];
    for (const variant of input.variants) {
      const embedding = await this.embeddingProvider.embedImage({
        imageUrl: preprocessed.embeddingImageUrl,
        textHint: variant.textHint ?? undefined,
        tags: {
          ...input.tags,
          ...(variant.tags ?? {}),
          embeddingKind: variant.embeddingKind,
          embeddingVariant: variant.variant,
          embeddingPreprocess: preprocessMetadata,
        },
      });

      results.push({
        ...embedding,
        preprocess: preprocessed,
        variant: variant.variant,
        embeddingKind: variant.embeddingKind,
      });
    }

    return results;
  }

  toPreprocessMetadata(preprocess: ImageEmbeddingPreprocessResult): Record<string, unknown> {
    return {
      strategy: preprocess.strategy,
      usedOriginalImage: preprocess.usedOriginalImage,
      metadata: preprocess.metadata,
    };
  }

  toOptionalPreprocessMetadata(
    embedding: EmbeddingResult | ProductImageEmbeddingResult,
  ): Record<string, unknown> {
    if ('preprocess' in embedding) {
      return {
        ...this.toPreprocessMetadata(embedding.preprocess),
        embeddingVariant: embedding.variant ?? 'default',
      };
    }
    return {
      strategy: 'text_embedding_no_image',
      usedOriginalImage: true,
      metadata: {},
    };
  }

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
  }) {
    return {
      id: createId('product_emb'),
      productId: input.productId,
      styleId: input.styleId ?? null,
      imageRole: input.imageRole,
      embeddingKind: input.embeddingKind,
      sourceImageUrl: input.sourceImageUrl ?? null,
      imageBucketGroup: input.imageBucketGroup ?? null,
      imageObjectKey: input.imageObjectKey ?? null,
      provider: input.embedding.provider,
      modelName: input.embedding.modelName,
      dimension: input.embedding.dimension,
      vectorJson: JSON.stringify(input.embedding.vector),
      vectorHash: input.embedding.vectorHash,
      qualityScore: input.qualityScore,
      preprocessJson: toJsonString(this.toOptionalPreprocessMetadata(input.embedding)),
    };
  }
}
