import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../persistence/prisma/prisma.service';
import { CandidateSeed, SearchProvider } from '../search-provider/search-provider.interface';
import { OfficialApiMarketplaceAdapterService } from './official-api-marketplace-adapter.service';
import {
  isMarketplacePlatform,
  MARKETPLACE_PLATFORMS,
  MarketplacePlatform,
  MarketplaceProduct,
  MarketplaceSearchQuery,
  MarketplacePlatformSearchResult,
} from './marketplace-platform.types';

type MarketplaceSearchMode = 'official';

@Injectable()
export class MarketplaceAggregateSearchProviderService implements SearchProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly officialApiAdapter: OfficialApiMarketplaceAdapterService,
  ) {}

  async searchShoes(input: {
    keywords: string[];
    filters?: Record<string, unknown>;
    limit?: number;
  }): Promise<CandidateSeed[]> {
    const mode = this.getMode();
    const platforms = this.getEnabledPlatforms(input.filters);
    const query: MarketplaceSearchQuery = {
      keywords: input.keywords.length > 0 ? input.keywords : ['shoe'],
      filters: input.filters ?? {},
      limitPerPlatform: 8,
    };

    const results = await Promise.all(
      platforms.map((platform) => this.searchPlatform(platform, query, mode)),
    );

    const products = results.flatMap((result) => result.items);
    await this.persistExternalSnapshot(query, results, mode);

    return products
      .map((product) => this.toCandidateSeed(product))
      .sort((left, right) => Number(left.amount) - Number(right.amount))
      .slice(0, this.normalizeLimit(input.limit));
  }

  private normalizeLimit(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 30;
    return Math.max(1, Math.min(120, Math.floor(parsed)));
  }

  private async searchPlatform(
    platform: MarketplacePlatform,
    query: MarketplaceSearchQuery,
    mode: MarketplaceSearchMode,
  ): Promise<MarketplacePlatformSearchResult> {
    try {
      const officialItems = await this.officialApiAdapter.searchShoes(platform, query);
      return { platform, status: 'success', items: officialItems };
    } catch (error) {
      return {
        platform,
        status: 'failed',
        items: [],
        errorMessage: error instanceof Error ? error.message : 'MARKETPLACE_SEARCH_FAILED',
      };
    }
  }

  private toCandidateSeed(product: MarketplaceProduct): CandidateSeed {
    return {
      title: product.title,
      platformName: product.platform,
      amount: product.priceAmount,
      currency: product.currency,
      shopName: product.shopName,
      shopType: product.shopType,
      stockStatus: product.stockStatus,
      coverImageUrl: product.coverImageUrl,
      productUrl: product.productUrl,
      matchSummary: {
        brandMatched: product.matchScore >= 0.72,
        colorMatched: product.matchScore >= 0.68,
        styleMatched: product.matchScore >= 0.7,
      },
      normalizedAttributes: {
        ...product.attributes,
        externalId: product.externalId,
        platform: product.platform,
        matchScore: product.matchScore,
      },
      rawPayload: product.rawPayload,
      recommendationReason: this.buildRecommendationReasons(product),
    };
  }

  private buildRecommendationReasons(product: MarketplaceProduct): string[] {
    const reasons = [`${product.platform} candidate`];
    if (product.stockStatus === 'in_stock') reasons.push('in stock');
    if (product.matchScore >= 0.85) reasons.push('high visual and keyword match');
    if (Number(product.priceAmount) > 0) reasons.push(`price ${product.priceAmount} ${product.currency}`);
    return reasons;
  }

  private getEnabledPlatforms(filters?: Record<string, unknown>): MarketplacePlatform[] {
    const platformFilter = typeof filters?.platform === 'string' ? filters.platform.toLowerCase() : null;
    if (platformFilter && isMarketplacePlatform(platformFilter)) return [platformFilter];

    const configured = this.config.get<string>('marketplace.enabledPlatforms') ?? process.env.MARKETPLACE_ENABLED_PLATFORMS;
    if (!configured) return [...MARKETPLACE_PLATFORMS];

    const platforms = configured
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(isMarketplacePlatform);
    return platforms.length > 0 ? platforms : [...MARKETPLACE_PLATFORMS];
  }

  private getMode(): MarketplaceSearchMode {
    const raw =
      this.config.get<string>('marketplace.searchMode') ?? process.env.MARKETPLACE_SEARCH_MODE ?? 'official';
    if (raw === 'official') return raw;
    throw new Error(`MARKETPLACE_FIXTURE_SEARCH_ARCHIVED:${raw}`);
  }

  private async persistExternalSnapshot(
    query: MarketplaceSearchQuery,
    results: MarketplacePlatformSearchResult[],
    mode: MarketplaceSearchMode,
  ) {
    await this.prisma.externalSnapshot.create({
      data: {
        id: `external_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        provider: `marketplace_${mode}`,
        requestJson: JSON.stringify(query),
        responseJson: JSON.stringify(
          results.map((result) => ({
            platform: result.platform,
            status: result.status,
            itemCount: result.items.length,
            errorMessage: result.errorMessage ?? null,
          })),
        ),
        status: results.some((result) => result.status === 'success') ? 'success' : 'failed',
      },
    });
  }
}
