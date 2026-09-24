import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './common/config/configuration';
import { PersistenceModule } from './persistence/prisma/persistence.module';
import { AssetsModule } from './modules/assets/assets.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { ProductProfileModule } from './modules/product-profile/product-profile.module';
import { SearchModule } from './modules/search/search.module';
import { CandidatesModule } from './modules/candidates/candidates.module';
import { TurnsModule } from './modules/turns/turns.module';
import { SuggestionsModule } from './modules/suggestions/suggestions.module';
import { DetailsModule } from './modules/details/details.module';
import { FallbackModule } from './modules/fallback/fallback.module';
import { HealthModule } from './modules/health/health.module';
import { ProductPoolModule } from './modules/product-pool/product-pool.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserMemoryModule } from './modules/user-memory/user-memory.module';
import { TrendOutfitModule } from './modules/trend-outfit/trend-outfit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PersistenceModule,
    SearchModule,
    ProductPoolModule,
    AuthModule,
    UserMemoryModule,
    AssetsModule,
    SessionsModule,
    ProductProfileModule,
    CandidatesModule,
    TurnsModule,
    SuggestionsModule,
    TrendOutfitModule,
    DetailsModule,
    FallbackModule,
    HealthModule,
  ],
})
export class AppModule {}
