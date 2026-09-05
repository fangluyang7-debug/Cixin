import { Injectable } from '@nestjs/common';
import { ProductTagResult } from '../../../adapters/model/model-adapter.interface';
import { createId } from '../../../common/utils/id';
import { toJsonArrayString, toJsonString } from '../../../common/utils/json';
import {
  ProductPersistenceAdapter,
  ProductPersistenceConsensus,
  ProductPersistenceUpsertData,
  ProductStoredImageRef,
  ProductTagAuditCreateData,
} from './product-persistence-adapter.interface';
import { ProductImportItemDto } from '../dto/import-products.dto';

@Injectable()
export class StandardProductPersistenceAdapterService
  implements ProductPersistenceAdapter
{
  buildProductUpsertData(input: {
    batchId: string;
    item: ProductImportItemDto;
    storedImage?: ProductStoredImageRef | null;
    consensus: ProductPersistenceConsensus;
    tagStatus: 'verified' | 'review_needed';
  }): ProductPersistenceUpsertData {
    const tag = input.consensus.tag;
    return {
      importBatchId: input.batchId,
      externalId: input.item.externalId,
      platform: input.item.platform,
      title: input.item.title,
      priceAmount: input.item.price,
      currency: input.item.currency,
      stockStatus: input.item.stockStatus,
      shopName: input.item.shopName,
      shopType: input.item.shopType,
      productUrl: input.item.productUrl,
      sourceImageUrl: this.resolveSourceImageUrl(input.item),
      imageBucketGroup: input.storedImage?.bucketGroup,
      imageObjectKey: input.storedImage?.objectKey,
      imagePublicUrl: input.storedImage?.publicUrl,
      tagStatus: input.tagStatus,
      brand: tag.brand,
      category: tag.category,
      modelLine: tag.modelLine,
      colorFamily: tag.colorFamily,
      colorway: tag.colorway,
      shoeType: tag.shoeType,
      keywordsJson: toJsonArrayString(tag.keywords),
      normalizedTagsJson: toJsonString({
        category: tag.category,
        brand: tag.brand,
        modelLine: tag.modelLine,
        colorFamily: tag.colorFamily,
        colorway: tag.colorway,
        shoeType: tag.shoeType,
      }),
      rawPayloadJson: toJsonString(input.item.rawPayload ?? {}),
      tagConfidence: tag.confidence,
    };
  }

  buildTagAuditCreateData(input: {
    productId: string;
    batchId: string;
    sourceTag: ProductTagResult | null;
    modelTag: ProductTagResult;
    consensus: ProductPersistenceConsensus;
  }): ProductTagAuditCreateData {
    return {
      id: createId('product_audit'),
      productId: input.productId,
      importBatchId: input.batchId,
      status: input.consensus.status,
      modelAJson: toJsonString(
        input.sourceTag
          ? { source: 'rawPayload.attributes', result: input.sourceTag }
          : input.modelTag,
      ),
      modelBJson: toJsonString({
        skipped: true,
        reason: input.sourceTag
          ? 'source_attributes_already_normalized'
          : 'final_link_uses_single_real_vision_model',
      }),
      consensusJson: toJsonString(input.consensus.tag),
      conflictJson: toJsonString(input.consensus.conflict),
    };
  }

  private resolveSourceImageUrl(item: ProductImportItemDto) {
    if (item.imageUrl) return item.imageUrl;
    if (item.imageDataBase64) {
      return `data:${item.imageContentType ?? 'image/jpeg'};base64,${item.imageDataBase64}`;
    }
    return null;
  }
}
