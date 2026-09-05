import { Module } from '@nestjs/common';
import { CACHE_STORE } from './cache.constants';
import { InMemoryCacheStore } from './implementations/in-memory-cache.store';

@Module({
  providers: [
    InMemoryCacheStore,
    {
      provide: CACHE_STORE,
      useExisting: InMemoryCacheStore,
    },
  ],
  exports: [CACHE_STORE],
})
export class CacheModule {}
