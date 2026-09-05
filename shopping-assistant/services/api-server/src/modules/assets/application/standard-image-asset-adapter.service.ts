import { BadRequestException, Injectable } from '@nestjs/common';
import { ImageAssetVariant } from '../../../core/contracts/image.contracts';
import { CreateImageAssetDto } from '../dto/create-image-asset.dto';
import { UploadedImageFile } from '../dto/uploaded-image-file';
import {
  ImageAssetAdapter,
  NormalizedImageAssetUploadInput,
} from './image-asset-adapter.interface';

const ALLOWED_UPLOAD_VARIANTS: ImageAssetVariant[] = [
  'compressed_recognition',
  'original_source',
  'demo_asset',
];
const ALLOWED_SOURCE_TYPES = ['camera', 'album', 'demo'] as const;
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class StandardImageAssetAdapterService implements ImageAssetAdapter {
  normalizeCreateInput(
    dto: CreateImageAssetDto,
    file?: UploadedImageFile,
  ): NormalizedImageAssetUploadInput {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('IMAGE_ASSET_BODY_REQUIRED');
    }

    const variantType = this.normalizeVariantType(dto.variantType);
    const sourceType = this.normalizeSourceType(dto.sourceType);
    const normalizedFile = this.normalizeFile(file);

    return {
      assetGroupId: this.toOptionalString(dto.assetGroupId),
      variantType,
      sourceType,
      isPrimaryRecognitionAsset:
        this.normalizeBoolean(dto.isPrimaryRecognitionAsset) ?? variantType === 'compressed_recognition',
      fileName: normalizedFile?.originalFilename ?? null,
      mimeType: normalizedFile?.contentType ?? null,
      sizeBytes: normalizedFile?.sizeBytes ?? null,
      file: normalizedFile,
      rawPayload: {
        source: 'multipart_image_upload',
        clientContext: this.isRecord(dto.clientContext) ? dto.clientContext : null,
      },
    };
  }

  private normalizeVariantType(value: unknown): ImageAssetVariant {
    const variant = typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : 'compressed_recognition';
    if (!ALLOWED_UPLOAD_VARIANTS.includes(variant as ImageAssetVariant)) {
      throw new BadRequestException('INVALID_IMAGE_VARIANT_TYPE');
    }
    return variant as ImageAssetVariant;
  }

  private normalizeSourceType(value: unknown) {
    const sourceType = typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : 'camera';
    if (!ALLOWED_SOURCE_TYPES.includes(sourceType as typeof ALLOWED_SOURCE_TYPES[number])) {
      throw new BadRequestException('INVALID_IMAGE_SOURCE_TYPE');
    }
    return sourceType;
  }

  private normalizeFile(file?: UploadedImageFile) {
    if (!file) return undefined;
    if (!ALLOWED_CONTENT_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('IMAGE_FORMAT_UNSUPPORTED');
    }
    return {
      buffer: file.buffer,
      contentType: file.mimetype,
      originalFilename: file.originalname,
      sizeBytes: file.size,
    };
  }

  private normalizeBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new BadRequestException('INVALID_BOOLEAN_FIELD');
  }

  private toOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
