import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CandidateSeed } from '../../../adapters/search-provider/search-provider.interface';
import { fromJson } from '../../../common/utils/json';
import {
  ProductSearchCandidateRecord,
  ProductSearchResultAdapter,
} from './product-search-result-adapter.interface';
import { parsePlatformProductReference } from './platform-product-reference';

@Injectable()
export class StandardProductSearchResultAdapterService
  implements ProductSearchResultAdapter
{
  constructor(private readonly config: ConfigService) {}

  toCandidateSeed(candidate: ProductSearchCandidateRecord): CandidateSeed {
    const product = candidate.product;
    const displayScore = this.displayMatchScore(candidate);
    const verificationStatus = candidate.verification.verificationStatus;
    const visualMatchConfidence =
      verificationStatus === 'verified' ? candidate.visualVerifyScore : null;
    const productRawPayload = fromJson<Record<string, unknown>>(
      product.rawPayloadJson,
      {},
    );
    const attributes = this.asRecord(productRawPayload.attributes);
    const adapter = this.asRecord(productRawPayload.adapter);
    const parsedReference = this.asRecord(adapter.platformProductReference);
    const urlReference = parsePlatformProductReference(
      product.platform,
      product.productUrl,
    );
    const platformProductId =
      urlReference.productId ??
      this.toString(parsedReference.productId) ??
      product.externalId ??
      this.toString(productRawPayload.itemId) ??
      this.toString(productRawPayload.skuId);
    const platformBrandId =
      urlReference.brandId ??
      this.toString(parsedReference.brandId) ??
      this.toString(productRawPayload.brandId) ??
      this.toString(attributes.brandId);

    return {
      title: product.title,
      platformName: product.platform,
      amount: product.priceAmount,
      currency: product.currency,
      shopName: product.shopName ?? '',
      shopType: product.shopType ?? 'unknown',
      stockStatus: this.normalizeStockStatus(product.stockStatus),
      coverImageUrl: candidate.coverImageUrl,
      productUrl: product.productUrl,
      matchSummary: {
        displayScore,
        matchScore: displayScore,
        sameProduct: candidate.verification.sameProduct,
        sameColorway: candidate.verification.sameColorway,
        verificationStatus,
        verificationSource: candidate.verification.verificationSource,
        annScore: candidate.annScore,
        rawAnnScore: candidate.rawAnnScore,
        annPassedMinScore: candidate.annPassedMinScore,
        embeddingKind: candidate.embeddingKind ?? null,
        tagMatchScore: candidate.tagMatchScore,
        visualMatchConfidence,
        finalScore: candidate.finalScore,
      },
      normalizedAttributes: {
        productId: product.id,
        platformProductId,
        platformBrandId,
        styleId: candidate.styleId,
        brand: product.brand,
        category: product.category,
        modelLine: product.modelLine,
        colorFamily: product.colorFamily,
        colorway: product.colorway,
        shoeType: product.shoeType,
        material:
          this.toString(attributes.upperMaterial) ??
          this.toString(attributes.soleMaterial),
        upperMaterial: this.toString(attributes.upperMaterial),
        soleMaterial: this.toString(attributes.soleMaterial),
        availableSizes: this.toStringArray(attributes.availableSizes),
        colorOptions: this.toStringArray(attributes.colorOptions),
        articleNumber: this.toString(attributes.articleNumber),
        keywords: fromJson<string[]>(product.keywordsJson, []),
      },
      rawPayload: {
        productPoolSource: {
          provider: 'local_product_pool',
          productId: product.id,
          platformProductId,
          platformBrandId,
          styleId: candidate.styleId,
          platform: product.platform,
          annProvider: this.config.get<string>('ann.provider') ?? 'sqlite_vec',
          embeddingProvider:
            candidate.embeddingProvider ??
            this.config.get<string>('embedding.provider') ??
            'unknown',
          embeddingId: candidate.embeddingId ?? null,
          imageRole: candidate.imageRole ?? null,
          embeddingKind: candidate.embeddingKind ?? null,
          recallSources: [...candidate.recallSources],
          annScore: candidate.annScore,
          rawAnnScore: candidate.rawAnnScore,
          annPassedMinScore: candidate.annPassedMinScore,
          tagMatchScore: candidate.tagMatchScore,
          businessScore: candidate.businessScore,
          initialScore: candidate.initialScore,
          finalScore: candidate.finalScore,
          visualVerification: candidate.verification.raw,
        },
        productRawPayload,
      },
      recommendationReason: this.buildRecommendationReason(candidate),
      productPoolKey: this.fusionKey(product.id, candidate.styleId),
    };
  }

  private displayMatchScore(candidate: ProductSearchCandidateRecord) {
    const rawScore = Math.max(
      candidate.visualVerifyScore,
      candidate.annScore,
      candidate.finalScore,
      candidate.tagMatchScore,
    );
    if (!Number.isFinite(rawScore) || rawScore <= 0) return 0;
    return this.clamp01(rawScore);
  }

  private buildRecommendationReason(candidate: ProductSearchCandidateRecord) {
    const reasons = [
      `综合匹配分 ${candidate.finalScore.toFixed(3)}`,
      `图像向量匹配 ${candidate.annScore.toFixed(3)}`,
      `标签匹配 ${candidate.tagMatchScore.toFixed(3)}`,
    ];
    if (candidate.verification.verificationStatus === 'verified') {
      reasons.push(`视觉复核置信度 ${candidate.visualVerifyScore.toFixed(2)}`);
    } else {
      reasons.push('该候选尚未经过逐商品视觉复核');
    }
    if (candidate.product.stockStatus === 'in_stock') {
      reasons.push('当前标记为有货');
    }
    return reasons;
  }

  private normalizeStockStatus(
    value: string,
  ): 'in_stock' | 'out_of_stock' | 'unknown' {
    if (value === 'in_stock' || value === 'out_of_stock') return value;
    return 'unknown';
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private clamp01(value: number) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private fusionKey(productId: string, styleId: string | null) {
    return `${productId}:${styleId ?? 'product'}`;
  }
}
