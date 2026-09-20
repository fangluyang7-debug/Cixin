import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONTENT_SEARCH_PROVIDER } from '../../../adapters/content-search/content-search.constants';
import {
  ContentSearchDebugInfo,
  ContentSearchProvider,
  ContentSearchResult,
} from '../../../adapters/content-search/content-search-provider.interface';
import {
  MODEL_ADAPTER,
  ModelAdapter,
} from '../../../adapters/model/model-adapter.interface';
import { stableHash } from '../../../cache/cache-key.util';
import { TREND_CACHE_KEYS } from '../../../cache/cache-namespaces';
import { CACHE_STORE } from '../../../cache/cache.constants';
import { CacheStore } from '../../../cache/interfaces/cache-store.interface';
import { normalizeProductCategoryOrNull } from '../../../common/catalog/product-categories';
import { TrendOutfitRequestDto } from '../dto/trend-outfit-request.dto';
import { TrendOutfitProductMatcherService } from './trend-outfit-product-matcher.service';
import {
  TrendEvidenceSource,
  TrendOutfitBaseProduct,
  TrendOutfitBaseProductInput,
  TrendOutfitCandidate,
  TrendOutfitExtractionResult,
  TrendOutfitResponse,
} from './trend-outfit.types';

const TTL = {
  queryPlan: 60 * 60 * 24 * 3,
  search: 60 * 60 * 12,
  extract: 60 * 60 * 12,
  recommend: 60 * 60 * 2,
};
const RECOMMENDATION_CACHE_SCHEMA_VERSION = 'trend-outfit-advice-v2';

@Injectable()
export class TrendOutfitService {
  constructor(
    @Inject(CONTENT_SEARCH_PROVIDER)
    private readonly contentSearchProvider: ContentSearchProvider,
    @Inject(MODEL_ADAPTER)
    private readonly modelAdapter: ModelAdapter,
    @Inject(CACHE_STORE)
    private readonly cache: CacheStore,
    private readonly productMatcher: TrendOutfitProductMatcherService,
    private readonly config: ConfigService,
  ) {}

  async recommend(dto: TrendOutfitRequestDto): Promise<TrendOutfitResponse> {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('TREND_OUTFIT_BODY_REQUIRED');
    }

    const sessionId = this.cleanString(dto.sessionId);
    if (!sessionId) throw new BadRequestException('TREND_OUTFIT_SESSION_ID_REQUIRED');

    const limit = this.clampLimit(dto.limit);
    const baseInput = await this.resolveBaseProductInput(dto, sessionId);
    const baseProduct = this.normalizeBaseProduct(baseInput);
    const baseProductHash = stableHash(baseProduct);
    const productPoolVersion = await this.productMatcher.getProductPoolVersion();
    const recommendationCacheVersion = stableHash({
      productPoolVersion,
      schema: RECOMMENDATION_CACHE_SCHEMA_VERSION,
    });
    const recommendCacheKey = TREND_CACHE_KEYS.recommend(
      baseProductHash,
      recommendationCacheVersion,
    );
    const debugEnabled = dto.debug === true;
    const cachedResponse = debugEnabled
      ? null
      : await this.cache.get<TrendOutfitResponse>(recommendCacheKey);
    if (cachedResponse) return this.applyLimit(cachedResponse, limit);

    const queryPlan = await this.getOrBuildQueryPlan(baseProduct, baseProductHash);
    const search = await this.searchTrendContent(queryPlan.queries);
    const extraction = await this.extractTrends({
      baseProduct,
      baseProductHash,
      searchResults: search.results,
      forceFallback: search.results.length === 0,
    });
    const shouldMatchLocalProducts =
      !extraction.fallback || extraction.result.evidenceSources.length > 0;
    const recommendations = shouldMatchLocalProducts
      ? await this.productMatcher.matchProducts({
          baseProduct,
          outfitCandidates: extraction.result.outfitCandidates,
          limit: 8,
        })
      : [];
    const matchingFallback =
      recommendations.length === 0 ||
      recommendations.some((item) => item.reason.includes('已放宽类目限制'));
    const outfitAdvice =
      recommendations.length === 0
        ? this.buildOutfitAdvice({
            baseProduct,
            extraction: extraction.result,
            hasPublicEvidence: extraction.result.evidenceSources.length > 0,
          })
        : [];

    const response: TrendOutfitResponse = {
      baseProduct,
      trendSummary: extraction.result.trendSummary,
      outfitAdvice,
      recommendations,
      evidenceSources: extraction.result.evidenceSources,
      fallback: extraction.fallback || matchingFallback,
      ...(debugEnabled
        ? {
            debug: {
              searchProvider: search.debug.searchProvider,
              attemptedProviders: search.debug.attemptedProviders,
              providerResultCounts: search.debug.providerResultCounts,
              queries: queryPlan.queries,
              searchResultCount: search.results.length,
              searchResultsPreview: this.toEvidenceSources(search.results).slice(0, 5),
            },
          }
        : {}),
    };

    if (!debugEnabled) {
      await this.cache.set(recommendCacheKey, response, TTL.recommend);
    }
    return this.applyLimit(response, limit);
  }

  async prewarmForCandidate(input: {
    sessionId: string;
    candidateItemId: string;
    limit?: number;
  }) {
    await this.recommend({
      sessionId: input.sessionId,
      candidateItemId: input.candidateItemId,
      limit: input.limit ?? 4,
    });
  }

  private async resolveBaseProductInput(
    dto: TrendOutfitRequestDto,
    sessionId: string,
  ): Promise<TrendOutfitBaseProductInput> {
    if (dto.baseProduct) return dto.baseProduct;
    const candidateItemId = this.cleanString(dto.candidateItemId);
    if (!candidateItemId) {
      throw new BadRequestException(
        'TREND_OUTFIT_BASE_PRODUCT_OR_CANDIDATE_ITEM_REQUIRED',
      );
    }
    return this.productMatcher.resolveBaseProductFromCandidateItem({
      sessionId,
      candidateItemId,
    });
  }

  private normalizeBaseProduct(
    input: TrendOutfitBaseProductInput,
  ): TrendOutfitBaseProduct {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('TREND_OUTFIT_BASE_PRODUCT_REQUIRED');
    }

    const productId = this.cleanString(input.productId);
    const title = this.cleanTitle(input.title);
    const category = this.normalizeCategory(input.category);
    if (!productId) throw new BadRequestException('TREND_OUTFIT_PRODUCT_ID_REQUIRED');
    if (!title) throw new BadRequestException('TREND_OUTFIT_TITLE_REQUIRED');
    if (!category) throw new BadRequestException('TREND_OUTFIT_CATEGORY_REQUIRED');

    return {
      productId,
      title,
      normalizedTitle: title,
      category,
      brand: this.cleanString(input.brand),
      color: this.cleanString(input.color),
      styleTags: this.normalizeTags(input.styleTags),
      sceneTags: this.normalizeTags(input.sceneTags),
      price: this.toNumber(input.price),
    };
  }

  private async getOrBuildQueryPlan(
    baseProduct: TrendOutfitBaseProduct,
    baseProductHash: string,
  ) {
    const cacheKey = TREND_CACHE_KEYS.queryPlan(baseProductHash);
    const cached = await this.cache.get<{ queries: string[] }>(cacheKey);
    if (cached) return cached;

    const queries = this.buildTrendSearchQueries(baseProduct);
    const queryPlan = { queries };
    await this.cache.set(cacheKey, queryPlan, TTL.queryPlan);
    return queryPlan;
  }

  private buildTrendSearchQueries(baseProduct: TrendOutfitBaseProduct) {
    const title = baseProduct.normalizedTitle;
    const styleTags = baseProduct.styleTags.slice(0, 2);
    const sceneTags = baseProduct.sceneTags.slice(0, 2);
    const queries = [
      `${title} 搭配 小红书`,
      `${title} 穿搭 抖音`,
      ...styleTags.map((tag) => `${title} ${tag} 搭配`),
      ...sceneTags.map((tag) => `${title} ${tag} 穿搭`),
      baseProduct.color ? `${title} ${baseProduct.color} 搭配` : null,
      `${title} ootd`,
      `${title} 网红 搭配`,
    ].filter((item): item is string => Boolean(item));

    return [...new Set(queries)].slice(0, 8);
  }

  private async searchTrendContent(queries: string[]) {
    const allResults: ContentSearchResult[] = [];
    let failed = false;
    const debug = this.emptySearchDebug();
    const perQueryLimit =
      this.config.get<number>('contentSearch.maxResultsPerQuery') ?? 8;
    for (const query of queries) {
      try {
        const results = await this.contentSearchProvider.search({
          query,
          limit: perQueryLimit,
        });
        allResults.push(...results);
        this.mergeSearchDebug(debug, this.readContentSearchDebug());
      } catch {
        failed = true;
        if (allResults.length === 0) break;
      }
    }

    const totalLimit =
      this.config.get<number>('contentSearch.totalResultLimit') ?? 12;
    const results = this.dedupeAndFilterSearchResults(allResults).slice(
      0,
      totalLimit,
    );
    return {
      failed,
      results,
      debug: {
        ...debug,
        searchProvider:
          debug.searchProvider === 'unknown'
            ? this.readProviderName()
            : debug.searchProvider,
      },
    };
  }

  private dedupeAndFilterSearchResults(results: ContentSearchResult[]) {
    const irrelevantPattern =
      /(真假鉴定|真假|鉴定|开箱|测评|评测|代购|价格|报价|优惠|折扣|假货|避雷)/i;
    const seen = new Set<string>();
    const filtered: ContentSearchResult[] = [];
    for (const result of results) {
      const title = this.cleanString(result.title);
      const url = this.cleanString(result.url);
      if (!title || !url) continue;

      const searchable = `${title} ${result.snippet ?? ''}`;
      if (irrelevantPattern.test(searchable)) continue;

      const key = this.searchResultKey(result);
      if (seen.has(key)) continue;
      seen.add(key);
      filtered.push({
        title,
        snippet: this.cleanString(result.snippet) ?? '',
        url,
        source: result.source ?? 'unknown',
        provider: result.provider,
        raw: result.raw,
        stale: result.stale,
      });
    }
    return filtered;
  }

  private async extractTrends(input: {
    baseProduct: TrendOutfitBaseProduct;
    baseProductHash: string;
    searchResults: ContentSearchResult[];
    forceFallback: boolean;
  }): Promise<{ result: TrendOutfitExtractionResult; fallback: boolean }> {
    if (input.forceFallback) {
      return {
        result: this.buildRuleBasedExtraction(input.baseProduct, input.searchResults),
        fallback: true,
      };
    }

    const searchResultHash = stableHash(input.searchResults);
    const cacheKey = TREND_CACHE_KEYS.extract(
      input.baseProductHash,
      searchResultHash,
    );
    const cached = await this.cache.get<TrendOutfitExtractionResult>(cacheKey);
    if (cached) return { result: cached, fallback: false };

    try {
      const extracted = await this.modelAdapter.extractTrendOutfit({
        baseProduct: input.baseProduct,
        searchResults: input.searchResults,
      });
      if (extracted.outfitCandidates.length === 0) {
        throw new Error('TREND_OUTFIT_EMPTY_EXTRACTION');
      }
      await this.cache.set(cacheKey, extracted, TTL.extract);
      return { result: extracted, fallback: false };
    } catch {
      return {
        result: this.buildRuleBasedExtraction(input.baseProduct, input.searchResults),
        fallback: true,
      };
    }
  }

  private buildRuleBasedExtraction(
    baseProduct: TrendOutfitBaseProduct,
    searchResults: ContentSearchResult[],
  ): TrendOutfitExtractionResult {
    const candidates = this.ruleBasedOutfitCandidates(baseProduct);
    return {
      trendSummary:
        searchResults.length > 0
          ? '公开穿搭内容已找到，但结构化抽取暂不可用，先根据搜索结果和商品标签整理搭配方向。'
          : '公开穿搭内容暂不可用，先根据商品类目、颜色、风格和场景标签整理搭配方向。',
      outfitCandidates: candidates,
      evidenceSources: this.toEvidenceSources(searchResults),
    };
  }

  private buildOutfitAdvice(input: {
    baseProduct: TrendOutfitBaseProduct;
    extraction: TrendOutfitExtractionResult;
    hasPublicEvidence: boolean;
  }) {
    const candidates = input.extraction.outfitCandidates.slice(0, 4);
    if (candidates.length === 0) {
      return [
        this.joinAdviceSentence([
          `当前本地商品池没有找到适合搭配「${input.baseProduct.title}」的可售单品`,
          '可以先从同色系配饰、基础上装和低饱和下装里挑选',
        ]),
      ];
    }

    return candidates.map((candidate) => {
      const keywords = candidate.keywords.slice(0, 2).join('、');
      const styleTags = candidate.styleTags.slice(0, 2).join('、');
      const sceneTags = candidate.sceneTags.slice(0, 2).join('、');
      const sourceIntro = input.hasPublicEvidence
        ? '公开穿搭里更常见'
        : '当前可先按规则尝试';
      const details = [
        keywords ? `优先看 ${keywords}` : null,
        styleTags ? `风格贴近 ${styleTags}` : null,
        sceneTags ? `适合 ${sceneTags}` : null,
      ].filter((item): item is string => Boolean(item));
      return this.joinAdviceSentence([
        `${candidate.displayCategory}：${sourceIntro}的方向`,
        ...details,
      ]);
    });
  }

  private joinAdviceSentence(parts: string[]) {
    const text = parts
      .map((part) => part.trim().replace(/[。；;,\s]+$/g, ''))
      .filter(Boolean)
      .join('；');
    return text.endsWith('。') ? text : `${text}。`;
  }

  private ruleBasedOutfitCandidates(
    baseProduct: TrendOutfitBaseProduct,
  ): TrendOutfitCandidate[] {
    const sharedStyleTags = baseProduct.styleTags;
    const sharedSceneTags = baseProduct.sceneTags;
    const isShoeLike = /shoe|sneaker|boot|鞋|靴/.test(
      `${baseProduct.category} ${baseProduct.title}`.toLowerCase(),
    );

    if (!isShoeLike) {
      return [
        this.trendCandidate('accessory', '配饰', ['配饰', '同色系', '风格呼应'], sharedStyleTags, sharedSceneTags, 0.55),
        this.trendCandidate('bag', '包袋', ['斜挎包', '托特包', '小包'], sharedStyleTags, sharedSceneTags, 0.5),
        this.trendCandidate('outerwear', '外搭', ['外套', '开衫', '衬衫'], sharedStyleTags, sharedSceneTags, 0.48),
        this.trendCandidate('bottom', '下装', ['直筒裤', '半裙', '牛仔裤'], sharedStyleTags, sharedSceneTags, 0.46),
      ];
    }

    return [
      this.trendCandidate('bottom', '下装', ['直筒裤', '牛仔裤', '工装裤', '阔腿裤'], sharedStyleTags, sharedSceneTags, 0.64),
      this.trendCandidate('socks', '袜子', ['中筒袜', '运动袜', '堆堆袜', '长袜'], sharedStyleTags, sharedSceneTags, 0.6),
      this.trendCandidate('top', '上装', ['卫衣', '短上衣', '衬衫', '针织衫'], sharedStyleTags, sharedSceneTags, 0.56),
      this.trendCandidate('bag', '包袋', ['腋下包', '托特包', '斜挎包', '通勤包'], sharedStyleTags, sharedSceneTags, 0.52),
      this.trendCandidate('accessory', '配饰', ['帽子', '腰带', '项链', '墨镜'], sharedStyleTags, sharedSceneTags, 0.48),
    ];
  }

  private trendCandidate(
    targetCategory: string,
    displayCategory: string,
    keywords: string[],
    styleTags: string[],
    sceneTags: string[],
    confidence: number,
  ): TrendOutfitCandidate {
    return {
      targetCategory,
      displayCategory,
      keywords,
      styleTags,
      sceneTags,
      confidence,
      reason: '基于基础商品标签生成的规则搭配候选。',
    };
  }

  private toEvidenceSources(results: ContentSearchResult[]): TrendEvidenceSource[] {
    return results.slice(0, 12).map((result) => ({
      title: result.title,
      snippet: result.snippet,
      url: result.url,
      source: result.source,
    }));
  }

  private emptySearchDebug() {
    return {
      searchProvider: 'unknown',
      attemptedProviders: [] as string[],
      providerResultCounts: {} as Record<string, number>,
    };
  }

  private mergeSearchDebug(
    target: ReturnType<TrendOutfitService['emptySearchDebug']>,
    current: ContentSearchDebugInfo | null,
  ) {
    if (!current) return;
    target.searchProvider = current.searchProvider;
    for (const provider of current.attemptedProviders) {
      if (!target.attemptedProviders.includes(provider)) {
        target.attemptedProviders.push(provider);
      }
    }
    for (const [provider, count] of Object.entries(current.providerResultCounts)) {
      target.providerResultCounts[provider] =
        (target.providerResultCounts[provider] ?? 0) + count;
    }
  }

  private readContentSearchDebug() {
    const provider = this.contentSearchProvider as ContentSearchProvider & {
      getLastDebug?: () => ContentSearchDebugInfo | null;
    };
    return provider.getLastDebug?.() ?? null;
  }

  private readProviderName() {
    const provider = this.contentSearchProvider as ContentSearchProvider & {
      getProviderName?: () => string;
    };
    return provider.getProviderName?.() ?? 'unknown';
  }

  private applyLimit(response: TrendOutfitResponse, limit: number) {
    return {
      ...response,
      recommendations: response.recommendations.slice(0, limit),
    };
  }

  private searchResultKey(result: ContentSearchResult) {
    try {
      const url = new URL(result.url);
      return `${url.origin}${url.pathname}`.toLowerCase();
    } catch {
      return `${result.title}:${result.url}`.toLowerCase();
    }
  }

  private cleanTitle(value: unknown) {
    return typeof value === 'string'
      ? value
          .replace(/[【\[].*?[】\]]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80)
      : '';
  }

  private normalizeCategory(value: unknown) {
    const text = this.cleanString(value);
    if (!text) return '';
    return normalizeProductCategoryOrNull(text) ?? text.toLowerCase();
  }

  private normalizeTags(value: unknown) {
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value
          .map((item) => this.cleanString(item))
          .filter((item): item is string => Boolean(item))
          .map((item) => item.toLowerCase()),
      ),
    ].slice(0, 12);
  }

  private clampLimit(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return 4;
    return Math.min(parsed, 8);
  }

  private cleanString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private toNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value.replace(/[^\d.]/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
