import { BadRequestException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImageAsset, QueryImagePreprocessSnapshot } from '@prisma/client';
import { OBJECT_STORAGE_ADAPTER } from '../../../adapters/storage/storage.constants';
import { StorageAdapter, StoredImageRef } from '../../../adapters/storage/storage-adapter.interface';
import { createId } from '../../../common/utils/id';
import { fromJson, toJsonString } from '../../../common/utils/json';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { EMBEDDING_PROVIDER } from '../../product-pool/application/embedding.constants';
import { EmbeddingProvider, EmbeddingResult } from '../../product-pool/application/embedding-provider.interface';
import { ProductProfileResult } from '../../../adapters/model/model-adapter.interface';
import {
  normalizeProductCategoryOrNull,
  ProductCategoryKey,
} from '../../../common/catalog/product-categories';
import { NormalizedSubjectBoxDto } from '../dto/subject-selection.dto';
import {
  NormalizedSubjectBox,
  QUERY_IMAGE_PREPROCESS_ADAPTER,
  QueryImagePreprocessAdapter,
} from './query-image-preprocess-adapter.interface';
import {
  QUERY_IMAGE_CONTENT_ADAPTER,
  QueryImageContentAdapter,
} from './query-image-content-adapter.interface';

interface CropAndEmbedResult {
  embedding: EmbeddingResult;
  queryImageUrl: string;
  cropImageRef: Record<string, unknown>;
  localSubjectDetectionImageUrl: string;
  raw: Record<string, unknown>;
}

interface CropReadyEvent {
  queryImageUrl: string;
  cropImageRef: Record<string, unknown>;
  selectedBox: NormalizedSubjectBox;
  localCategory: {
    category: ProductCategoryKey;
    confidence: number;
    detectedClass: string;
  } | null;
  preprocess: {
    strategy: string;
    usedOriginalImage: boolean;
    metadata: Record<string, unknown>;
  };
}

type CropReadyCallback = (event: CropReadyEvent) => void;

@Injectable()
export class QueryImagePreprocessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(OBJECT_STORAGE_ADAPTER)
    private readonly storage: StorageAdapter,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
    @Inject(QUERY_IMAGE_PREPROCESS_ADAPTER)
    private readonly preprocessAdapter: QueryImagePreprocessAdapter,
    @Inject(QUERY_IMAGE_CONTENT_ADAPTER)
    private readonly queryImageContentAdapter: QueryImageContentAdapter,
  ) {}

  async createInitial(input: {
    sessionId: string;
    asset: ImageAsset;
    profile: ProductProfileResult;
    embeddingKind?: 'visual' | 'multimodal';
    onCropReady?: CropReadyCallback;
  }) {
    const detection = this.preprocessAdapter.extractSubjectDetection(input.profile.raw);
    const detectedBoxes = detection.detectedBoxes;
    const selectedBox = detection.selectedBox;
    const detectionStatus = this.toString(detection.status);
    const confidence = selectedBox?.confidence ?? null;

    if (
      !selectedBox ||
      detectionStatus === 'needs_user_selection' ||
      (confidence !== null && confidence < this.minConfidence())
    ) {
      const metadata = await this.safeImageMetadata(input.asset);
      const snapshot = await this.prisma.queryImagePreprocessSnapshot.create({
        data: {
          id: createId('query_pre'),
          sessionId: input.sessionId,
          assetId: input.asset.id,
          selectedBoxJson: '{}',
          detectedBoxesJson: toJsonString(detectedBoxes),
          selectionSource: 'auto',
          status: 'needs_user_selection',
          imageWidth: metadata.width ?? this.toInteger(detection.imageWidth),
          imageHeight: metadata.height ?? this.toInteger(detection.imageHeight),
          rawJson: toJsonString({
            reason: !selectedBox
              ? 'NO_VALID_SUBJECT_BOX'
              : detectionStatus === 'needs_user_selection'
                ? 'MODEL_REQUESTED_USER_SELECTION'
                : 'LOW_SUBJECT_DETECTION_CONFIDENCE',
            subjectDetection: detection.raw,
          }),
        },
      });
      return {
        snapshot,
        formatted: this.preprocessAdapter.formatSnapshot(snapshot),
        queryEmbedding: null as number[] | null,
        queryImageUrl: null as string | null,
      };
    }

    return this.createEmbeddedSnapshot({
      sessionId: input.sessionId,
      asset: input.asset,
      selectedBox,
      detectedBoxes,
      selectionSource: 'auto',
      profile: input.profile,
      embeddingKind: input.embeddingKind,
      onCropReady: input.onCropReady,
      raw: {
        subjectDetection: detection.raw,
      },
    });
  }

  async createUserSelection(input: {
    sessionId: string;
    asset: ImageAsset;
    box: NormalizedSubjectBoxDto;
    selectionSource?: string;
    profile: ProductProfileResult | null;
    embeddingKind?: 'visual' | 'multimodal';
    onCropReady?: CropReadyCallback;
  }) {
    const selectedBox = this.preprocessAdapter.normalizeUserSelectionBox(input.box);
    if (!selectedBox) {
      throw new BadRequestException('INVALID_SUBJECT_SELECTION_BOX');
    }

    return this.createEmbeddedSnapshot({
      sessionId: input.sessionId,
      asset: input.asset,
      selectedBox,
      detectedBoxes: [selectedBox],
      selectionSource: input.selectionSource ?? 'user_adjusted',
      profile: input.profile,
      embeddingKind: input.embeddingKind,
      onCropReady: input.onCropReady,
      raw: {
        userSelection: input.box,
      },
    });
  }

  async getLatestFormatted(sessionId: string) {
    const snapshot = await this.prisma.queryImagePreprocessSnapshot.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
    return snapshot ? this.preprocessAdapter.formatSnapshot(snapshot) : null;
  }

  private async createEmbeddedSnapshot(input: {
    sessionId: string;
    asset: ImageAsset;
    selectedBox: NormalizedSubjectBox;
    detectedBoxes: NormalizedSubjectBox[];
    selectionSource: string;
    profile: ProductProfileResult | null;
    embeddingKind?: 'visual' | 'multimodal';
    onCropReady?: CropReadyCallback;
    raw: Record<string, unknown>;
  }) {
    const crop = await this.cropAndEmbed(
      input.asset,
      input.selectedBox,
      input.profile,
      input.onCropReady,
      input.embeddingKind,
    );
    const metadata = this.asRecord(crop.raw.imageMetadata);
    const snapshot = await this.prisma.queryImagePreprocessSnapshot.create({
      data: {
        id: createId('query_pre'),
        sessionId: input.sessionId,
        assetId: input.asset.id,
        selectedBoxJson: toJsonString(input.selectedBox),
        detectedBoxesJson: toJsonString(input.detectedBoxes),
        selectionSource: input.selectionSource,
        status: 'ready',
        imageWidth: this.toInteger(metadata.width),
        imageHeight: this.toInteger(metadata.height),
        embeddingProvider: crop.embedding.provider,
        embeddingModel: crop.embedding.modelName,
        embeddingDimension: crop.embedding.dimension,
        embeddingVectorHash: crop.embedding.vectorHash,
        embeddingVectorJson: toJsonString(crop.embedding.vector),
        cropImageRefJson: toJsonString(crop.cropImageRef),
        rawJson: toJsonString({
          ...input.raw,
          crop: crop.raw,
        }),
      },
    });

    return {
      snapshot,
      formatted: this.preprocessAdapter.formatSnapshot(snapshot),
      queryEmbedding: crop.embedding.vector,
      queryImageUrl: crop.queryImageUrl,
      localSubjectDetectionImageUrl: crop.localSubjectDetectionImageUrl,
    };
  }

  private async cropAndEmbed(
    asset: ImageAsset,
    box: NormalizedSubjectBox,
    profile: ProductProfileResult | null,
    onCropReady?: CropReadyCallback,
    embeddingKindOverride?: 'visual' | 'multimodal',
  ): Promise<CropAndEmbedResult> {
    const signedUrl = await this.storage.getSignedReadUrl?.({
      bucketGroup: asset.bucketGroup,
      objectKey: asset.objectKey,
      expiresSeconds: 900,
    });
    if (!signedUrl || signedUrl.startsWith('mock://')) {
      throw new InternalServerErrorException('QUERY_IMAGE_SIGNED_URL_UNAVAILABLE');
    }

    const crop = await this.queryImageContentAdapter.cropForEmbedding({
      signedUrl,
      box,
      paddingRatio: this.paddingRatio(),
      targetSize: this.targetSize(),
      jpegQuality: this.jpegQuality(),
    });

    const cropBase64 = crop.buffer.toString('base64');
    const cropDataUrl = this.dataUrl(cropBase64, 'image/jpeg');
    const userCrop = this.storeCropInObjectStorage()
      ? await this.storeCropImage(asset, crop.buffer)
      : {
          url: cropDataUrl,
          imageRef: this.inlineImageRef(cropDataUrl, crop.buffer.length),
        };
    const userCropUrl = userCrop.url;
    const userCropImageRef = userCrop.imageRef;
    const preprocessed = {
      embeddingImageUrl: userCropUrl,
      strategy: 'query_crop_direct',
      usedOriginalImage: false,
      metadata: {
        role: 'query',
        directEmbedding: true,
        contentType: 'image/jpeg',
        sizeBytes: crop.buffer.length,
        targetSize: this.targetSize(),
        jpegQuality: this.jpegQuality(),
      },
    };
    const localCategory = this.localCategoryFromPreprocess(preprocessed.metadata);
    onCropReady?.({
      queryImageUrl: userCropUrl,
      cropImageRef: userCropImageRef,
      selectedBox: box,
      localCategory,
      preprocess: {
        strategy: preprocessed.strategy,
        usedOriginalImage: preprocessed.usedOriginalImage,
        metadata: preprocessed.metadata,
      },
    });

    const embeddingKind = embeddingKindOverride ?? this.queryEmbeddingKind();
    const embedding = await this.embeddingProvider.embedImage({
      imageBase64: cropBase64,
      imageContentType: 'image/jpeg',
      textHint: embeddingKind === 'visual' ? undefined : this.buildTextHint(profile),
      tags: {
        role: 'query',
        embeddingKind,
        subjectSelection: box,
        preprocessStrategy: crop.strategy,
        localSubjectDetection: {
          strategy: preprocessed.strategy,
          usedOriginalImage: preprocessed.usedOriginalImage,
          metadata: preprocessed.metadata,
        },
      },
    });

    return {
      embedding,
      queryImageUrl: userCropUrl,
      cropImageRef: userCropImageRef,
      localSubjectDetectionImageUrl: preprocessed.embeddingImageUrl,
      raw: {
        strategy: crop.strategy,
        embeddingKind,
        textHintUsed: embeddingKind !== 'visual',
        paddingRatio: this.paddingRatio(),
        imageMetadata: crop.metadata,
        cropRegionPx: crop.cropRegionPx,
        selectedBoxNorm: box,
        localCategory,
        userCrop: {
          strategy: crop.strategy,
          imageRef: this.rawImageRef(userCropImageRef),
          sizeBytes: crop.buffer.length,
          directEmbedding: true,
        },
        localSubjectDetection: {
          strategy: preprocessed.strategy,
          usedOriginalImage: preprocessed.usedOriginalImage,
          metadata: preprocessed.metadata,
        },
      },
    };
  }

  async getCropImageUrl(
    snapshot: Pick<QueryImagePreprocessSnapshot, 'cropImageRefJson'>,
  ) {
    const cropImageRef = fromJson<Record<string, unknown>>(
      snapshot.cropImageRefJson,
      {},
    );
    const bucketGroup = this.toString(cropImageRef.bucketGroup);
    const objectKey = this.toString(cropImageRef.objectKey);
    if (!bucketGroup || !objectKey) {
      return this.toString(cropImageRef.publicUrl);
    }
    const signedUrl = await this.storage.getSignedReadUrl?.({
      bucketGroup,
      objectKey,
      expiresSeconds: 900,
    });
    return signedUrl && !signedUrl.startsWith('mock://')
      ? signedUrl
      : this.toString(cropImageRef.publicUrl);
  }

  private async readUrlForStoredRef(stored: StoredImageRef) {
    const signedUrl = await this.storage.getSignedReadUrl?.({
      bucketGroup: stored.bucketGroup,
      objectKey: stored.objectKey,
      expiresSeconds: 900,
    });
    const url = signedUrl && !signedUrl.startsWith('mock://') ? signedUrl : stored.publicUrl;
    if (!url) {
      throw new InternalServerErrorException('QUERY_IMAGE_CROP_URL_UNAVAILABLE');
    }
    return url;
  }

  private async storeCropImage(asset: ImageAsset, content: Buffer) {
    const stored = await this.storage.putImage({
      assetId: createId('query_crop_asset'),
      assetGroupId: asset.assetGroupId,
      variantType: 'demo_asset',
      content,
      contentType: 'image/jpeg',
      originalFilename: 'query-subject-crop.jpg',
      objectKeyPrefix: 'embedding-inputs/queries',
    });
    return {
      url: await this.readUrlForStoredRef(stored),
      imageRef: this.storedRefToJson(stored),
    };
  }

  private dataUrl(base64: string, contentType: string) {
    return `data:${contentType};base64,${base64}`;
  }

  private inlineImageRef(publicUrl: string, sizeBytes: number) {
    return {
      provider: 'inline_data_url',
      bucketGroup: null,
      bucketName: null,
      region: null,
      objectKey: null,
      publicUrl,
      contentType: 'image/jpeg',
      sizeBytes,
    };
  }

  private rawImageRef(ref: Record<string, unknown>) {
    if (this.toString(ref.provider) !== 'inline_data_url') return ref;
    return {
      provider: 'inline_data_url',
      contentType: this.toString(ref.contentType) ?? 'image/jpeg',
      sizeBytes: this.toInteger(ref.sizeBytes),
    };
  }

  private async safeImageMetadata(asset: ImageAsset) {
    try {
      const signedUrl = await this.storage.getSignedReadUrl?.({
        bucketGroup: asset.bucketGroup,
        objectKey: asset.objectKey,
        expiresSeconds: 900,
      });
      if (!signedUrl || signedUrl.startsWith('mock://')) return {};
      return await this.queryImageContentAdapter.readMetadata(signedUrl);
    } catch {
      return {};
    }
  }

  private buildTextHint(profile: ProductProfileResult | null) {
    if (!profile) return 'product query image';
    return [
      profile.category,
      profile.brand,
      profile.modelLine,
      profile.colorFamily,
      profile.colorway,
      profile.shoeType,
      profile.color,
      ...profile.keywords,
    ]
      .filter(Boolean)
      .join(' ');
  }

  private queryEmbeddingKind(): 'visual' | 'multimodal' {
    const configured = this.config.get<string>('embedding.queryEmbeddingKind');
    return configured === 'multimodal' ? 'multimodal' : 'visual';
  }

  private storedRefToJson(stored: StoredImageRef) {
    return {
      provider: stored.provider,
      bucketGroup: stored.bucketGroup,
      bucketName: stored.bucketName ?? null,
      region: stored.region ?? null,
      objectKey: stored.objectKey,
      publicUrl: stored.publicUrl ?? null,
    };
  }

  private paddingRatio() {
    return Number(this.config.get<number>('queryImagePreprocess.paddingRatio') ?? 0.12);
  }

  private targetSize() {
    const configured = Number(
      this.config.get<number>('queryImagePreprocess.targetSize') ?? 320,
    );
    if (!Number.isFinite(configured)) return 320;
    return Math.min(512, Math.max(224, Math.floor(configured)));
  }

  private jpegQuality() {
    const configured = Number(
      this.config.get<number>('queryImagePreprocess.jpegQuality') ?? 82,
    );
    if (!Number.isFinite(configured)) return 82;
    return Math.min(95, Math.max(40, Math.floor(configured)));
  }

  private storeCropInObjectStorage() {
    return this.config.get<boolean>('queryImagePreprocess.storeCropInObjectStorage') === true;
  }

  private minConfidence() {
    return Number(this.config.get<number>('queryImagePreprocess.minConfidence') ?? 0.2);
  }

  private localCategoryMinConfidence() {
    return Number(
      this.config.get<number>(
        'queryImagePreprocess.localCategoryMinConfidence',
      ) ?? 0.04,
    );
  }

  private localCategoryFromPreprocess(metadata: Record<string, unknown>) {
    const detectedClass = this.toString(metadata.selectedClass);
    const confidence = this.toNumber(metadata.confidence);
    const category = normalizeProductCategoryOrNull(detectedClass);
    if (
      !detectedClass ||
      !category ||
      confidence === null ||
      confidence < this.localCategoryMinConfidence()
    ) {
      return null;
    }
    return {
      category,
      confidence,
      detectedClass,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toInteger(value: unknown) {
    const number = this.toNumber(value);
    return number === null ? null : Math.round(number);
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

}
