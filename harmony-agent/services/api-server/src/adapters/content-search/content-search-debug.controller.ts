import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ok } from '../../common/dto/api-response.dto';
import { CONTENT_SEARCH_PROVIDER } from './content-search.constants';
import {
  ContentSearchResult,
  DebuggableContentSearchProvider,
} from './content-search-provider.interface';

@Controller('api/v1/debug')
export class ContentSearchDebugController {
  constructor(
    @Inject(CONTENT_SEARCH_PROVIDER)
    private readonly contentSearchProvider: DebuggableContentSearchProvider,
    private readonly config: ConfigService,
  ) {}

  @Get('content-search')
  async searchContent(
    @Query('q') query: string | undefined,
    @Query('provider') provider: string | undefined,
    @Query('limit') limit: string | undefined,
    @Headers('x-maintenance-token') maintenanceToken: string | undefined,
  ) {
    this.assertDebugAllowed(maintenanceToken);
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('CONTENT_SEARCH_QUERY_REQUIRED');
    }

    const items = await this.contentSearchProvider.search({
      query: query.trim(),
      providerOverride: provider,
      limit: this.parseLimit(limit),
    });
    const debug = this.contentSearchProvider.getLastDebug();

    return ok({
      query: query.trim(),
      provider: debug?.searchProvider ?? provider ?? this.contentSearchProvider.getProviderName(),
      attemptedProviders: debug?.attemptedProviders ?? [],
      providerResultCounts: debug?.providerResultCounts ?? {},
      cacheHit: debug?.cacheHit === true,
      stale: debug?.stale === true,
      count: items.length,
      items: items.map((item) => this.toDebugItem(item)),
    });
  }

  private assertDebugAllowed(maintenanceToken?: string) {
    const nodeEnv =
      this.config.get<string>('runtime.nodeEnv') ?? process.env.NODE_ENV;
    if (nodeEnv !== 'production') return;

    const expected = process.env.MAINTENANCE_API_TOKEN;
    if (!expected) throw new ForbiddenException('MAINTENANCE_API_TOKEN_REQUIRED');
    if (maintenanceToken !== expected) {
      throw new ForbiddenException('MAINTENANCE_TOKEN_INVALID');
    }
  }

  private parseLimit(value?: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
    return parsed;
  }

  private toDebugItem(item: ContentSearchResult) {
    return {
      title: item.title,
      snippet: item.snippet,
      url: item.url,
      source: item.source,
      provider: item.provider,
      stale: item.stale === true,
    };
  }
}
