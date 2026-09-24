import { Injectable } from '@nestjs/common';
import {
  MarketplacePlatform,
  MarketplaceProduct,
  MarketplaceSearchQuery,
} from './marketplace-platform.types';

const FIXTURE_ITEMS: MarketplaceProduct[] = [
  {
    platform: 'taobao',
    externalId: 'fixture-taobao-pegasus-40-001',
    title: 'Nike Air Zoom Pegasus 40 black white running shoes',
    priceAmount: '459.00',
    currency: 'CNY',
    shopName: 'Taobao authorized sports store',
    shopType: 'authorized',
    stockStatus: 'in_stock',
    coverImageUrl: 'https://example.com/fixtures/taobao-pegasus-40.jpg',
    productUrl: 'https://example.com/taobao/fixture-taobao-pegasus-40-001',
    matchScore: 0.91,
    attributes: {
      brand: 'Nike',
      model: 'Pegasus 40',
      color: 'black white',
      category: 'running_shoes',
      material: 'mesh',
    },
    rawPayload: { fixture: true, platform: 'taobao', sourceRank: 1 },
  },
  {
    platform: 'jd',
    externalId: 'fixture-jd-pegasus-40-001',
    title: 'Nike Pegasus 40 breathable running shoes',
    priceAmount: '489.00',
    currency: 'CNY',
    shopName: 'JD sports flagship sample',
    shopType: 'flagship',
    stockStatus: 'in_stock',
    coverImageUrl: 'https://example.com/fixtures/jd-pegasus-40.jpg',
    productUrl: 'https://example.com/jd/fixture-jd-pegasus-40-001',
    matchScore: 0.89,
    attributes: {
      brand: 'Nike',
      model: 'Pegasus 40',
      color: 'black',
      category: 'running_shoes',
      material: 'mesh',
    },
    rawPayload: { fixture: true, platform: 'jd', sourceRank: 2 },
  },
  {
    platform: 'pdd',
    externalId: 'fixture-pdd-pegasus-40-001',
    title: 'Pegasus 40 style lightweight running shoes',
    priceAmount: '399.00',
    currency: 'CNY',
    shopName: 'PDD sports discount sample',
    shopType: 'marketplace',
    stockStatus: 'unknown',
    coverImageUrl: 'https://example.com/fixtures/pdd-pegasus-40.jpg',
    productUrl: 'https://example.com/pdd/fixture-pdd-pegasus-40-001',
    matchScore: 0.74,
    attributes: {
      brand: 'Nike',
      model: 'Pegasus 40',
      color: 'black',
      category: 'running_shoes',
      material: 'synthetic',
    },
    rawPayload: { fixture: true, platform: 'pdd', sourceRank: 3 },
  },
  {
    platform: 'douyin',
    externalId: 'fixture-douyin-pegasus-40-001',
    title: 'Black white running shoes live commerce sample',
    priceAmount: '429.00',
    currency: 'CNY',
    shopName: 'Douyin live sports sample',
    shopType: 'marketplace',
    stockStatus: 'in_stock',
    coverImageUrl: 'https://example.com/fixtures/douyin-running-shoes.jpg',
    productUrl: 'https://example.com/douyin/fixture-douyin-pegasus-40-001',
    matchScore: 0.78,
    attributes: {
      brand: 'Nike',
      model: 'Pegasus 40',
      color: 'black white',
      category: 'running_shoes',
      material: 'mesh',
    },
    rawPayload: { fixture: true, platform: 'douyin', sourceRank: 4 },
  },
  {
    platform: 'dewu',
    externalId: 'fixture-dewu-pegasus-40-001',
    title: 'Nike Air Zoom Pegasus 40 verified sneakers',
    priceAmount: '539.00',
    currency: 'CNY',
    shopName: 'Dewu verified sample',
    shopType: 'verified',
    stockStatus: 'in_stock',
    coverImageUrl: 'https://example.com/fixtures/dewu-pegasus-40.jpg',
    productUrl: 'https://example.com/dewu/fixture-dewu-pegasus-40-001',
    matchScore: 0.88,
    attributes: {
      brand: 'Nike',
      model: 'Pegasus 40',
      color: 'black white',
      category: 'running_shoes',
      material: 'mesh',
    },
    rawPayload: { fixture: true, platform: 'dewu', sourceRank: 5 },
  },
  {
    platform: 'taobao',
    externalId: 'fixture-taobao-samba-001',
    title: 'Adidas Samba OG white black sneakers',
    priceAmount: '579.00',
    currency: 'CNY',
    shopName: 'Taobao sneaker store sample',
    shopType: 'authorized',
    stockStatus: 'in_stock',
    coverImageUrl: 'https://example.com/fixtures/taobao-samba-og.jpg',
    productUrl: 'https://example.com/taobao/fixture-taobao-samba-001',
    matchScore: 0.66,
    attributes: {
      brand: 'Adidas',
      model: 'Samba OG',
      color: 'white black',
      category: 'casual_shoes',
      material: 'leather',
    },
    rawPayload: { fixture: true, platform: 'taobao', sourceRank: 6 },
  },
];

@Injectable()
export class FixtureMarketplaceAdapterService {
  async searchShoes(
    platform: MarketplacePlatform,
    query: MarketplaceSearchQuery,
  ): Promise<MarketplaceProduct[]> {
    const filters = query.filters ?? {};
    const priceMax = readNumberFilter(filters.priceMax);
    const stockOnly = filters.stockOnly === true;
    const platformFilter = typeof filters.platform === 'string' ? filters.platform.toLowerCase() : null;
    const limit = query.limitPerPlatform ?? 8;
    const keywordText = query.keywords.join(' ').toLowerCase();

    if (platformFilter && platformFilter !== platform) return [];

    return FIXTURE_ITEMS.filter((item) => item.platform === platform)
      .filter((item) => {
        if (priceMax !== null && Number(item.priceAmount) > priceMax) return false;
        if (stockOnly && item.stockStatus !== 'in_stock') return false;
        if (!keywordText) return true;

        const haystack = [
          item.title,
          item.shopName,
          String(item.attributes.brand ?? ''),
          String(item.attributes.model ?? ''),
          String(item.attributes.category ?? ''),
        ]
          .join(' ')
          .toLowerCase();
        return query.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())) || item.matchScore >= 0.7;
      })
      .sort((left, right) => right.matchScore - left.matchScore)
      .slice(0, limit);
  }
}

function readNumberFilter(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
