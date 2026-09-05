import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { createId } from '../../../common/utils/id';
import { StorageAdapter } from '../../../adapters/storage/storage-adapter.interface';
import { OBJECT_STORAGE_ADAPTER } from '../../../adapters/storage/storage.constants';
import {
  ImageEmbeddingPreprocessInput,
  ImageEmbeddingPreprocessResult,
  ImageEmbeddingPreprocessor,
} from './image-embedding-preprocessor.interface';
import { LocalImageWorkerClientService } from './local-image-worker-client.service';

export interface ExtractSubjectResponse {
  strategy: string;
  usedOriginalImage: boolean;
  confidence: number;
  bboxPx: number[] | null;
  bboxNorm: number[] | null;
  imageWidth: number;
  imageHeight: number;
  croppedImageBase64: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

export interface ExtractSubjectDebugOptions {
  detectionClasses?: string[] | string | null;
  detectionConf?: number | null;
  cropPadding?: number | null;
  squarePadColor?: number[] | null;
  manualBboxNorm?: number[] | null;
  outputSize?: number | null;
  jpegQuality?: number | null;
}

@Injectable()
export class LocalGpuImagePreprocessorService implements ImageEmbeddingPreprocessor {
  constructor(
    private readonly worker: LocalImageWorkerClientService,
    @Inject(OBJECT_STORAGE_ADAPTER)
    private readonly storage: StorageAdapter,
  ) {}

  async preprocess(input: ImageEmbeddingPreprocessInput): Promise<ImageEmbeddingPreprocessResult> {
    const result = await this.worker.post<ExtractSubjectResponse>('/v1/images/extract-subject', {
      imageUrl: input.imageUrl,
      role: input.role,
      productId: input.productId ?? null,
      styleId: input.styleId ?? null,
      tags: input.tags ?? {},
    });

    if (!result.croppedImageBase64) {
      throw new InternalServerErrorException('LOCAL_IMAGE_WORKER_EMPTY_PREPROCESS_IMAGE');
    }

    const content = Buffer.from(result.croppedImageBase64, 'base64');
    const stored = await this.storage.putImage({
      assetId: createId('embedding_asset'),
      assetGroupId: input.productId ?? createId('embedding_group'),
      variantType: 'demo_asset',
      content,
      contentType: result.contentType ?? 'image/jpeg',
      originalFilename: `${input.role}.jpg`,
      objectKeyPrefix: this.objectKeyPrefix(input),
    });
    const signedUrl = await this.storage.getSignedReadUrl?.({
      bucketGroup: stored.bucketGroup,
      objectKey: stored.objectKey,
      expiresSeconds: 900,
    });

    const embeddingImageUrl = signedUrl && !signedUrl.startsWith('mock://')
      ? signedUrl
      : stored.publicUrl;
    if (!embeddingImageUrl) {
      throw new InternalServerErrorException('LOCAL_IMAGE_PREPROCESS_UPLOAD_URL_UNAVAILABLE');
    }

    return {
      embeddingImageUrl,
      strategy: result.strategy,
      usedOriginalImage: result.usedOriginalImage,
      metadata: {
        ...result.metadata,
        bboxPx: result.bboxPx,
        bboxNorm: result.bboxNorm,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        confidence: result.confidence,
        preprocessedImageRef: {
          provider: stored.provider,
          bucketGroup: stored.bucketGroup,
          bucketName: stored.bucketName ?? null,
          region: stored.region ?? null,
          objectKey: stored.objectKey,
          publicUrl: stored.publicUrl ?? null,
        },
      },
    };
  }

  async previewSubject(input: {
    imageUrl?: string | null;
    imageBase64?: string | null;
    localImagePath?: string | null;
    role?: ImageEmbeddingPreprocessInput['role'];
    productId?: string | null;
    styleId?: string | null;
    tags?: Record<string, unknown>;
    debugOptions?: ExtractSubjectDebugOptions | null;
  }): Promise<ExtractSubjectResponse> {
    return this.worker.post<ExtractSubjectResponse>('/v1/images/extract-subject', {
      imageUrl: input.imageUrl ?? null,
      imageBase64: input.imageBase64 ?? null,
      localImagePath: input.localImagePath ?? null,
      role: input.role ?? 'product_main',
      productId: input.productId ?? null,
      styleId: input.styleId ?? null,
      tags: input.tags ?? {},
      debugOptions: input.debugOptions ?? null,
    });
  }

  private objectKeyPrefix(input: ImageEmbeddingPreprocessInput) {
    if (input.role === 'query') return 'embedding-inputs/queries';
    if (input.role === 'product_style') return 'embedding-inputs/products/styles';
    return 'embedding-inputs/products/main';
  }
}
