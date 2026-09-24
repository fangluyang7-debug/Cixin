import { Module } from '@nestjs/common';
import { TencentCosStorageAdapterService } from '../../adapters/storage/tencent-cos-storage-adapter.service';
import { OBJECT_STORAGE_ADAPTER } from '../../adapters/storage/storage.constants';
import { AssetsService } from './application/assets.service';
import { IMAGE_ASSET_ADAPTER } from './application/image-asset-adapter.interface';
import { StandardImageAssetAdapterService } from './application/standard-image-asset-adapter.service';
import { AssetsController } from './controllers/assets.controller';

@Module({
  controllers: [AssetsController],
  providers: [
    AssetsService,
    StandardImageAssetAdapterService,
    TencentCosStorageAdapterService,
    {
      provide: IMAGE_ASSET_ADAPTER,
      useExisting: StandardImageAssetAdapterService,
    },
    {
      provide: OBJECT_STORAGE_ADAPTER,
      useFactory: (tencentCosStorage: TencentCosStorageAdapterService) => {
        if (process.env.OBJECT_STORAGE_PROVIDER === 'mock') {
          throw new Error('MOCK_STORAGE_PROVIDER_ARCHIVED');
        }
        return tencentCosStorage;
      },
      inject: [TencentCosStorageAdapterService],
    },
  ],
  exports: [AssetsService, IMAGE_ASSET_ADAPTER, OBJECT_STORAGE_ADAPTER],
})
export class AssetsModule {}
