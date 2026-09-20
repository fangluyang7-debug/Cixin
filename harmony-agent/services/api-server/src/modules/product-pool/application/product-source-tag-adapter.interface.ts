import { ProductTagResult } from '../../../adapters/model/model-adapter.interface';
import { ProductImportItemDto } from '../dto/import-products.dto';

export const PRODUCT_SOURCE_TAG_ADAPTER = Symbol('PRODUCT_SOURCE_TAG_ADAPTER');

export interface ProductTagProductSource {
  category: string | null;
  brand: string | null;
  modelLine: string | null;
  colorFamily: string | null;
  colorway: string | null;
  shoeType: string | null;
  keywordsJson: string;
  tagConfidence: number | null;
  normalizedTagsJson: string;
}

export interface ProductSourceTagAdapter {
  buildTagFromSourceAttributes(
    item: ProductImportItemDto,
  ): ProductTagResult | null;

  buildTagFromProduct(product: ProductTagProductSource): ProductTagResult;
}
