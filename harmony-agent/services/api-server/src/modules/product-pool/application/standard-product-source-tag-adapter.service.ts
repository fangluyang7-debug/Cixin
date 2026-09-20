import { Injectable } from '@nestjs/common';
import { ProductTagResult } from '../../../adapters/model/model-adapter.interface';
import { fromJson } from '../../../common/utils/json';
import { ProductImportItemDto } from '../dto/import-products.dto';
import {
  ProductSourceTagAdapter,
  ProductTagProductSource,
} from './product-source-tag-adapter.interface';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';

@Injectable()
export class StandardProductSourceTagAdapterService
  implements ProductSourceTagAdapter
{
  buildTagFromSourceAttributes(
    item: ProductImportItemDto,
  ): ProductTagResult | null {
    const attributes = this.getRawPayloadRecord(item.rawPayload, 'attributes');
    if (!attributes) return null;

    const brand = this.readString(attributes.brand) ?? item.brandHint ?? null;
    const category = normalizeProductCategory(
      this.readString(attributes.category) ??
        this.readString(attributes.normalizedCategory) ??
        item.categoryHint ??
        item.title,
      'general',
    );

    const modelLine = this.readString(attributes.modelLine);
    const colorOptions = Array.isArray(attributes.colorOptions)
      ? attributes.colorOptions.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const colorFamily =
      this.readString(attributes.colorFamily) ??
      this.readString(attributes.color) ??
      colorOptions[0] ??
      null;

    const keywords = [
      item.title,
      category,
      brand,
      modelLine,
      colorFamily,
      this.readString(attributes.shoeType),
      this.readString(attributes.scene),
    ].filter((value): value is string => Boolean(value));

    return {
      category,
      brand,
      modelLine,
      colorFamily,
      colorway: this.readString(attributes.colorway) ?? colorFamily,
      shoeType:
        this.readString(attributes.shoeType) ??
        this.readString(attributes.normalizedCategory),
      keywords: [...new Set(keywords)],
      confidence: 0.95,
      raw: {
        provider: 'source_attributes',
        source: 'rawPayload.attributes',
      },
    };
  }

  buildTagFromProduct(product: ProductTagProductSource): ProductTagResult {
    return {
      category: normalizeProductCategory(product.category, 'general'),
      brand: product.brand,
      modelLine: product.modelLine,
      colorFamily: product.colorFamily,
      colorway: product.colorway,
      shoeType: product.shoeType,
      keywords: fromJson<string[]>(product.keywordsJson, []),
      confidence: product.tagConfidence ?? 0,
      raw: fromJson<Record<string, unknown>>(product.normalizedTagsJson, {}),
    };
  }

  private getRawPayloadRecord(
    rawPayload: Record<string, unknown> | undefined,
    key: string,
  ): Record<string, unknown> | null {
    const value = rawPayload?.[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }
}
