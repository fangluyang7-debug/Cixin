export interface StoredImageRef {
  provider: string;
  bucketGroup: string;
  bucketName?: string | null;
  region?: string | null;
  objectKey: string;
  publicUrl?: string | null;
}

export interface StorageAdapter {
  putImage(input: {
    assetId: string;
    assetGroupId: string;
    variantType: string;
    content?: Buffer;
    contentType?: string;
    originalFilename?: string;
    objectKeyPrefix?: string;
  }): Promise<StoredImageRef>;

  getSignedReadUrl?(input: {
    bucketGroup: string;
    objectKey: string;
    expiresSeconds?: number;
  }): Promise<string | null>;
}
