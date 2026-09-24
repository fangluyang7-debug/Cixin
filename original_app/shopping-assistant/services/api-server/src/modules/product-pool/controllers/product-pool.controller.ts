import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ok } from '../../../common/dto/api-response.dto';
import {
  ExtractSubjectDebugOptions,
  LocalGpuImagePreprocessorService,
} from '../application/local-gpu-image-preprocessor.service';
import { ProductPoolService } from '../application/product-pool.service';
import { ImportProductsDto } from '../dto/import-products.dto';

@Controller('api/v1/product-pool')
export class ProductPoolController {
  constructor(
    private readonly productPoolService: ProductPoolService,
    private readonly config: ConfigService,
    private readonly localGpuImagePreprocessor: LocalGpuImagePreprocessorService,
  ) {}

  @Post('import')
  async importProducts(
    @Body() dto: ImportProductsDto,
    @Headers('x-maintenance-token') maintenanceToken?: string,
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(await this.productPoolService.importProducts(dto));
  }

  @Get('stats')
  async getStats() {
    return ok(await this.productPoolService.getStats());
  }

  @Post('debug/image-preprocess')
  async debugImagePreprocess(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Body()
    body: {
      imageBase64?: string;
      imageUrl?: string;
      role?: 'query' | 'product_main' | 'product_style';
      tags?: Record<string, unknown>;
      debugOptions?: ExtractSubjectDebugOptions;
    },
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    const imageBase64 = this.cleanOptionalString(body?.imageBase64);
    const imageUrl = this.cleanOptionalString(body?.imageUrl);
    if (!imageBase64 && !imageUrl) {
      throw new BadRequestException('IMAGE_BASE64_OR_IMAGE_URL_REQUIRED');
    }

    return ok(
      await this.localGpuImagePreprocessor.previewSubject({
        imageBase64,
        imageUrl,
        role: this.parseImageEmbeddingRole(body?.role),
        tags: this.asRecord(body?.tags),
        debugOptions: this.normalizeExtractDebugOptions(body?.debugOptions),
      }),
    );
  }

  @Post('embeddings/rebuild')
  async rebuildEmbeddings(
    @Headers('x-maintenance-token') maintenanceToken?: string,
    @Query('limit') limit?: string,
    @Query('embeddingKind') embeddingKind?: string,
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(
      await this.productPoolService.rebuildEmbeddings({
        limit: this.parsePositiveInteger(limit),
        embeddingKind,
      }),
    );
  }

  @Post('batches/delete')
  async deleteImportBatch(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Body() body: { batchId?: string; batchSource?: string; dryRun?: boolean },
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(await this.productPoolService.deleteImportBatch(body ?? {}));
  }

  @Get('batches')
  async listImportBatches(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('batchSource') batchSource?: string,
    @Query('status') status?: string,
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(
      await this.productPoolService.listImportBatches({
        limit: this.parsePositiveInteger(limit),
        offset: this.parseNonNegativeInteger(offset),
        batchSource,
        status,
      }),
    );
  }

  @Get('batches/:batchId')
  async getImportBatch(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Param('batchId') batchId: string,
    @Query('productLimit') productLimit?: string,
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(
      await this.productPoolService.getImportBatch(batchId, {
        productLimit: this.parsePositiveInteger(productLimit),
      }),
    );
  }

  @Post('batches/:batchId/retry')
  async retryImportBatch(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Param('batchId') batchId: string,
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(await this.productPoolService.retryImportBatch(batchId));
  }

  @Get('batches/:batchId/quality')
  async getImportBatchQuality(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Param('batchId') batchId: string,
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(await this.productPoolService.getImportBatchQuality(batchId));
  }

  @Post('batches/:batchId/rollback')
  async rollbackImportBatch(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Param('batchId') batchId: string,
    @Body() body: { dryRun?: boolean },
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(
      await this.productPoolService.rollbackImportBatch(batchId, {
        dryRun: body?.dryRun === true,
      }),
    );
  }

  @Post('ann/diagnose')
  async diagnoseAnn(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Body()
    body: {
      assetId?: string;
      imageUrl?: string;
      textHint?: string;
      topK?: number;
      minScore?: number;
      embeddingKind?: string;
    },
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(await this.productPoolService.diagnoseAnn(body ?? {}));
  }

  @Get('products')
  async listProducts(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('platform') platform?: string,
    @Query('tagStatus') tagStatus?: string,
    @Query('batchId') batchId?: string,
    @Query('brand') brand?: string,
    @Query('category') category?: string,
    @Query('keyword') keyword?: string,
    @Query('hasEmbedding') hasEmbedding?: string,
  ) {
    return ok(
      await this.productPoolService.listProducts({
        limit: this.parsePositiveInteger(limit),
        offset: this.parseNonNegativeInteger(offset),
        platform,
        tagStatus,
        batchId,
        brand,
        category,
        keyword,
        hasEmbedding: this.parseOptionalBoolean(hasEmbedding),
      }),
    );
  }

  @Get('products/:productId')
  async getProduct(@Param('productId') productId: string) {
    return ok(await this.productPoolService.getProduct(productId));
  }

  @Patch('products/:productId')
  async updateProduct(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Param('productId') productId: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(await this.productPoolService.updateProduct(productId, body ?? {}));
  }

  @Post('products/delete')
  async deleteProducts(
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
    @Body()
    body: {
      productIds?: string[];
      batchId?: string;
      dryRun?: boolean;
    },
  ) {
    this.assertMaintenanceToken(maintenanceToken);
    return ok(await this.productPoolService.deleteProducts(body ?? {}));
  }

  private assertMaintenanceToken(maintenanceToken?: string) {
    const expected = process.env.MAINTENANCE_API_TOKEN;
    const allowMockProviders =
      this.config.get<boolean>('runtime.allowMockProviders') === true;
    if (!expected && allowMockProviders) return;
    if (!expected) throw new ForbiddenException('MAINTENANCE_API_TOKEN_REQUIRED');
    if (maintenanceToken !== expected) {
      throw new ForbiddenException('MAINTENANCE_TOKEN_INVALID');
    }
  }

  private parsePositiveInteger(value?: string) {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  private parseNonNegativeInteger(value?: string) {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private parseOptionalBoolean(value?: string) {
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  }

  private parseImageEmbeddingRole(value?: string) {
    if (value === 'query' || value === 'product_style') return value;
    return 'product_main';
  }

  private normalizeExtractDebugOptions(value?: ExtractSubjectDebugOptions) {
    const input = this.asRecord(value) as ExtractSubjectDebugOptions;
    const detectionClasses =
      typeof input.detectionClasses === 'string'
        ? input.detectionClasses
        : Array.isArray(input.detectionClasses)
          ? input.detectionClasses.map((item) => String(item)).filter(Boolean)
          : undefined;
    const squarePadColor = Array.isArray(input.squarePadColor)
      ? input.squarePadColor.slice(0, 3).map((item) => this.clampInteger(item, 0, 255))
      : undefined;
    const manualBboxNorm = Array.isArray(input.manualBboxNorm)
      ? input.manualBboxNorm.slice(0, 4).map((item) => this.clampNumber(item, 0, 1))
      : undefined;

    return {
      detectionClasses,
      detectionConf: this.clampNumber(input.detectionConf, 0, 1),
      cropPadding: this.clampNumber(input.cropPadding, 0, 1),
      squarePadColor: squarePadColor?.length === 3 ? squarePadColor : undefined,
      outputSize: this.clampInteger(input.outputSize, 0, 1024) ?? 480,
      jpegQuality: this.clampInteger(input.jpegQuality, 50, 100) ?? 88,
      manualBboxNorm:
        manualBboxNorm?.length === 4 && manualBboxNorm.every((item) => item !== undefined)
          ? (manualBboxNorm as number[])
          : undefined,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private cleanOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private clampNumber(value: unknown, min: number, max: number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.min(max, Math.max(min, value));
  }

  private clampInteger(value: unknown, min: number, max: number) {
    const parsed = typeof value === 'number' ? Math.round(value) : Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
  }
}
