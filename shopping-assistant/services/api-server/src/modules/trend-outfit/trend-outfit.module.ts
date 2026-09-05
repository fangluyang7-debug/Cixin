import { Module } from '@nestjs/common';
import { CacheModule } from '../../cache/cache.module';
import { ContentSearchModule } from '../../adapters/content-search/content-search.module';
import { ProductProfileModule } from '../product-profile/product-profile.module';
import { TrendOutfitProductMatcherService } from './application/trend-outfit-product-matcher.service';
import { TrendOutfitService } from './application/trend-outfit.service';
import { TrendOutfitController } from './controllers/trend-outfit.controller';

@Module({
  imports: [CacheModule, ProductProfileModule, ContentSearchModule],
  controllers: [TrendOutfitController],
  providers: [
    TrendOutfitService,
    TrendOutfitProductMatcherService,
  ],
  exports: [TrendOutfitService],
})
export class TrendOutfitModule {}
