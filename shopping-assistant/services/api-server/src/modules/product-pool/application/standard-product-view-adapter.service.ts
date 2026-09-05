import { Injectable } from '@nestjs/common';
import { fromJson } from '../../../common/utils/json';
import {
  ProductDetailRecord,
  ProductListRecord,
  ProductViewAdapter,
} from './product-view-adapter.interface';

@Injectable()
export class StandardProductViewAdapterService implements ProductViewAdapter {
  toListItem(product: ProductListRecord): Record<string, unknown> {
    const embeddingCount = product._count?.embeddings ?? 0;
    return {
      productId: product.id,
      importBatchId: product.importBatchId,
      externalId: product.externalId,
      platform: product.platform,
      title: product.title,
      price: { amount: product.priceAmount, currency: product.currency },
      stockStatus: product.stockStatus,
      shopName: product.shopName,
      shopType: product.shopType,
      productUrl: product.productUrl,
      imageUrl: product.imagePublicUrl ?? product.sourceImageUrl,
      imageRef:
        product.imageBucketGroup && product.imageObjectKey
          ? {
              bucketGroup: product.imageBucketGroup,
              objectKey: product.imageObjectKey,
            }
          : null,
      tagStatus: product.tagStatus,
      tagConfidence: product.tagConfidence,
      brand: product.brand,
      category: product.category,
      modelLine: product.modelLine,
      colorFamily: product.colorFamily,
      colorway: product.colorway,
      shoeType: product.shoeType,
      embeddingReady: embeddingCount > 0,
      counts: {
        embeddings: embeddingCount,
        tagAudits: product._count?.tagAudits ?? 0,
      },
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }

  toDetail(product: ProductDetailRecord): Record<string, unknown> {
    return {
      ...this.toListItem({
        ...product,
        _count: {
          embeddings: product.embeddings.length,
          tagAudits: product.tagAudits.length,
        },
      }),
      externalId: product.externalId,
      importBatch: product.importBatch
        ? {
            batchId: product.importBatch.id,
            batchSource: product.importBatch.batchSource,
            status: product.importBatch.status,
            createdAt: product.importBatch.createdAt.toISOString(),
          }
        : null,
      normalizedTags: fromJson<Record<string, unknown>>(
        product.normalizedTagsJson,
        {},
      ),
      keywords: fromJson<string[]>(product.keywordsJson, []),
      rawPayload: fromJson<Record<string, unknown>>(product.rawPayloadJson, {}),
      embeddings: product.embeddings.map((embedding) => ({
        embeddingId: embedding.id,
        styleId: embedding.styleId,
        imageRole: embedding.imageRole,
        embeddingKind: embedding.embeddingKind,
        sourceImageUrl: embedding.sourceImageUrl,
        imageBucketGroup: embedding.imageBucketGroup,
        imageObjectKey: embedding.imageObjectKey,
        provider: embedding.provider,
        modelName: embedding.modelName,
        dimension: embedding.dimension,
        vectorHash: embedding.vectorHash,
        qualityScore: embedding.qualityScore,
        preprocess: fromJson<Record<string, unknown>>(embedding.preprocessJson, {}),
        createdAt: embedding.createdAt.toISOString(),
      })),
      tagAudits: product.tagAudits.map((audit) => ({
        auditId: audit.id,
        status: audit.status,
        modelA: fromJson<Record<string, unknown>>(audit.modelAJson, {}),
        modelB: fromJson<Record<string, unknown>>(audit.modelBJson, {}),
        consensus: fromJson<Record<string, unknown>>(audit.consensusJson, {}),
        conflict: fromJson<Record<string, unknown>>(audit.conflictJson, {}),
        createdAt: audit.createdAt.toISOString(),
      })),
    };
  }
}
