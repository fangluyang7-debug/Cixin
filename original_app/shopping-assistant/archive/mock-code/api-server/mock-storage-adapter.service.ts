import { Injectable } from '@nestjs/common';
import { StorageAdapter } from './storage-adapter.interface';
import { BUCKET_GROUPS } from './storage.constants';

@Injectable()
export class MockStorageAdapterService implements StorageAdapter {
  async putImage(input: {
    assetId: string;
    assetGroupId: string;
    variantType: string;
    content?: Buffer;
    contentType?: string;
    originalFilename?: string;
    objectKeyPrefix?: string;
  }) {
    const bucketGroup =
      input.variantType === 'original_source'
        ? BUCKET_GROUPS.originalSource
        : input.variantType === 'demo_asset'
          ? BUCKET_GROUPS.demoAssets
        : BUCKET_GROUPS.compressedRecognition;
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const prefix = input.objectKeyPrefix
      ? input.objectKeyPrefix.replace(/^\/+|\/+$/g, '')
      : 'pending-session';

    return {
      provider: 'mock',
      bucketGroup,
      bucketName: null,
      region: null,
      objectKey: `${yyyy}/${mm}/${dd}/${prefix}/${input.assetGroupId}/${input.assetId}${this.resolveExtension(
        input,
      )}`,
      publicUrl: null,
    };
  }

  async getSignedReadUrl(input: { bucketGroup: string; objectKey: string }) {
    return `mock://${input.bucketGroup}/${input.objectKey}`;
  }

  private resolveExtension(input: { contentType?: string; originalFilename?: string }) {
    if (input.contentType === 'image/png') return '.png';
    if (input.contentType === 'image/webp') return '.webp';
    if (input.originalFilename?.includes('.')) {
      return input.originalFilename.slice(input.originalFilename.lastIndexOf('.'));
    }
    return '.jpg';
  }
}
