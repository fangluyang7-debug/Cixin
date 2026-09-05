import { Injectable } from '@nestjs/common';
import { CandidateItem } from '@prisma/client';
import { CandidateSeed } from '../../../adapters/search-provider/search-provider.interface';
import { createId } from '../../../common/utils/id';
import { fromJson, toJsonArrayString, toJsonString } from '../../../common/utils/json';
import {
  CandidateItemAdapter,
  CandidateItemCreateData,
  CandidateItemCreateManyData,
} from './candidate-item-adapter.interface';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class StandardCandidateItemAdapterService implements CandidateItemAdapter {
  toCandidateItemData(input: {
    snapshotId?: string;
    item: CandidateSeed;
    rank: number;
    pageIndex: number;
  }): CandidateItemCreateData {
    const data: CandidateItemCreateData = {
      id: createId('item'),
      title: input.item.title,
      platformName: input.item.platformName,
      amount: input.item.amount,
      currency: input.item.currency,
      shopName: input.item.shopName,
      shopType: input.item.shopType,
      stockStatus: input.item.stockStatus,
      coverImageUrl: input.item.coverImageUrl,
      productUrl: input.item.productUrl,
      matchSummaryJson: toJsonString(input.item.matchSummary),
      normalizedAttributesJson: toJsonString(input.item.normalizedAttributes),
      rawPayloadJson: toJsonString(this.compactRawPayload(input.item.rawPayload)),
      recommendationReasonJson: toJsonArrayString(input.item.recommendationReason),
      rank: input.rank,
      pageIndex: input.pageIndex,
      productPoolKey:
        input.item.productPoolKey ?? this.extractProductPoolKey(input.item.rawPayload),
    };

    if (input.snapshotId) data.snapshotId = input.snapshotId;
    return data;
  }

  toCandidateItemCreateManyData(input: {
    snapshotId: string;
    item: CandidateSeed;
    rank: number;
    pageIndex: number;
  }): CandidateItemCreateManyData {
    return {
      ...this.toCandidateItemData(input),
      snapshotId: input.snapshotId,
    };
  }

  extractReturnedProductKeys(items: CandidateItem[]) {
    return items
      .map((item) =>
        item.productPoolKey ??
        this.extractProductPoolKey(fromJson<JsonRecord>(item.rawPayloadJson, {})),
      )
      .filter((item): item is string => Boolean(item));
  }

  extractProductPoolKey(rawPayload: JsonRecord) {
    const source = this.asRecord(rawPayload.productPoolSource);
    const productId = this.toString(source.productId);
    if (!productId) return null;
    const styleId = this.toString(source.styleId);
    return `${productId}:${styleId ?? 'product'}`;
  }

  private asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  }

  private compactRawPayload(rawPayload: JsonRecord) {
    const productRawPayload = this.asRecord(rawPayload.productRawPayload);
    const compactProductRawPayload: JsonRecord = {};
    for (const key of [
      'shop',
      'fulfillment',
      'attributes',
      'skuOptions',
      'skuMatrix',
      'priceHistory',
      'adapter',
    ]) {
      if (productRawPayload[key] !== undefined) {
        compactProductRawPayload[key] = productRawPayload[key];
      }
    }
    return {
      ...rawPayload,
      productRawPayload: compactProductRawPayload,
    };
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }
}
