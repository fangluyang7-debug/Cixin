import {
  ProductCategoryResult,
  ProductProfileResult,
} from '../../../adapters/model/model-adapter.interface';

export const SESSION_PRODUCT_PROFILE_ADAPTER = Symbol(
  'SESSION_PRODUCT_PROFILE_ADAPTER',
);

export interface SessionProductProfileInput {
  assetId: string;
  categoryHint?: string | null;
  imageUrl?: string | null;
}

export interface SessionProductProfileAdapter {
  identifyProductProfile(
    input: SessionProductProfileInput,
  ): Promise<ProductProfileResult>;
  classifyProductCategory(input: {
    imageUrl: string;
    categoryHint?: string | null;
  }): Promise<ProductCategoryResult>;
}
