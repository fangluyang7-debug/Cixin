import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ok } from '../../../common/dto/api-response.dto';
import { AssetsService } from '../application/assets.service';
import { CreateImageAssetDto } from '../dto/create-image-asset.dto';
import { UploadedImageFile } from '../dto/uploaded-image-file';

@Controller('api/v1/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('images')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async createImageAsset(
    @Body() dto: CreateImageAssetDto,
    @UploadedFile() file?: UploadedImageFile,
  ) {
    return ok(await this.assetsService.createImageAsset(dto, file));
  }
}
