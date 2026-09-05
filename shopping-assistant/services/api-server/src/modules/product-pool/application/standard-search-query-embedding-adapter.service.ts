import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_PROVIDER } from './embedding.constants';
import { EmbeddingProvider } from './embedding-provider.interface';
import {
  IMAGE_EMBEDDING_PREPROCESSOR,
  ImageEmbeddingPreprocessor,
} from './image-embedding-preprocessor.interface';
import {
  SearchQueryEmbeddingAdapter,
  SearchQueryEmbeddingInput,
} from './search-query-embedding-adapter.interface';

@Injectable()
export class StandardSearchQueryEmbeddingAdapterService
  implements SearchQueryEmbeddingAdapter
{
  constructor(
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
    @Inject(IMAGE_EMBEDDING_PREPROCESSOR)
    private readonly imagePreprocessor: ImageEmbeddingPreprocessor,
    private readonly config: ConfigService,
  ) {}

  async buildQueryEmbedding(input: SearchQueryEmbeddingInput): Promise<number[]> {
    const textHint = [
      input.profile.category,
      input.profile.brand,
      input.profile.modelLine,
      input.profile.colorFamily,
      input.profile.colorway,
      input.profile.shoeType,
      input.profile.color,
      ...input.keywords,
    ]
      .filter(Boolean)
      .join(' ');

    const tags = input.profile.raw ?? {};
    const embeddingKind = this.searchQueryEmbeddingKind();
    try {
      const embedding =
        input.queryImageUrl && !input.queryImageUrl.startsWith('mock://')
          ? await this.embedQueryImage(input.queryImageUrl, textHint, tags, embeddingKind)
          : await this.embeddingProvider.embedText({
              text: textHint,
              tags: { ...tags, embeddingKind: 'multimodal' },
            });
      return embedding.vector;
    } catch {
      return [];
    }
  }

  private async embedQueryImage(
    imageUrl: string,
    textHint: string,
    tags: Record<string, unknown>,
    embeddingKind: 'visual' | 'multimodal',
  ) {
    const preprocessed = await this.imagePreprocessor.preprocess({
      imageUrl,
      role: 'query',
      tags,
    });

    return this.embeddingProvider.embedImage({
      imageUrl: preprocessed.embeddingImageUrl,
      textHint: embeddingKind === 'visual' ? undefined : textHint,
      tags: {
        ...tags,
        embeddingKind,
        embeddingPreprocess: {
          strategy: preprocessed.strategy,
          usedOriginalImage: preprocessed.usedOriginalImage,
          metadata: preprocessed.metadata,
        },
      },
    });
  }

  private searchQueryEmbeddingKind(): 'visual' | 'multimodal' {
    const configured = this.config.get<string>('embedding.searchQueryEmbeddingKind');
    return configured === 'visual' ? 'visual' : 'multimodal';
  }
}
