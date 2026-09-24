import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import sharp = require('sharp');
import {
  ProductImageContent,
  ProductImageContentAdapter,
  ProductImageContentInput,
} from './product-image-content-adapter.interface';

@Injectable()
export class StandardProductImageContentAdapterService
  implements ProductImageContentAdapter
{
  constructor(private readonly config: ConfigService) {}

  async loadImageContent(
    input: ProductImageContentInput,
  ): Promise<ProductImageContent | null> {
    let content: ProductImageContent | null = null;

    if (input.imageDataBase64) {
      content = {
        buffer: Buffer.from(input.imageDataBase64, 'base64'),
        contentType: input.contentType ?? 'image/jpeg',
        filename: input.filename,
      };
      return this.standardizeImageContent(content);
    }

    if (input.localImagePath) {
      content = {
        buffer: await readFile(input.localImagePath),
        contentType: input.contentType ?? 'image/jpeg',
        filename: input.localImagePath.split(/[\\/]/).pop() ?? input.filename,
      };
      return this.standardizeImageContent(content);
    }

    if (!input.imageUrl) return null;
    content = await this.loadRemoteImage({ ...input, imageUrl: input.imageUrl });
    return content ? this.standardizeImageContent(content) : null;
  }

  private async loadRemoteImage(
    input: ProductImageContentInput & { imageUrl: string },
  ): Promise<ProductImageContent | null> {
    try {
      const response = await fetch(input.imageUrl);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        contentType:
          response.headers.get('content-type') ??
          input.contentType ??
          'image/jpeg',
        filename: input.filename,
      };
    } catch {
      return null;
    }
  }

  private async standardizeImageContent(
    content: ProductImageContent,
  ): Promise<ProductImageContent> {
    const targetSize = this.clampInteger(
      this.config.get<number>('productImport.imageTargetSize'),
      64,
      2048,
      480,
    );
    const jpegQuality = this.clampInteger(
      this.config.get<number>('productImport.imageJpegQuality'),
      50,
      100,
      88,
    );
    const background = { r: 245, g: 245, b: 245, alpha: 1 };
    const buffer = await sharp(content.buffer, { failOn: 'none' })
      .rotate()
      .resize({
        width: targetSize,
        height: targetSize,
        fit: 'contain',
        background,
      })
      .flatten({ background })
      .jpeg({ quality: jpegQuality })
      .toBuffer();

    return {
      buffer,
      contentType: 'image/jpeg',
      filename: this.toJpegFilename(content.filename),
    };
  }

  private toJpegFilename(filename: string) {
    return filename.replace(/\.[^.\\/]+$/g, '') + '.jpg';
  }

  private clampInteger(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }
}
