import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ImportProductsDto,
  PRODUCT_PLATFORMS,
  PRODUCT_STOCK_STATUSES,
  ProductImportItemDto,
  ProductPlatform,
  ProductStockStatus,
} from '../dto/import-products.dto';
import { ProductImportAdapter, ProductImportAdapterResult } from './product-import-adapter.interface';
import { parsePlatformProductReference } from './platform-product-reference';

@Injectable()
export class StandardProductImportAdapterService implements ProductImportAdapter {
  normalizeBatch(input: unknown): ProductImportAdapterResult {
    if (!this.isRecord(input)) {
      throw new BadRequestException('PRODUCT_IMPORT_BODY_REQUIRED');
    }

    const batchSource = this.cleanString(input.batchSource);
    if (!batchSource) {
      throw new BadRequestException('PRODUCT_IMPORT_BATCH_SOURCE_REQUIRED');
    }

    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new BadRequestException('PRODUCT_IMPORT_ITEMS_REQUIRED');
    }

    const warnings: string[] = [];
    const items = input.items.map((item, index) => this.normalizeItem(item, index, warnings));
    const dto: ImportProductsDto = {
      batchSource,
      items,
    };

    return {
      dto,
      metadata: {
        adapterName: 'standard_product_import_adapter',
        schemaVersion: this.cleanString(input.schemaVersion) ?? 'product_import_items.v1',
        normalizedAt: new Date().toISOString(),
        itemCount: items.length,
        warnings,
      },
    };
  }

  private normalizeItem(input: unknown, index: number, warnings: string[]): ProductImportItemDto {
    if (!this.isRecord(input)) {
      throw new BadRequestException(`PRODUCT_IMPORT_ITEM_${index}_REQUIRED`);
    }

    const images = this.isRecord(input.images) ? input.images : {};
    const imageUrl =
      this.cleanString(input.imageUrl) ??
      this.cleanString(images.mainImageUrl) ??
      this.cleanString(images.mainImage);
    const localImagePath = this.cleanString(input.localImagePath);
    const imageDataBase64 = this.cleanString(input.imageDataBase64);

    const platform = this.normalizePlatform(input.platform);
    const productUrl = this.requireString(
      input.productUrl,
      'PRODUCT_IMPORT_PRODUCTURL_REQUIRED',
    );
    const parsedReference = parsePlatformProductReference(platform, productUrl);
    const providedExternalId = this.cleanString(input.externalId);
    const externalId = parsedReference.productId ?? providedExternalId;
    if (
      parsedReference.productId &&
      providedExternalId &&
      parsedReference.productId !== providedExternalId
    ) {
      warnings.push(`item_${index}:external_id_replaced_by_product_url`);
    }
    if (!externalId) {
      warnings.push(`item_${index}:platform_product_id_unavailable`);
    } else if (!parsedReference.productId) {
      warnings.push(`item_${index}:platform_product_id_legacy_fallback`);
    }

    const item: ProductImportItemDto = {
      externalId: externalId ?? undefined,
      platform,
      title: this.requireString(input.title, 'PRODUCT_IMPORT_TITLE_REQUIRED'),
      price: this.requireString(input.price, 'PRODUCT_IMPORT_PRICE_REQUIRED'),
      currency: this.cleanString(input.currency) ?? 'CNY',
      stockStatus: this.normalizeStockStatus(input.stockStatus),
      shopName: this.readShopString(input, 'name') ?? this.cleanString(input.shopName) ?? undefined,
      shopType: this.readShopString(input, 'type') ?? this.cleanString(input.shopType) ?? undefined,
      productUrl,
      imageUrl: imageUrl ?? undefined,
      localImagePath: localImagePath ?? undefined,
      imageDataBase64: imageDataBase64 ?? undefined,
      imageContentType: this.cleanString(input.imageContentType) ?? undefined,
      brandHint: this.cleanString(input.brandHint) ?? undefined,
      categoryHint: this.cleanString(input.categoryHint) ?? undefined,
      rawPayload: this.normalizeRawPayload(input, parsedReference),
    };

    if (!item.imageUrl && !item.localImagePath && !item.imageDataBase64) {
      throw new BadRequestException('PRODUCT_IMPORT_IMAGE_REQUIRED');
    }

    if (item.currency !== 'CNY') {
      warnings.push(`item_${index}:currency_normalized_to_${item.currency}`);
    }

    return item;
  }

  private normalizeRawPayload(
    input: Record<string, unknown>,
    parsedReference: { productId: string | null; brandId: string | null },
  ) {
    const rawPayload = this.isRecord(input.rawPayload) ? input.rawPayload : {};
    const adapter = {
      sourceSchemaVersion: this.cleanString(input.schemaVersion) ?? null,
      dataQuality: this.isRecord(input.dataQuality) ? input.dataQuality : null,
      service: this.isRecord(input.service) ? input.service : null,
      parameters: this.isRecord(input.parameters) ? input.parameters : null,
      sku: this.isRecord(input.sku) ? input.sku : null,
      images: this.isRecord(input.images) ? input.images : null,
      platformProductReference: parsedReference,
    };

    return {
      ...rawPayload,
      adapter,
    };
  }

  private normalizePlatform(value: unknown): ProductPlatform {
    const platform = this.cleanString(value)?.toLowerCase();
    if (platform && PRODUCT_PLATFORMS.includes(platform as ProductPlatform)) {
      return platform as ProductPlatform;
    }
    return 'manual';
  }

  private normalizeStockStatus(value: unknown): ProductStockStatus {
    const stockStatus = this.cleanString(value);
    if (stockStatus && PRODUCT_STOCK_STATUSES.includes(stockStatus as ProductStockStatus)) {
      return stockStatus as ProductStockStatus;
    }
    return 'unknown';
  }

  private readShopString(input: Record<string, unknown>, key: string) {
    const shop = this.isRecord(input.shop) ? input.shop : {};
    return this.cleanString(shop[key]);
  }

  private requireString(value: unknown, code: string) {
    const normalized = this.cleanString(value);
    if (!normalized) throw new BadRequestException(code);
    return normalized;
  }

  private cleanString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
