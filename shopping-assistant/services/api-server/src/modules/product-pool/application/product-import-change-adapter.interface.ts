import {
  Prisma,
  Product,
  ProductImageEmbedding,
} from '@prisma/client';
import type { ProductBatchQualityProduct } from './product-batch-quality-adapter.interface';

export const PRODUCT_IMPORT_CHANGE_ADAPTER = Symbol(
  'PRODUCT_IMPORT_CHANGE_ADAPTER',
);

export interface ProductImportSnapshot {
  productData: Prisma.ProductUncheckedUpdateInput;
  embeddings: Prisma.ProductImageEmbeddingUncheckedCreateInput[];
}

export interface ProductImportChangeAdapter {
  serializeSnapshot(
    product: Product,
    embeddings: ProductImageEmbedding[],
  ): string;
  deserializeSnapshot(rawJson: string): ProductImportSnapshot | null;
  buildChangeCreateData(input: {
    changeId: string;
    batchId: string;
    productId: string;
    action: 'created' | 'updated';
    beforeJson: string;
  }): Prisma.ProductImportChangeUncheckedCreateInput;
  buildAfterJson(
    product: Product,
    embeddings: ProductImageEmbedding[],
  ): string;
  toQualityProduct(rawJson: string): ProductBatchQualityProduct | null;
}
