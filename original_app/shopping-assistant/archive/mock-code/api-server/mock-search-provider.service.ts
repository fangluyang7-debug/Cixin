import { Injectable } from '@nestjs/common';
import { CandidateSeed, SearchProvider } from './search-provider.interface';

export const MOCK_SHOE_ITEMS: CandidateSeed[] = [
  {
    title: 'Nike Air Zoom Pegasus 40 Black White',
    platformName: 'mock_platform_a',
    amount: '469.00',
    currency: 'CNY',
    shopName: 'Mock Nike Flagship',
    shopType: 'flagship',
    stockStatus: 'in_stock',
    coverImageUrl: 'https://example.com/demo/shoe-pegasus-black.jpg',
    productUrl: 'https://example.com/products/mock-pegasus-40-a',
    matchSummary: { brandMatched: true, colorMatched: true, styleMatched: true },
    normalizedAttributes: { brand: 'Nike', color: 'black', category: 'running_shoes' },
    rawPayload: { provider: 'mock', sourceRank: 1 },
    recommendationReason: ['当前列表低价', '有货', '与识别结果高度匹配'],
  },
  {
    title: 'Nike Air Zoom Pegasus 40 Black',
    platformName: 'mock_platform_b',
    amount: '499.00',
    currency: 'CNY',
    shopName: 'Mock Sports Store',
    shopType: 'authorized',
    stockStatus: 'unknown',
    coverImageUrl: 'https://example.com/demo/shoe-pegasus-black-alt.jpg',
    productUrl: 'https://example.com/products/mock-pegasus-40-b',
    matchSummary: { brandMatched: true, colorMatched: true, styleMatched: true },
    normalizedAttributes: { brand: 'Nike', color: 'black', category: 'running_shoes' },
    rawPayload: { provider: 'mock', sourceRank: 2 },
    recommendationReason: ['价格接近最低', '库存待确认'],
  },
  {
    title: 'Nike Air Zoom Pegasus 40 Black White',
    platformName: 'mock_platform_c',
    amount: '529.00',
    currency: 'CNY',
    shopName: 'Mock Marketplace Shop',
    shopType: 'marketplace',
    stockStatus: 'out_of_stock',
    coverImageUrl: 'https://example.com/demo/shoe-pegasus-black-c.jpg',
    productUrl: 'https://example.com/products/mock-pegasus-40-c',
    matchSummary: { brandMatched: true, colorMatched: true, styleMatched: true },
    normalizedAttributes: { brand: 'Nike', color: 'black', category: 'running_shoes' },
    rawPayload: { provider: 'mock', sourceRank: 3 },
    recommendationReason: ['同款匹配', '当前无货'],
  },
];

@Injectable()
export class MockSearchProviderService implements SearchProvider {
  async searchShoes(input: { keywords: string[]; filters?: Record<string, unknown> }) {
    const filters = input.filters ?? {};
    const priceMax = typeof filters.priceMax === 'string' ? Number(filters.priceMax) : null;
    const stockOnly = filters.stockOnly === true;

    return MOCK_SHOE_ITEMS.filter((item) => {
      if (priceMax !== null && Number(item.amount) > priceMax) return false;
      if (stockOnly && item.stockStatus !== 'in_stock') return false;
      return true;
    });
  }
}
