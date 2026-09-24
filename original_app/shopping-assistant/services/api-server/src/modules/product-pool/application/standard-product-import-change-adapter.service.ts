import { Injectable } from '@nestjs/common';
import {
  Prisma,
  Product,
  ProductImageEmbedding,
} from '@prisma/client';
import { fromJson, toJsonString } from '../../../common/utils/json';
import {
  ProductImportChangeAdapter,
  ProductImportSnapshot,
} from './product-import-change-adapter.interface';
import type { ProductBatchQualityProduct } from './product-batch-quality-adapter.interface';

interface StoredProductSnapshot {
  product: Record<string, unknown>;
  embeddings: Array<Record<string, unknown>>;
}

@Injectable()
export class StandardProductImportChangeAdapterService
  implements ProductImportChangeAdapter
{
  serializeSnapshot(
    product: Product,
    embeddings: ProductImageEmbedding[],
  ): string {
    return toJsonString({
      product: this.serializeProduct(product),
      embeddings: embeddings.map((embedding) =>
        this.serializeEmbedding(embedding),
      ),
    });
  }

  deserializeSnapshot(rawJson: string): ProductImportSnapshot | null {
    const snapshot = fromJson<StoredProductSnapshot | null>(rawJson, null);
    if (!snapshot || !snapshot.product || !Array.isArray(snapshot.embeddings)) {
      return null;
    }

    return {
      productData: this.deserializeProduct(snapshot.product),
      embeddings: snapshot.embeddings.map((embedding) =>
        this.deserializeEmbedding(embedding),
      ),
    };
  }

  buildChangeCreateData(input: {
    changeId: string;
    batchId: string;
    productId: string;
    action: 'created' | 'updated';
    beforeJson: string;
  }): Prisma.ProductImportChangeUncheckedCreateInput {
    return {
      id: input.changeId,
      batchId: input.batchId,
      productId: input.productId,
      action: input.action,
      beforeJson: input.beforeJson,
      afterJson: '{}',
    };
  }

  buildAfterJson(
    product: Product,
    embeddings: ProductImageEmbedding[],
  ): string {
    return this.serializeSnapshot(product, embeddings);
  }

  toQualityProduct(rawJson: string): ProductBatchQualityProduct | null {
    const snapshot = fromJson<StoredProductSnapshot | null>(rawJson, null);
    if (!snapshot || !snapshot.product || !Array.isArray(snapshot.embeddings)) {
      return null;
    }

    return {
      tagStatus: this.requiredString(snapshot.product.tagStatus),
      productUrl: this.requiredString(snapshot.product.productUrl),
      sourceImageUrl: this.nullableString(snapshot.product.sourceImageUrl),
      imagePublicUrl: this.nullableString(snapshot.product.imagePublicUrl),
      imageBucketGroup: this.nullableString(snapshot.product.imageBucketGroup),
      imageObjectKey: this.nullableString(snapshot.product.imageObjectKey),
      embeddings: snapshot.embeddings.map((embedding) => ({
        embeddingKind: this.requiredString(embedding.embeddingKind),
      })),
    };
  }

  private serializeProduct(product: Product): Record<string, unknown> {
    return {
      importBatchId: product.importBatchId,
      externalId: product.externalId,
      platform: product.platform,
      title: product.title,
      priceAmount: product.priceAmount,
      currency: product.currency,
      stockStatus: product.stockStatus,
      shopName: product.shopName,
      shopType: product.shopType,
      productUrl: product.productUrl,
      sourceImageUrl: product.sourceImageUrl,
      imageBucketGroup: product.imageBucketGroup,
      imageObjectKey: product.imageObjectKey,
      imagePublicUrl: product.imagePublicUrl,
      tagStatus: product.tagStatus,
      brand: product.brand,
      category: product.category,
      modelLine: product.modelLine,
      colorFamily: product.colorFamily,
      colorway: product.colorway,
      shoeType: product.shoeType,
      keywordsJson: product.keywordsJson,
      normalizedTagsJson: product.normalizedTagsJson,
      rawPayloadJson: product.rawPayloadJson,
      tagConfidence: product.tagConfidence,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  private serializeEmbedding(
    embedding: ProductImageEmbedding,
  ): Record<string, unknown> {
    return {
      id: embedding.id,
      productId: embedding.productId,
      styleId: embedding.styleId,
      imageRole: embedding.imageRole,
      embeddingKind: embedding.embeddingKind,
      sourceImageUrl: embedding.sourceImageUrl,
      imageBucketGroup: embedding.imageBucketGroup,
      imageObjectKey: embedding.imageObjectKey,
      provider: embedding.provider,
      modelName: embedding.modelName,
      dimension: embedding.dimension,
      vectorJson: embedding.vectorJson,
      vectorHash: embedding.vectorHash,
      qualityScore: embedding.qualityScore,
      preprocessJson: embedding.preprocessJson,
      createdAt: embedding.createdAt.toISOString(),
    };
  }

  private deserializeProduct(
    product: Record<string, unknown>,
  ): Prisma.ProductUncheckedUpdateInput {
    return {
      importBatchId: this.nullableString(product.importBatchId),
      externalId: this.nullableString(product.externalId),
      platform: this.requiredString(product.platform),
      title: this.requiredString(product.title),
      priceAmount: this.requiredString(product.priceAmount),
      currency: this.requiredString(product.currency),
      stockStatus: this.requiredString(product.stockStatus),
      shopName: this.nullableString(product.shopName),
      shopType: this.nullableString(product.shopType),
      productUrl: this.requiredString(product.productUrl),
      sourceImageUrl: this.nullableString(product.sourceImageUrl),
      imageBucketGroup: this.nullableString(product.imageBucketGroup),
      imageObjectKey: this.nullableString(product.imageObjectKey),
      imagePublicUrl: this.nullableString(product.imagePublicUrl),
      tagStatus: this.requiredString(product.tagStatus),
      brand: this.nullableString(product.brand),
      category: this.nullableString(product.category),
      modelLine: this.nullableString(product.modelLine),
      colorFamily: this.nullableString(product.colorFamily),
      colorway: this.nullableString(product.colorway),
      shoeType: this.nullableString(product.shoeType),
      keywordsJson: this.requiredString(product.keywordsJson),
      normalizedTagsJson: this.requiredString(product.normalizedTagsJson),
      rawPayloadJson: this.requiredString(product.rawPayloadJson),
      tagConfidence:
        typeof product.tagConfidence === 'number'
          ? product.tagConfidence
          : null,
      createdAt: this.dateValue(product.createdAt),
      updatedAt: this.dateValue(product.updatedAt),
    };
  }

  private deserializeEmbedding(
    embedding: Record<string, unknown>,
  ): Prisma.ProductImageEmbeddingUncheckedCreateInput {
    return {
      id: this.requiredString(embedding.id),
      productId: this.requiredString(embedding.productId),
      styleId: this.nullableString(embedding.styleId),
      imageRole: this.requiredString(embedding.imageRole),
      embeddingKind: this.requiredString(embedding.embeddingKind),
      sourceImageUrl: this.nullableString(embedding.sourceImageUrl),
      imageBucketGroup: this.nullableString(embedding.imageBucketGroup),
      imageObjectKey: this.nullableString(embedding.imageObjectKey),
      provider: this.requiredString(embedding.provider),
      modelName: this.nullableString(embedding.modelName),
      dimension: Number(embedding.dimension),
      vectorJson: this.requiredString(embedding.vectorJson),
      vectorHash: this.nullableString(embedding.vectorHash),
      qualityScore:
        typeof embedding.qualityScore === 'number'
          ? embedding.qualityScore
          : null,
      preprocessJson: this.requiredString(embedding.preprocessJson),
      createdAt: this.dateValue(embedding.createdAt),
    };
  }

  private requiredString(value: unknown) {
    return typeof value === 'string' ? value : '';
  }

  private nullableString(value: unknown) {
    return typeof value === 'string' ? value : null;
  }

  private dateValue(value: unknown) {
    return typeof value === 'string' ? new Date(value) : new Date();
  }
}
