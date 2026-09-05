export const MARKETPLACE_PLATFORMS = [
  'taobao',
  'douyin',
  'pdd',
  'dewu',
  'jd',
  'vipshop',
  'suning',
  'xianyu',
] as const;

export type MarketplacePlatform = (typeof MARKETPLACE_PLATFORMS)[number];

export type MarketplaceStockStatus = 'in_stock' | 'out_of_stock' | 'unknown';

export interface MarketplaceSearchQuery {
  keywords: string[];
  filters?: Record<string, unknown>;
  limitPerPlatform?: number;
}

export interface MarketplaceProduct {
  platform: MarketplacePlatform;
  externalId: string;
  title: string;
  priceAmount: string;
  currency: string;
  shopName: string;
  shopType: string;
  stockStatus: MarketplaceStockStatus;
  coverImageUrl: string;
  productUrl: string;
  matchScore: number;
  attributes: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

export interface MarketplacePlatformSearchResult {
  platform: MarketplacePlatform;
  status: 'success' | 'skipped' | 'failed';
  items: MarketplaceProduct[];
  errorMessage?: string;
}

export function isMarketplacePlatform(value: string): value is MarketplacePlatform {
  return (MARKETPLACE_PLATFORMS as readonly string[]).includes(value);
}
