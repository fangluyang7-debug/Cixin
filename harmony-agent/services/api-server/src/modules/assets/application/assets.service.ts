import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { createId } from '../../../common/utils/id';
import { CreateImageAssetDto } from '../dto/create-image-asset.dto';
import { UploadedImageFile } from '../dto/uploaded-image-file';
import { StorageAdapter } from '../../../adapters/storage/storage-adapter.interface';
import { OBJECT_STORAGE_ADAPTER } from '../../../adapters/storage/storage.constants';
import {
  IMAGE_ASSET_ADAPTER,
  ImageAssetAdapter,
} from './image-asset-adapter.interface';

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE_ADAPTER)
    private readonly storage: StorageAdapter,
    @Inject(IMAGE_ASSET_ADAPTER)
    private readonly imageAssetAdapter: ImageAssetAdapter,
  ) {}

  async createImageAsset(dto: CreateImageAssetDto, file?: UploadedImageFile, ownerUserId?: string) {
    const input = this.imageAssetAdapter.normalizeCreateInput(dto, file);

    const assetId = createId('asset');
    const assetGroupId = input.assetGroupId ?? createId('asset_group');
    const variantType = input.variantType;
    const storedRef = await this.storage.putImage({
      assetId,
      assetGroupId,
      variantType,
      content: input.file?.buffer,
      contentType: input.file?.contentType,
      originalFilename: input.file?.originalFilename,
    });

    const asset = await this.prisma.imageAsset.create({
      data: {
        id: assetId,
        ownerUserId,
        assetGroupId,
        variantType,
        isPrimaryRecognitionAsset: input.isPrimaryRecognitionAsset ?? variantType === 'compressed_recognition',
        sourceType: input.sourceType,
        bucketGroup: storedRef.bucketGroup,
        objectKey: storedRef.objectKey,
        uploadStatus: input.file ? 'uploaded' : 'registered',
      },
    });

    const signedReadUrl = await this.createSignedReadUrl({
      uploadStatus: asset.uploadStatus,
      bucketGroup: asset.bucketGroup,
      objectKey: asset.objectKey,
    });

    return {
      assetId: asset.id,
      assetGroupId: asset.assetGroupId,
      variantType: asset.variantType,
      isPrimaryRecognitionAsset: asset.isPrimaryRecognitionAsset,
      uploadStatus: asset.uploadStatus,
      imageRef: {
        assetId: asset.id,
        provider: storedRef.provider,
        bucketGroup: asset.bucketGroup,
        bucketName: storedRef.bucketName,
        region: storedRef.region,
        objectKey: asset.objectKey,
        publicUrl: storedRef.publicUrl,
        signedReadUrl,
        signedReadUrlExpiresSeconds: signedReadUrl ? 900 : null,
      },
      fileMeta: input.file
        ? {
            originalName: input.file.originalFilename,
            contentType: input.file.contentType,
            size: input.file.sizeBytes,
          }
        : null,
    };
  }

  private async createSignedReadUrl(input: {
    uploadStatus: string;
    bucketGroup: string;
    objectKey: string;
  }) {
    if (input.uploadStatus !== 'uploaded') return null;
    return (await this.storage.getSignedReadUrl?.({
      bucketGroup: input.bucketGroup,
      objectKey: input.objectKey,
      expiresSeconds: 900,
    })) ?? null;
  }
}
