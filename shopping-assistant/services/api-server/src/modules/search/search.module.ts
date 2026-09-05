import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketplaceAggregateSearchProviderService } from '../../adapters/marketplace/marketplace-aggregate-search-provider.service';
import { OfficialApiMarketplaceAdapterService } from '../../adapters/marketplace/official-api-marketplace-adapter.service';
import { SEARCH_PROVIDER, SearchProvider } from '../../adapters/search-provider/search-provider.interface';
import { LocalProductSearchProviderService } from '../product-pool/application/local-product-search-provider.service';
import { ProductPoolModule } from '../product-pool/product-pool.module';
import { SearchController } from './controllers/search.controller';

@Module({
  imports: [ProductPoolModule],
  controllers: [SearchController],
  providers: [
    OfficialApiMarketplaceAdapterService,
    MarketplaceAggregateSearchProviderService,
    {
      provide: SEARCH_PROVIDER,
      inject: [
        ConfigService,
        LocalProductSearchProviderService,
        MarketplaceAggregateSearchProviderService,
      ],
      useFactory: (
        config: ConfigService,
        localProductPoolProvider: LocalProductSearchProviderService,
        marketplaceProvider: MarketplaceAggregateSearchProviderService,
      ): SearchProvider => {
        const provider =
          config.get<string>('productDataProvider') ??
          config.get<string>('searchProvider') ??
          process.env.PRODUCT_DATA_PROVIDER ??
          process.env.SEARCH_PROVIDER ??
          'local_product_pool';

        if (provider === 'local_product_pool') return localProductPoolProvider;
        if (provider === 'marketplace') return marketplaceProvider;
        if (provider === 'mock') {
          throw new Error('MOCK_SEARCH_PROVIDER_ARCHIVED');
        }
        throw new Error(`UNSUPPORTED_PRODUCT_DATA_PROVIDER:${provider}`);
      },
    },
  ],
  exports: [
    SEARCH_PROVIDER,
    MarketplaceAggregateSearchProviderService,
  ],
})
export class SearchModule {}
