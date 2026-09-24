import { InternalServerErrorException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import sharp = require('sharp');
import {
  QueryImageContentAdapter,
  QueryImageCropResult,
  QueryImageMetadata,
} from './query-image-content-adapter.interface';
import { NormalizedSubjectBox } from './query-image-preprocess-adapter.interface';

@Injectable()
export class StandardQueryImageContentAdapterService implements QueryImageContentAdapter {
  async readMetadata(signedUrl: string): Promise<QueryImageMetadata> {
    const buffer = await this.fetchImageBuffer(signedUrl);
    const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
    return { width: metadata.width, height: metadata.height, format: metadata.format ?? null };
  }

  async cropForEmbedding(input: {
    signedUrl: string;
    box: NormalizedSubjectBox;
    paddingRatio: number;
    targetSize: number;
    jpegQuality: number;
  }): Promise<QueryImageCropResult> {
    const imageBuffer = await this.fetchImageBuffer(input.signedUrl);
    const image = sharp(imageBuffer, { failOn: 'none' });
    const metadata = await image.metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) {
      throw new InternalServerErrorException('QUERY_IMAGE_DIMENSION_UNAVAILABLE');
    }

    const cropRegion = this.toSquareCropRegion(input.box, width, height, input.paddingRatio);
    const cropBuffer = await sharp(imageBuffer, { failOn: 'none' })
      .extract(cropRegion)
      .resize({
        width: input.targetSize,
        height: input.targetSize,
        fit: 'contain',
        background: { r: 245, g: 245, b: 245, alpha: 1 },
      })
      .jpeg({ quality: this.clampInteger(input.jpegQuality, 40, 95), mozjpeg: true })
      .toBuffer();

    return {
      buffer: cropBuffer,
      metadata: { width, height, format: metadata.format ?? null },
      cropRegionPx: cropRegion,
      strategy: `bbox_square_pad_${input.targetSize}`,
    };
  }

  private async fetchImageBuffer(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new InternalServerErrorException('QUERY_IMAGE_FETCH_FAILED');
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private toSquareCropRegion(
    box: NormalizedSubjectBox,
    width: number,
    height: number,
    paddingRatio: number,
  ) {
    const rawLeft = box.x * width;
    const rawTop = box.y * height;
    const rawWidth = box.width * width;
    const rawHeight = box.height * height;
    const centerX = rawLeft + rawWidth / 2;
    const centerY = rawTop + rawHeight / 2;
    const side = Math.min(Math.max(rawWidth, rawHeight) * (1 + paddingRatio * 2), Math.max(width, height));
    const left = this.clamp(Math.round(centerX - side / 2), 0, width - 1);
    const top = this.clamp(Math.round(centerY - side / 2), 0, height - 1);
    const right = this.clamp(Math.round(centerX + side / 2), left + 1, width);
    const bottom = this.clamp(Math.round(centerY + side / 2), top + 1, height);
    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private clampInteger(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) return min;
    return Math.floor(this.clamp(value, min, max));
  }
}
