import { Inject, Injectable } from '@nestjs/common';
import {
  MODEL_ADAPTER,
  ModelAdapter,
  ProductProfileResult,
} from '../../../adapters/model/model-adapter.interface';
import {
  SessionProductProfileAdapter,
  SessionProductProfileInput,
} from './session-product-profile-adapter.interface';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';

@Injectable()
export class StandardSessionProductProfileAdapterService
  implements SessionProductProfileAdapter
{
  constructor(
    @Inject(MODEL_ADAPTER)
    private readonly model: ModelAdapter,
  ) {}

  async identifyProductProfile(
    input: SessionProductProfileInput,
  ): Promise<ProductProfileResult> {
    const profile = await this.model.identifyShoe({
      assetId: input.assetId,
      imageUrl: input.imageUrl,
      categoryHint: input.categoryHint,
    });
    const category = normalizeProductCategory(
      profile.category,
      input.categoryHint ?? 'general',
    );
    return {
      ...profile,
      category,
      styleTags: Array.isArray(profile.styleTags) ? profile.styleTags : [],
      sceneTags: Array.isArray(profile.sceneTags) ? profile.sceneTags : [],
      keywords: Array.isArray(profile.keywords) ? profile.keywords : [],
      confidence:
        typeof profile.confidence === 'number' &&
        Number.isFinite(profile.confidence)
          ? profile.confidence
          : 0,
      raw:
        profile.raw && typeof profile.raw === 'object' && !Array.isArray(profile.raw)
          ? profile.raw
          : {},
    };
  }

  async classifyProductCategory(input: {
    imageUrl: string;
    categoryHint?: string | null;
  }) {
    return this.model.classifyProductCategory(input);
  }
}
