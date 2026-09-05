import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toJsonArrayString, toJsonString } from '../../../common/utils/json';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';
import {
  PRODUCT_STOCK_STATUSES,
  ProductImportItemDto,
} from '../dto/import-products.dto';
import { ProductUpdateAdapter } from './product-update-adapter.interface';

@Injectable()
export class StandardProductUpdateAdapterService implements ProductUpdateAdapter {
  toProductUpdateData(body: Record<string, unknown>): Prisma.ProductUpdateInput {
    if (!this.isRecord(body)) {
      throw new BadRequestException('PRODUCT_UPDATE_BODY_INVALID');
    }

    const data: Record<string, unknown> = {};
    const stringFields = [
      'title',
      'priceAmount',
      'currency',
      'shopName',
      'shopType',
      'productUrl',
      'sourceImageUrl',
      'imagePublicUrl',
      'tagStatus',
      'brand',
      'category',
      'modelLine',
      'colorFamily',
      'colorway',
      'shoeType',
    ];

    if ('price' in body && !('priceAmount' in body)) {
      const price = this.readString(body.price);
      if (!price) throw new BadRequestException('PRODUCT_UPDATE_PRICE_INVALID');
      data.priceAmount = price;
    }

    if ('stockStatus' in body) {
      const stockStatus = this.readString(body.stockStatus);
      if (!stockStatus || !PRODUCT_STOCK_STATUSES.includes(stockStatus as ProductImportItemDto['stockStatus'])) {
        throw new BadRequestException('PRODUCT_UPDATE_STOCK_STATUS_INVALID');
      }
      data.stockStatus = stockStatus;
    }

    for (const field of stringFields) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null) {
        if (['title', 'priceAmount', 'currency', 'productUrl', 'tagStatus'].includes(field)) {
          throw new BadRequestException(`PRODUCT_UPDATE_${field.toUpperCase()}_INVALID`);
        }
        data[field] = null;
        continue;
      }
      const stringValue = this.readString(value);
      if (!stringValue) {
        throw new BadRequestException(`PRODUCT_UPDATE_${field.toUpperCase()}_INVALID`);
      }
      data[field] = field === 'category'
        ? normalizeProductCategory(stringValue)
        : stringValue;
    }

    if ('keywords' in body) {
      if (!Array.isArray(body.keywords)) {
        throw new BadRequestException('PRODUCT_UPDATE_KEYWORDS_INVALID');
      }
      data.keywordsJson = toJsonArrayString(
        body.keywords.filter((item): item is string => typeof item === 'string' && item.length > 0),
      );
    }

    if ('normalizedTags' in body) {
      if (!this.isRecord(body.normalizedTags)) {
        throw new BadRequestException('PRODUCT_UPDATE_NORMALIZED_TAGS_INVALID');
      }
      data.normalizedTagsJson = toJsonString(body.normalizedTags);
    }

    if ('rawPayload' in body) {
      if (!this.isRecord(body.rawPayload)) {
        throw new BadRequestException('PRODUCT_UPDATE_RAW_PAYLOAD_INVALID');
      }
      data.rawPayloadJson = toJsonString(body.rawPayload);
    }

    if ('tagConfidence' in body) {
      const value = this.toOptionalNumber(body.tagConfidence);
      if (value === null || value < 0 || value > 1) {
        throw new BadRequestException('PRODUCT_UPDATE_TAG_CONFIDENCE_INVALID');
      }
      data.tagConfidence = value;
    }

    return data as Prisma.ProductUpdateInput;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private toOptionalNumber(value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
