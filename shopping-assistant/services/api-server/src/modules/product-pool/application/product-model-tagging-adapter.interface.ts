import {
  ProductTagInput,
  ProductTagResult,
} from '../../../adapters/model/model-adapter.interface';

export const PRODUCT_MODEL_TAGGING_ADAPTER = Symbol(
  'PRODUCT_MODEL_TAGGING_ADAPTER',
);

export interface ProductModelTaggingAdapter {
  tagProduct(input: ProductTagInput): Promise<ProductTagResult>;
}
