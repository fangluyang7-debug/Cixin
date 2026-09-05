import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheModule } from '../../cache/cache.module';
import { AssetsModule } from '../assets/assets.module';
import { ProductProfileModule } from '../product-profile/product-profile.module';
import { ProductPoolController } from './controllers/product-pool.controller';
import { ANN_SEARCH_PORT } from './application/ann-search-port.interface';
import { AnnSearchService } from './application/ann-search.service';
import { CANDIDATE_VISUAL_VERIFICATION_ADAPTER } from './application/candidate-visual-verification-adapter.interface';
import { EMBEDDING_PROVIDER } from './application/embedding.constants';
import { EmbeddingProvider } from './application/embedding-provider.interface';
import { HashEmbeddingProviderService } from './application/hash-embedding-provider.service';
import { PRODUCT_IMAGE_CONTENT_ADAPTER } from './application/product-image-content-adapter.interface';
import { PRODUCT_IMPORT_BATCH_STATE_ADAPTER } from './application/product-import-batch-state-adapter.interface';
import {
  IMAGE_EMBEDDING_PREPROCESSOR,
  ImageEmbeddingPreprocessor,
} from './application/image-embedding-preprocessor.interface';
import { LocalProductSearchProviderService } from './application/local-product-search-provider.service';
import { LocalGpuEmbeddingProviderService } from './application/local-gpu-embedding-provider.service';
import { LocalGpuImagePreprocessorService } from './application/local-gpu-image-preprocessor.service';
import { LocalImageWorkerClientService } from './application/local-image-worker-client.service';
import { LocalImageWorkerHealthService } from './application/local-image-worker-health.service';
import { NoopImageEmbeddingPreprocessorService } from './application/noop-image-embedding-preprocessor.service';
import { PRODUCT_BATCH_VIEW_ADAPTER } from './application/product-batch-view-adapter.interface';
import { PRODUCT_BATCH_QUALITY_ADAPTER } from './application/product-batch-quality-adapter.interface';
import { PRODUCT_IMPORT_CHANGE_ADAPTER } from './application/product-import-change-adapter.interface';
import { PRODUCT_IMAGE_EMBEDDING_ADAPTER } from './application/product-image-embedding-adapter.interface';
import { PRODUCT_IMPORT_ADAPTER } from './application/product-import-adapter.interface';
import { PRODUCT_MODEL_TAGGING_ADAPTER } from './application/product-model-tagging-adapter.interface';
import { PRODUCT_PERSISTENCE_ADAPTER } from './application/product-persistence-adapter.interface';
import { PRODUCT_RAW_PAYLOAD_ADAPTER } from './application/product-raw-payload-adapter.interface';
import { PRODUCT_SEARCH_RESULT_ADAPTER } from './application/product-search-result-adapter.interface';
import { PRODUCT_SEARCH_SIGNALS_ADAPTER } from './application/product-search-signals-adapter.interface';
import { PRODUCT_SOURCE_TAG_ADAPTER } from './application/product-source-tag-adapter.interface';
import { PRODUCT_UPDATE_ADAPTER } from './application/product-update-adapter.interface';
import { PRODUCT_VIEW_ADAPTER } from './application/product-view-adapter.interface';
import { SEARCH_QUERY_EMBEDDING_ADAPTER } from './application/search-query-embedding-adapter.interface';
import { ProductPoolService } from './application/product-pool.service';
import { StandardCandidateVisualVerificationAdapterService } from './application/standard-candidate-visual-verification-adapter.service';
import { StandardProductImageContentAdapterService } from './application/standard-product-image-content-adapter.service';
import { StandardProductImportBatchStateAdapterService } from './application/standard-product-import-batch-state-adapter.service';
import { StandardProductBatchViewAdapterService } from './application/standard-product-batch-view-adapter.service';
import { StandardProductBatchQualityAdapterService } from './application/standard-product-batch-quality-adapter.service';
import { StandardProductImportChangeAdapterService } from './application/standard-product-import-change-adapter.service';
import { StandardProductImportAdapterService } from './application/standard-product-import-adapter.service';
import { StandardProductImageEmbeddingAdapterService } from './application/standard-product-image-embedding-adapter.service';
import { StandardProductModelTaggingAdapterService } from './application/standard-product-model-tagging-adapter.service';
import { StandardProductPersistenceAdapterService } from './application/standard-product-persistence-adapter.service';
import { StandardProductRawPayloadAdapterService } from './application/standard-product-raw-payload-adapter.service';
import { StandardProductSearchResultAdapterService } from './application/standard-product-search-result-adapter.service';
import { StandardProductSearchSignalsAdapterService } from './application/standard-product-search-signals-adapter.service';
import { StandardProductSourceTagAdapterService } from './application/standard-product-source-tag-adapter.service';
import { StandardSearchQueryEmbeddingAdapterService } from './application/standard-search-query-embedding-adapter.service';
import { StandardProductUpdateAdapterService } from './application/standard-product-update-adapter.service';
import { StandardProductViewAdapterService } from './application/standard-product-view-adapter.service';
import { VolcengineDoubaoEmbeddingProviderService } from './application/volcengine-doubao-embedding-provider.service';

@Module({
  imports: [CacheModule, AssetsModule, ProductProfileModule],
  controllers: [ProductPoolController],
  providers: [
    ProductPoolService,
    HashEmbeddingProviderService,
    VolcengineDoubaoEmbeddingProviderService,
    LocalGpuEmbeddingProviderService,
    LocalGpuImagePreprocessorService,
    LocalImageWorkerClientService,
    LocalImageWorkerHealthService,
    NoopImageEmbeddingPreprocessorService,
    StandardCandidateVisualVerificationAdapterService,
    StandardProductImageContentAdapterService,
    StandardProductImportBatchStateAdapterService,
    StandardProductBatchViewAdapterService,
    StandardProductBatchQualityAdapterService,
    StandardProductImportChangeAdapterService,
    StandardProductImageEmbeddingAdapterService,
    StandardProductModelTaggingAdapterService,
    StandardProductPersistenceAdapterService,
    StandardProductRawPayloadAdapterService,
    StandardProductImportAdapterService,
    StandardProductUpdateAdapterService,
    StandardProductViewAdapterService,
    StandardProductSearchResultAdapterService,
    StandardProductSearchSignalsAdapterService,
    StandardProductSourceTagAdapterService,
    StandardSearchQueryEmbeddingAdapterService,
    {
      provide: CANDIDATE_VISUAL_VERIFICATION_ADAPTER,
      useExisting: StandardCandidateVisualVerificationAdapterService,
    },
    {
      provide: PRODUCT_BATCH_VIEW_ADAPTER,
      useExisting: StandardProductBatchViewAdapterService,
    },
    {
      provide: PRODUCT_BATCH_QUALITY_ADAPTER,
      useExisting: StandardProductBatchQualityAdapterService,
    },
    {
      provide: PRODUCT_IMPORT_CHANGE_ADAPTER,
      useExisting: StandardProductImportChangeAdapterService,
    },
    {
      provide: PRODUCT_IMAGE_EMBEDDING_ADAPTER,
      useExisting: StandardProductImageEmbeddingAdapterService,
    },
    {
      provide: PRODUCT_IMAGE_CONTENT_ADAPTER,
      useExisting: StandardProductImageContentAdapterService,
    },
    {
      provide: PRODUCT_IMPORT_BATCH_STATE_ADAPTER,
      useExisting: StandardProductImportBatchStateAdapterService,
    },
    {
      provide: PRODUCT_MODEL_TAGGING_ADAPTER,
      useExisting: StandardProductModelTaggingAdapterService,
    },
    {
      provide: PRODUCT_PERSISTENCE_ADAPTER,
      useExisting: StandardProductPersistenceAdapterService,
    },
    {
      provide: PRODUCT_IMPORT_ADAPTER,
      useExisting: StandardProductImportAdapterService,
    },
    {
      provide: PRODUCT_RAW_PAYLOAD_ADAPTER,
      useExisting: StandardProductRawPayloadAdapterService,
    },
    {
      provide: PRODUCT_SEARCH_RESULT_ADAPTER,
      useExisting: StandardProductSearchResultAdapterService,
    },
    {
      provide: PRODUCT_SEARCH_SIGNALS_ADAPTER,
      useExisting: StandardProductSearchSignalsAdapterService,
    },
    {
      provide: PRODUCT_SOURCE_TAG_ADAPTER,
      useExisting: StandardProductSourceTagAdapterService,
    },
    {
      provide: SEARCH_QUERY_EMBEDDING_ADAPTER,
      useExisting: StandardSearchQueryEmbeddingAdapterService,
    },
    {
      provide: PRODUCT_UPDATE_ADAPTER,
      useExisting: StandardProductUpdateAdapterService,
    },
    {
      provide: PRODUCT_VIEW_ADAPTER,
      useExisting: StandardProductViewAdapterService,
    },
    {
      provide: EMBEDDING_PROVIDER,
      inject: [
        ConfigService,
        HashEmbeddingProviderService,
        VolcengineDoubaoEmbeddingProviderService,
        LocalGpuEmbeddingProviderService,
      ],
      useFactory: (
        config: ConfigService,
        hashProvider: HashEmbeddingProviderService,
        doubaoProvider: VolcengineDoubaoEmbeddingProviderService,
        localGpuProvider: LocalGpuEmbeddingProviderService,
      ): EmbeddingProvider => {
        const provider = config.get<string>('embedding.provider') ?? 'hash';
        const localWorkerEnabled = config.get<boolean>('embedding.localWorkerEnabled') === true;
        if (provider === 'local_gpu_worker') {
          return localWorkerEnabled ? localGpuProvider : doubaoProvider;
        }
        const allowMockProviders = config.get<boolean>('runtime.allowMockProviders') === true;
        if (provider === 'volcengine_doubao_vision') return doubaoProvider;
        if (provider === 'hash' && allowMockProviders) return hashProvider;
        if (provider === 'hash') {
          throw new Error('HASH_EMBEDDING_PROVIDER_DISABLED_OUTSIDE_DEV');
        }
        throw new Error(`UNSUPPORTED_EMBEDDING_PROVIDER:${provider}`);
      },
    },
    {
      provide: IMAGE_EMBEDDING_PREPROCESSOR,
      inject: [
        ConfigService,
        NoopImageEmbeddingPreprocessorService,
        LocalGpuImagePreprocessorService,
      ],
      useFactory: (
        config: ConfigService,
        noopPreprocessor: NoopImageEmbeddingPreprocessorService,
        localGpuPreprocessor: LocalGpuImagePreprocessorService,
      ): ImageEmbeddingPreprocessor => {
        const preprocessor = config.get<string>('embedding.imagePreprocessor') ?? 'none';
        const localWorkerEnabled = config.get<boolean>('embedding.localWorkerEnabled') === true;
        if (preprocessor === 'local_gpu_worker') {
          return localWorkerEnabled ? localGpuPreprocessor : noopPreprocessor;
        }
        if (preprocessor === 'none') return noopPreprocessor;
        throw new Error(`UNSUPPORTED_IMAGE_EMBEDDING_PREPROCESSOR:${preprocessor}`);
      },
    },
    AnnSearchService,
    {
      provide: ANN_SEARCH_PORT,
      useExisting: AnnSearchService,
    },
    LocalProductSearchProviderService,
  ],
  exports: [
    ProductPoolService,
    CANDIDATE_VISUAL_VERIFICATION_ADAPTER,
    EMBEDDING_PROVIDER,
    IMAGE_EMBEDDING_PREPROCESSOR,
    PRODUCT_BATCH_VIEW_ADAPTER,
    PRODUCT_BATCH_QUALITY_ADAPTER,
    PRODUCT_IMAGE_CONTENT_ADAPTER,
    PRODUCT_IMAGE_EMBEDDING_ADAPTER,
    PRODUCT_IMPORT_BATCH_STATE_ADAPTER,
    PRODUCT_IMPORT_CHANGE_ADAPTER,
    PRODUCT_IMPORT_ADAPTER,
    PRODUCT_MODEL_TAGGING_ADAPTER,
    PRODUCT_PERSISTENCE_ADAPTER,
    PRODUCT_RAW_PAYLOAD_ADAPTER,
    PRODUCT_SEARCH_RESULT_ADAPTER,
    PRODUCT_SEARCH_SIGNALS_ADAPTER,
    PRODUCT_SOURCE_TAG_ADAPTER,
    SEARCH_QUERY_EMBEDDING_ADAPTER,
    PRODUCT_UPDATE_ADAPTER,
    PRODUCT_VIEW_ADAPTER,
    HashEmbeddingProviderService,
    AnnSearchService,
    ANN_SEARCH_PORT,
    LocalProductSearchProviderService,
  ],
})
export class ProductPoolModule {}
