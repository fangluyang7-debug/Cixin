import { Injectable } from '@nestjs/common';
import { fromJson } from '../../../common/utils/json';
import {
  ProductAttributeView,
  ProductRawPayloadAdapter,
  ProductStyleImageInput,
} from './product-raw-payload-adapter.interface';

@Injectable()
export class StandardProductRawPayloadAdapterService
  implements ProductRawPayloadAdapter
{
  extractStyleImages(
    rawPayload?: Record<string, unknown>,
  ): ProductStyleImageInput[] {
    const media = rawPayload?.media;
    const skuOptions = rawPayload?.skuOptions;
    const mediaImages =
      media &&
      typeof media === 'object' &&
      Array.isArray((media as Record<string, unknown>).styleImages)
        ? ((media as Record<string, unknown>).styleImages as unknown[])
        : [];
    const skuImages =
      skuOptions &&
      typeof skuOptions === 'object' &&
      Array.isArray((skuOptions as Record<string, unknown>).styles)
        ? ((skuOptions as Record<string, unknown>).styles as unknown[])
        : [];

    const seen = new Set<string>();
    return [...mediaImages, ...skuImages]
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const imageUrl = typeof record.imageUrl === 'string' ? record.imageUrl : null;
        if (!imageUrl || seen.has(imageUrl)) return null;
        seen.add(imageUrl);
        return {
          styleId: typeof record.styleId === 'string' ? record.styleId : null,
          styleName:
            typeof record.styleName === 'string'
              ? record.styleName
              : typeof record.name === 'string'
                ? record.name
                : null,
          imageUrl,
        };
      })
      .filter((item): item is ProductStyleImageInput => Boolean(item));
  }

  extractStyleImagesFromJson(rawPayloadJson: string): ProductStyleImageInput[] {
    return this.extractStyleImages(
      this.asRecord(fromJson<Record<string, unknown>>(rawPayloadJson, {})),
    );
  }

  buildAttributeView(rawPayloadJson: string): ProductAttributeView {
    const rawPayload = this.asRecord(
      fromJson<Record<string, unknown>>(rawPayloadJson, {}),
    );
    const attributes = this.asRecord(rawPayload.attributes);
    const shop = this.asRecord(rawPayload.shop);
    const ratings = this.asRecord(shop.ratings);
    const fulfillment = this.asRecord(rawPayload.fulfillment);
    return {
      brand: this.toNonEmptyString(attributes.brand),
      modelLine: this.toNonEmptyString(attributes.modelLine),
      shoeType: this.toNonEmptyString(attributes.shoeType),
      upperMaterial: this.toNonEmptyString(attributes.upperMaterial),
      soleMaterial: this.toNonEmptyString(attributes.soleMaterial),
      availableSizes: Array.isArray(attributes.availableSizes)
        ? attributes.availableSizes
        : [],
      colorOptions: Array.isArray(attributes.colorOptions)
        ? attributes.colorOptions
        : [],
      ratingOverall: this.toOptionalNumber(ratings.overall),
      deliveryTimeText: this.toNonEmptyString(fulfillment.deliveryTimeText),
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }

  private toOptionalNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toNonEmptyString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }
}
