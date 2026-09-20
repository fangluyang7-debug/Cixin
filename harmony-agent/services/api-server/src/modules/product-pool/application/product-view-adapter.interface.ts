import {
  Product,
  ProductImageEmbedding,
  ProductImportBatch,
  ProductTagAudit,
} from '@prisma/client';

export const PRODUCT_VIEW_ADAPTER = Symbol('PRODUCT_VIEW_ADAPTER');

export type ProductListRecord = Product & {
  _count?: { embeddings?: number; tagAudits?: number };
};

export type ProductDetailRecord = Product & {
  importBatch: ProductImportBatch | null;
  embeddings: ProductImageEmbedding[];
  tagAudits: ProductTagAudit[];
};

export interface ProductViewAdapter {
  toListItem(product: ProductListRecord): Record<string, unknown>;
  toDetail(product: ProductDetailRecord): Record<string, unknown>;
}
