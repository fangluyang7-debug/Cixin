import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import { StorageAdapter } from './storage-adapter.interface';
import { BUCKET_GROUPS } from './storage.constants';

@Injectable()
export class TencentCosStorageAdapterService implements StorageAdapter {
  constructor(private readonly config: ConfigService) {}

  async putImage(input: {
    assetId: string;
    assetGroupId: string;
    variantType: string;
    content?: Buffer;
    contentType?: string;
    originalFilename?: string;
    objectKeyPrefix?: string;
  }) {
    const bucketGroup = this.resolveBucketGroup(input.variantType);
    const bucketName = this.resolveBucketName(bucketGroup);
    const region = this.config.get<string>('objectStorage.region') ?? null;
    const objectKey = this.buildObjectKey(input);

    if (input.content) {
      await this.putObject({
        bucketName,
        region,
        objectKey,
        content: input.content,
        contentType: input.contentType,
      });
    }

    return {
      provider: 'tencent_cos',
      bucketGroup,
      bucketName,
      region,
      objectKey,
      publicUrl: this.buildPublicUrl(bucketName, region, objectKey),
    };
  }

  async getSignedReadUrl(input: {
    bucketGroup: string;
    objectKey: string;
    expiresSeconds?: number;
  }) {
    const bucketName = this.resolveBucketName(input.bucketGroup);
    const region = this.config.get<string>('objectStorage.region') ?? null;
    const secretId = this.config.get<string>('objectStorage.secretId') ?? null;
    const secretKey = this.config.get<string>('objectStorage.secretKey') ?? null;

    if (!bucketName || !region || !secretId || !secretKey) return null;

    const host = `${bucketName}.cos.${region}.myqcloud.com`;
    const pathname = this.encodeObjectPath(input.objectKey);
    const authorization = this.buildAuthorization({
      method: 'get',
      pathname,
      host,
      secretId,
      secretKey,
      expiresSeconds: input.expiresSeconds ?? 900,
    });

    return `https://${host}${pathname}?${authorization}`;
  }

  private resolveBucketGroup(variantType: string) {
    if (variantType === 'original_source') return BUCKET_GROUPS.originalSource;
    if (variantType === 'demo_asset') return BUCKET_GROUPS.demoAssets;
    return BUCKET_GROUPS.compressedRecognition;
  }

  private resolveBucketName(bucketGroup: string): string | null {
    if (bucketGroup === BUCKET_GROUPS.originalSource) {
      return this.config.get<string>('objectStorage.buckets.originalSource') ?? null;
    }
    if (bucketGroup === BUCKET_GROUPS.demoAssets) {
      return this.config.get<string>('objectStorage.buckets.demoAssets') ?? null;
    }
    return this.config.get<string>('objectStorage.buckets.compressedRecognition') ?? null;
  }

  private buildObjectKey(input: {
    assetId: string;
    assetGroupId: string;
    contentType?: string;
    originalFilename?: string;
    objectKeyPrefix?: string;
  }) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const prefix = input.objectKeyPrefix
      ? input.objectKeyPrefix.replace(/^\/+|\/+$/g, '')
      : 'pending-session';
    return `${yyyy}/${mm}/${dd}/${prefix}/${input.assetGroupId}/${input.assetId}${this.resolveExtension(
      input,
    )}`;
  }

  private buildPublicUrl(bucketName: string | null, region: string | null, objectKey: string) {
    if (!bucketName || !region) return null;
    return `https://${bucketName}.cos.${region}.myqcloud.com/${objectKey}`;
  }

  private resolveExtension(input: { contentType?: string; originalFilename?: string }) {
    if (input.contentType === 'image/png') return '.png';
    if (input.contentType === 'image/webp') return '.webp';
    if (input.originalFilename?.includes('.')) {
      return input.originalFilename.slice(input.originalFilename.lastIndexOf('.'));
    }
    return '.jpg';
  }

  private async putObject(input: {
    bucketName: string | null;
    region: string | null;
    objectKey: string;
    content: Buffer;
    contentType?: string;
  }) {
    const secretId = this.config.get<string>('objectStorage.secretId') ?? null;
    const secretKey = this.config.get<string>('objectStorage.secretKey') ?? null;

    if (!input.bucketName || !input.region || !secretId || !secretKey) {
      throw new InternalServerErrorException('OBJECT_STORAGE_CONFIG_MISSING');
    }

    const host = `${input.bucketName}.cos.${input.region}.myqcloud.com`;
    const pathname = this.encodeObjectPath(input.objectKey);
    const body = input.content.buffer.slice(
      input.content.byteOffset,
      input.content.byteOffset + input.content.byteLength,
    ) as ArrayBuffer;
    const authorization = this.buildAuthorization({
      method: 'put',
      pathname,
      host,
      secretId,
      secretKey,
    });

    const response = await fetch(`https://${host}${pathname}`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': input.contentType ?? 'application/octet-stream',
      },
      body,
    });

    if (!response.ok) {
      throw new InternalServerErrorException('IMAGE_UPLOAD_FAILED');
    }
  }

  private buildAuthorization(input: {
    method: 'put' | 'get';
    pathname: string;
    host: string;
    secretId: string;
    secretKey: string;
    expiresSeconds?: number;
  }) {
    const start = Math.floor(Date.now() / 1000) - 60;
    const end = start + (input.expiresSeconds ?? 600);
    const keyTime = `${start};${end}`;
    const signKey = this.hmacSha1(input.secretKey, keyTime);
    const httpString = `${input.method}\n${input.pathname}\n\nhost=${input.host.toLowerCase()}\n`;
    const stringToSign = `sha1\n${keyTime}\n${this.sha1(httpString)}\n`;
    const signature = this.hmacSha1(signKey, stringToSign);

    return [
      'q-sign-algorithm=sha1',
      `q-ak=${input.secretId}`,
      `q-sign-time=${keyTime}`,
      `q-key-time=${keyTime}`,
      'q-header-list=host',
      'q-url-param-list=',
      `q-signature=${signature}`,
    ].join('&');
  }

  private encodeObjectPath(objectKey: string) {
    return `/${objectKey
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')}`;
  }

  private sha1(value: string) {
    return createHash('sha1').update(value).digest('hex');
  }

  private hmacSha1(key: string, value: string) {
    return createHmac('sha1', key).update(value).digest('hex');
  }
}
