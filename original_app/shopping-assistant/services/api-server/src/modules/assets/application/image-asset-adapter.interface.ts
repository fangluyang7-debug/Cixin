import { ImageAssetInput } from '../../../core/contracts/image.contracts';
import { CreateImageAssetDto } from '../dto/create-image-asset.dto';
import { UploadedImageFile } from '../dto/uploaded-image-file';

export const IMAGE_ASSET_ADAPTER = Symbol('IMAGE_ASSET_ADAPTER');

export type NormalizedUploadedImageFile = {
  buffer: Buffer;
  contentType: string;
  originalFilename: string;
  sizeBytes: number;
};

export type NormalizedImageAssetUploadInput = ImageAssetInput & {
  file?: NormalizedUploadedImageFile;
};

export interface ImageAssetAdapter {
  normalizeCreateInput(
    dto: CreateImageAssetDto,
    file?: UploadedImageFile,
  ): NormalizedImageAssetUploadInput;
}
