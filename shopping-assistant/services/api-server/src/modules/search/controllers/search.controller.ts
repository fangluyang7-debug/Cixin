import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { ok } from '../../../common/dto/api-response.dto';
import { SEARCH_PROVIDER, SearchProvider } from '../../../adapters/search-provider/search-provider.interface';
import { SearchShoesDto } from '../dto/search-shoes.dto';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';

@Controller('api/v1/search')
export class SearchController {
  constructor(@Inject(SEARCH_PROVIDER) private readonly searchProvider: SearchProvider) {}

  @Post('shoes')
  async searchShoes(@Body() dto: SearchShoesDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('SEARCH_BODY_REQUIRED');
    }

    const keywords = Array.isArray(dto.keywords)
      ? dto.keywords.filter((keyword) => typeof keyword === 'string' && keyword.trim().length > 0)
      : [];

    if (keywords.length === 0) {
      throw new BadRequestException('SEARCH_KEYWORDS_REQUIRED');
    }

    const filters = dto.filters ?? {};
    const category = normalizeProductCategory(
      dto.categoryHint ?? filters.categoryScope ?? keywords.join(' '),
    );
    const candidates = await this.searchProvider.searchShoes({
      keywords,
      filters: {
        ...filters,
        categoryScope: filters.categoryScope ?? category,
      },
    });

    return ok({
      candidateCount: candidates.length,
      candidates,
    });
  }
}
