import { Body, Controller, Post } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { TrendOutfitService } from '../application/trend-outfit.service';
import { TrendOutfitRequestDto } from '../dto/trend-outfit-request.dto';

@Controller('api/v1/recommendations')
export class TrendOutfitController {
  constructor(private readonly trendOutfitService: TrendOutfitService) {}

  @Post('trend-outfit')
  async recommendTrendOutfit(@Body() dto: TrendOutfitRequestDto) {
    return ok(await this.trendOutfitService.recommend(dto));
  }
}
