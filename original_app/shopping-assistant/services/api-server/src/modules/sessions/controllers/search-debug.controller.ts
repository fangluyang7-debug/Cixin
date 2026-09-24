import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ok } from '../../../common/dto/api-response.dto';
import { AssetsService } from '../../assets/application/assets.service';
import { UploadedImageFile } from '../../assets/dto/uploaded-image-file';
import { SearchDebugService } from '../application/search-debug.service';
import { NormalizedSubjectBoxDto } from '../dto/subject-selection.dto';

@Controller('api/v1/debug')
export class SearchDebugController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly searchDebugService: SearchDebugService,
  ) {}

  @Post('image-search')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async debugImageSearch(
    @Body() body: Record<string, unknown>,
    @UploadedFile() file?: UploadedImageFile,
  ): Promise<unknown> {
    if (!file) {
      throw new BadRequestException('DEBUG_IMAGE_FILE_REQUIRED');
    }

    const asset = await this.assetsService.createImageAsset(
      {
        variantType: 'compressed_recognition',
        sourceType: 'demo',
        isPrimaryRecognitionAsset: true,
      },
      file,
    );

    const result = await this.searchDebugService.run({
      assetId: asset.assetId,
      box: this.parseBox(body),
      categoryHint: this.optionalString(body.categoryHint),
      topK: this.optionalNumber(body.topK),
      minScore: this.optionalNumber(body.minScore),
      resultLimit: this.optionalNumber(body.resultLimit),
      embeddingKind: this.optionalEmbeddingKind(body.embeddingKind),
      runDetailed: this.optionalBoolean(body.runDetailed),
      runRefined: this.optionalBoolean(body.runRefined),
    });

    return ok({
      upload: asset,
      ...result,
    });
  }

  private parseBox(body: Record<string, unknown>): NormalizedSubjectBoxDto {
    return {
      x: this.numberOrDefault(body.boxX, 0),
      y: this.numberOrDefault(body.boxY, 0),
      width: this.numberOrDefault(body.boxWidth, 1),
      height: this.numberOrDefault(body.boxHeight, 1),
      label: this.optionalString(body.boxLabel) ?? 'debug_user_selection',
      confidence: this.optionalNumber(body.boxConfidence) ?? 1,
    };
  }

  private numberOrDefault(value: unknown, fallback: number) {
    const parsed = this.optionalNumber(value);
    return parsed ?? fallback;
  }

  private optionalNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private optionalBoolean(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    throw new BadRequestException('INVALID_DEBUG_BOOLEAN_FIELD');
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private optionalEmbeddingKind(value: unknown) {
    const text = this.optionalString(value);
    if (!text) return undefined;
    if (text === 'visual' || text === 'multimodal') return text;
    throw new BadRequestException('INVALID_DEBUG_EMBEDDING_KIND');
  }
}
