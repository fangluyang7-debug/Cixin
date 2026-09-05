import { Prisma } from '@prisma/client';
import { ProductTagResult } from '../../../adapters/model/model-adapter.interface';
import { ProductImportItemDto } from '../dto/import-products.dto';

export const PRODUCT_PERSISTENCE_ADAPTER = Symbol('PRODUCT_PERSISTENCE_ADAPTER');

export interface ProductPersistenceConsensus {
  status: string;
  tag: ProductTagResult;
  conflict: Record<string, unknown>;
}

export interface ProductStoredImageRef {
  bucketGroup: string;
  objectKey: string;
  publicUrl?: string | null;
}

export type ProductPersistenceUpsertData = Omit<
  Prisma.ProductUncheckedCreateInput,
  'id' | 'createdAt' | 'updatedAt'
>;

export type ProductTagAuditCreateData =
  Prisma.ProductTagAuditUncheckedCreateInput;

export interface ProductPersistenceAdapter {
  buildProductUpsertData(input: {
    batchId: string;
    item: ProductImportItemDto;
    storedImage?: ProductStoredImageRef | null;
    consensus: ProductPersistenceConsensus;
    tagStatus: 'verified' | 'review_needed';
  }): ProductPersistenceUpsertData;

  buildTagAuditCreateData(input: {
    productId: string;
    batchId: string;
    sourceTag: ProductTagResult | null;
    modelTag: ProductTagResult;
    consensus: ProductPersistenceConsensus;
  }): ProductTagAuditCreateData;
}
