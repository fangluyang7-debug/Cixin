import { Injectable } from '@nestjs/common';
import {
  CandidateVisualVerificationInput,
  ConversationTurnParseInput,
  ConversationTurnParseResult,
  ModelAdapter,
  ProductTagInput,
} from './model-adapter.interface';

@Injectable()
export class MockModelAdapterService implements ModelAdapter {
  async identifyShoe(_input: { assetId: string }) {
    return {
      category: 'running_shoes',
      brand: 'Nike',
      modelLine: 'Air Zoom Pegasus',
      colorFamily: 'black_white',
      colorway: 'Black White',
      shoeType: 'running',
      size: null,
      color: 'black',
      styleTags: ['low_top', 'sport'],
      sceneTags: ['running', 'casual'],
      keywords: ['Nike', 'Air Zoom Pegasus', 'black white', 'running shoes'],
      confidence: 0.82,
      raw: { provider: 'mock_model' },
    };
  }

  async parseRefineMessage(input: { message: string }) {
    return this.parseFilterFromText(input.message);
  }

  async parseConversationTurn(input: ConversationTurnParseInput): Promise<ConversationTurnParseResult> {
    const reset = /重新|重置|清空|算了|从头|所有平台|start over|reset|clear/i.test(input.latestUserMessage);
    const filterPatch = this.parseFilterPatchFromText(input.latestUserMessage, input);
    const assistantMessage =
      Object.keys(filterPatch).length > 0 || reset
        ? '已按你的最新要求更新筛选条件。'
        : '我会结合当前候选结果继续理解你的要求。';

    return {
      intent: reset ? 'reset_filter' : 'refine_filter',
      filterPatch,
      filterRemove: [],
      shouldResetPreviousFilters: reset,
      assistantMessage,
      confidence: 0.82,
      raw: {
        provider: 'mock_model',
        parser: 'deterministic_conversation_parser',
        promptVersion: input.prompt.version,
        schemaVersion: input.profileSchema.version,
        outputSchemaVersion: input.outputSchema.version,
        userMemoryContextIncluded: input.userMemoryContext !== null && input.userMemoryContext !== undefined,
      },
    };
  }

  async tagProduct(input: ProductTagInput) {
    const parsed = this.inferShoeTags(input.title, input.brandHint ?? null);

    return {
      ...parsed,
      keywords: this.buildKeywords(parsed, input.title),
      confidence: 0.76,
      raw: {
        provider: 'mock_model',
        reason: 'deterministic_title_parser',
      },
    };
  }

  async verifyCandidateVisualMatch(input: CandidateVisualVerificationInput) {
    const expectedBrand = this.normalize(input.queryProfile.brand);
    const actualBrand = this.normalize(input.candidate.brand);
    const expectedModel = this.normalize(input.queryProfile.modelLine);
    const actualModel = this.normalize(input.candidate.modelLine);
    const expectedColor = this.normalize(input.queryProfile.colorFamily ?? input.queryProfile.color);
    const actualColor = this.normalize(input.candidate.colorFamily);

    const brandOk = !expectedBrand || !actualBrand || expectedBrand === actualBrand;
    const modelOk = !expectedModel || !actualModel || actualModel.includes(expectedModel) || expectedModel.includes(actualModel);
    const colorOk = !expectedColor || !actualColor || expectedColor === actualColor;

    return {
      sameProduct: brandOk && modelOk,
      sameColorway: brandOk && modelOk && colorOk,
      confidence: brandOk && modelOk ? 0.78 : 0.42,
      raw: { provider: 'mock_model', brandOk, modelOk, colorOk },
    };
  }

  parseFilterFromText(message: string) {
    const priceMax = this.extractPriceMax(message);
    const priceMin = this.extractPriceMin(message);
    const platformsExclude = this.extractExcludedPlatforms(message);
    const platformsInclude =
      platformsExclude.length > 0 ? [] : this.extractIncludedPlatforms(message);

    return {
      priceMin: priceMin ? String(priceMin) : null,
      priceMax: priceMax ? String(priceMax) : null,
      platformsInclude,
      platformsExclude,
      stockOnly: /有货|现货|能买|只看有货/i.test(message),
      urgentDeliveryPreferred: /急|尽快|马上|及时|今天|明天/i.test(message),
      timeConstraintDays: this.extractDays(message),
      color: this.extractColor(message),
      brand: this.extractBrand(message),
      platform: platformsInclude.length === 1 ? platformsInclude[0] : null,
      sortRule: this.extractSortRule(message),
    };
  }

  inferShoeTags(title: string, brandHint?: string | null) {
    const brand = brandHint ?? this.extractBrand(title);
    const modelLine = this.extractModelLine(title);
    const colorFamily = this.extractColorFamily(title);

    return {
      category: 'running_shoes',
      brand,
      modelLine,
      colorFamily,
      colorway: this.toColorway(colorFamily),
      shoeType: /篮球|basketball/i.test(title) ? 'basketball' : 'running',
    };
  }

  private parseFilterPatchFromText(message: string, context: ConversationTurnParseInput) {
    const parsed = this.parseFilterFromText(message);
    const patch: Record<string, unknown> = {};

    if (parsed.priceMin) patch.priceMin = parsed.priceMin;
    if (parsed.priceMax) patch.priceMax = parsed.priceMax;
    if (parsed.platformsInclude.length > 0) patch.platformsInclude = parsed.platformsInclude;
    if (parsed.platformsExclude.length > 0) patch.platformsExclude = parsed.platformsExclude;
    if (/有货|现货|能买|只看有货/i.test(message)) patch.stockOnly = true;
    if (/急|尽快|马上|及时|今天|明天/i.test(message)) patch.urgentDeliveryPreferred = true;
    if (parsed.timeConstraintDays !== null) patch.timeConstraintDays = parsed.timeConstraintDays;
    if (parsed.color) patch.color = parsed.color;
    if (parsed.brand) patch.brand = parsed.brand;
    if (/便宜|最低价|价格从低|低价/i.test(message)) patch.sortRule = 'price_asc';
    if (/价格从高|贵的优先|最高价/i.test(message)) patch.sortRule = 'price_desc';
    if (/好评|评分|口碑|评价/i.test(message)) patch.sortRule = 'rating_desc';
    if (/送达|到货|物流|最快|明天|今天/i.test(message)) patch.sortRule = 'delivery_asc';
    if (/相似|匹配|准确|最像|相关/i.test(message)) patch.sortRule = 'relevance_desc';

    const referencedCandidate = this.resolveReferencedCandidate(message, context);
    if (referencedCandidate) {
      patch.excludedCandidateItemIds = [referencedCandidate.candidateItemId];
      if (referencedCandidate.productId) patch.excludedProductIds = [referencedCandidate.productId];
    }

    return patch;
  }

  private buildKeywords(
    parsed: {
      category: string;
      brand?: string | null;
      modelLine?: string | null;
      colorFamily?: string | null;
      colorway?: string | null;
      shoeType?: string | null;
    },
    title: string,
  ) {
    return [
      parsed.brand,
      parsed.modelLine,
      parsed.colorway ?? parsed.colorFamily,
      parsed.shoeType,
      title,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
  }

  private extractSortRule(message: string) {
    if (/价格从高|贵的优先|最高价/i.test(message)) return 'price_desc';
    if (/好评|评分|口碑|评价/i.test(message)) return 'rating_desc';
    if (/送达|到货|物流|最快|明天|今天/i.test(message)) return 'delivery_asc';
    if (/便宜|最低价|价格从低|低价/i.test(message)) return 'price_asc';
    return 'relevance_desc';
  }

  private extractPriceMax(message: string): number | null {
    if (/(\d{2,5})\s*(以上|大于|超过|起)/.test(message)) return null;
    const match = message.match(/(\d{2,5})\s*(以内|以下|之内|内)/);
    if (!match) return null;
    return Number(match[1]);
  }

  private extractPriceMin(message: string): number | null {
    const match = message.match(/(\d{2,5})\s*(以上|大于|超过|起)/);
    return match ? Number(match[1]) : null;
  }

  private extractDays(message: string): number | null {
    const match = message.match(/(\d+)\s*天/);
    return match ? Number(match[1]) : null;
  }

  private extractColor(message: string): string | null {
    if (/黑|black/i.test(message)) return 'black';
    if (/白|white/i.test(message)) return 'white';
    if (/灰|gray|grey/i.test(message)) return 'gray';
    if (/蓝|blue/i.test(message)) return 'blue';
    if (/红|red/i.test(message)) return 'red';
    return null;
  }

  private extractColorFamily(text: string): string | null {
    const colors: Array<[string, RegExp]> = [
      ['black', /黑|black/i],
      ['white', /白|white/i],
      ['gray', /灰|gray|grey/i],
      ['blue', /蓝|blue/i],
      ['red', /红|red/i],
    ];
    const hits = colors.filter(([, pattern]) => pattern.test(text)).map(([value]) => value);
    return hits.length > 0 ? hits.join('_') : null;
  }

  private toColorway(colorFamily: string | null) {
    if (!colorFamily) return null;
    return colorFamily
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private extractBrand(message: string): string | null {
    if (/nike|耐克/i.test(message)) return 'Nike';
    if (/adidas|阿迪/i.test(message)) return 'Adidas';
    if (/anta|安踏/i.test(message)) return 'Anta';
    if (/li[- ]?ning|李宁/i.test(message)) return 'Li-Ning';
    return null;
  }

  private extractModelLine(title: string): string | null {
    if (/pegasus|飞马/i.test(title)) return 'Air Zoom Pegasus';
    if (/ultraboost/i.test(title)) return 'Ultraboost';
    if (/clifton/i.test(title)) return 'Clifton';
    if (/vaporfly/i.test(title)) return 'Vaporfly';
    return null;
  }

  private extractIncludedPlatforms(message: string) {
    const platforms: string[] = [];
    if (/淘宝|taobao/i.test(message)) platforms.push('taobao');
    if (/天猫|tmall/i.test(message)) platforms.push('tmall');
    if (/京东|jd/i.test(message)) platforms.push('jd');
    if (/得物|dewu/i.test(message)) platforms.push('dewu');
    if (/拼多多|pdd/i.test(message)) platforms.push('pdd');
    if (/抖音|douyin/i.test(message)) platforms.push('douyin');
    return platforms;
  }

  private extractExcludedPlatforms(message: string) {
    const negativeScope = /不要|不看|排除|别给我|去掉/.test(message);
    if (!negativeScope) return [];
    return this.extractIncludedPlatforms(message);
  }

  private normalize(value: string | null | undefined) {
    return value?.trim().toLowerCase() ?? null;
  }

  private resolveReferencedCandidate(message: string, context: ConversationTurnParseInput) {
    const candidates = context.candidateSummary;
    if (candidates.length === 0) return null;
    if (/第\s*1\s*个|第一个|最前面|第一个太贵|这个太贵|它太贵|不要它|不要这个/.test(message)) {
      return candidates[0];
    }
    const numericMatch = message.match(/第\s*(\d+)\s*个/);
    if (!numericMatch) return null;
    const index = Number(numericMatch[1]) - 1;
    return candidates[index] ?? null;
  }
}
