import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MarketplacePlatform,
  MarketplaceProduct,
  MarketplaceSearchQuery,
  MarketplaceStockStatus,
} from './marketplace-platform.types';

interface RawMarketplaceItem {
  id?: unknown;
  itemId?: unknown;
  title?: unknown;
  price?: unknown;
  amount?: unknown;
  currency?: unknown;
  shopName?: unknown;
  shopType?: unknown;
  stockStatus?: unknown;
  imageUrl?: unknown;
  coverImageUrl?: unknown;
  productUrl?: unknown;
  url?: unknown;
  matchScore?: unknown;
  attributes?: unknown;
}

@Injectable()
export class OfficialApiMarketplaceAdapterService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(platform: MarketplacePlatform): boolean {
    return Boolean(this.getBaseUrl(platform) && this.getApiKey(platform));
  }

  async searchShoes(
    platform: MarketplacePlatform,
    query: MarketplaceSearchQuery,
  ): Promise<MarketplaceProduct[]> {
    const baseUrl = this.getBaseUrl(platform);
    const apiKey = this.getApiKey(platform);
    if (!baseUrl || !apiKey) return [];

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/search/shoes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        platform,
        keywords: query.keywords,
        filters: query.filters ?? {},
        limit: query.limitPerPlatform ?? 8,
      }),
    });

    if (!response.ok) {
      throw new Error(`AUTHORIZED_MARKETPLACE_API_FAILED_${platform}_${response.status}`);
    }

    const body = (await response.json()) as unknown;
    const items = extractItems(body);
    return items.map((item, index) => this.normalizeItem(platform, item, index));
  }

  private getBaseUrl(platform: MarketplacePlatform): string | undefined {
    return (
      this.config.get<string>(`marketplace.${platform}.apiBaseUrl`) ??
      process.env[`MARKETPLACE_${platform.toUpperCase()}_API_BASE_URL`]
    );
  }

  private getApiKey(platform: MarketplacePlatform): string | undefined {
    return (
      this.config.get<string>(`marketplace.${platform}.apiKey`) ??
      process.env[`MARKETPLACE_${platform.toUpperCase()}_API_KEY`]
    );
  }

  private normalizeItem(
    platform: MarketplacePlatform,
    rawItem: RawMarketplaceItem,
    index: number,
  ): MarketplaceProduct {
    const id = readString(rawItem.id) ?? readString(rawItem.itemId) ?? `official-${platform}-${index}`;
    const amount = readString(rawItem.amount) ?? readString(rawItem.price) ?? '0.00';
    const attributes = isRecord(rawItem.attributes) ? rawItem.attributes : {};

    return {
      platform,
      externalId: id,
      title: readString(rawItem.title) ?? 'Untitled marketplace item',
      priceAmount: normalizeAmount(amount),
      currency: readString(rawItem.currency) ?? 'CNY',
      shopName: readString(rawItem.shopName) ?? `${platform} shop`,
      shopType: readString(rawItem.shopType) ?? 'marketplace',
      stockStatus: normalizeStockStatus(rawItem.stockStatus),
      coverImageUrl: readString(rawItem.coverImageUrl) ?? readString(rawItem.imageUrl) ?? '',
      productUrl: readString(rawItem.productUrl) ?? readString(rawItem.url) ?? '',
      matchScore: readNumber(rawItem.matchScore) ?? 0.7,
      attributes,
      rawPayload: {
        provider: 'authorized_api',
        platform,
        rawItem: rawItem as Record<string, unknown>,
      },
    };
  }
}

function extractItems(body: unknown): RawMarketplaceItem[] {
  if (Array.isArray(body)) return body.filter(isRecord);
  if (!isRecord(body)) return [];
  const data = body.data;
  if (Array.isArray(body.items)) return body.items.filter(isRecord);
  if (isRecord(data) && Array.isArray(data.items)) return data.items.filter(isRecord);
  return [];
}

function normalizeAmount(value: string): string {
  const amount = Number(value.replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function normalizeStockStatus(value: unknown): MarketplaceStockStatus {
  if (value === 'in_stock' || value === 'out_of_stock' || value === 'unknown') return value;
  if (value === true) return 'in_stock';
  if (value === false) return 'out_of_stock';
  return 'unknown';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
