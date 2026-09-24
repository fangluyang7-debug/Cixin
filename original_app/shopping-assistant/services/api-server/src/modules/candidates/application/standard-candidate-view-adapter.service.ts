import { Injectable } from '@nestjs/common';
import { CandidateItem } from '@prisma/client';
import { normalizeProductCategory } from '../../../common/catalog/product-categories';
import { fromJson } from '../../../common/utils/json';
import { parsePlatformProductReference } from '../../product-pool/application/platform-product-reference';
import { CandidateViewAdapter } from './candidate-view-adapter.interface';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class StandardCandidateViewAdapterService implements CandidateViewAdapter {
  buildCandidateView(item: CandidateItem, sortedItems: CandidateItem[], backendRank: number) {
    const matchSummary = fromJson<JsonRecord>(item.matchSummaryJson, {});
    const normalizedAttributes = fromJson<JsonRecord>(item.normalizedAttributesJson, {});
    const rawPayload = fromJson<JsonRecord>(item.rawPayloadJson, {});
    const urlReference = parsePlatformProductReference(
      item.platformName,
      item.productUrl,
    );
    const commerceMeta = this.buildCommerceMeta(item, rawPayload);
    const priceRank = this.priceRank(item, sortedItems);
    const sortSignals = this.buildSortSignals(item, backendRank, matchSummary, commerceMeta);

    return {
      candidateItemId: item.id,
      rank: item.rank ?? backendRank,
      pageIndex: item.pageIndex,
      title: item.title,
      platformName: item.platformName,
      price: { amount: item.amount, currency: item.currency },
      shopName: item.shopName,
      shopType: item.shopType,
      stockStatus: item.stockStatus,
      coverImageUrl: item.coverImageUrl,
      productUrl: item.productUrl,
      platformProductId:
        urlReference.productId ??
        this.toString(normalizedAttributes.platformProductId),
      platformBrandId:
        urlReference.brandId ??
        this.toString(normalizedAttributes.platformBrandId),
      matchSummary,
      normalizedAttributes,
      commerceMeta,
      sortSignals,
      rawPayload,
      recommendationReason: fromJson<string[]>(item.recommendationReasonJson, []),
      decisionTags: this.buildDecisionTags(item, priceRank, commerceMeta),
      decisionSupport: this.buildDecisionSupport(item, sortedItems, commerceMeta),
    };
  }

  buildCandidateDetailView(item: CandidateItem, sortedItems: CandidateItem[], priceRank: number) {
    const view = this.buildCandidateView(item, sortedItems, priceRank);
    const rawPayload = this.asRecord(view.rawPayload);
    const productRawPayload = this.asRecord(rawPayload.productRawPayload);
    const priceHistory = this.asRecord(productRawPayload.priceHistory);
    return {
      ...view,
      shop: {
        shopName: item.shopName,
        shopType: item.shopType,
      },
      priceHistoryReference:
        Object.keys(priceHistory).length > 0 ? priceHistory : null,
      deliveryEtaReference: this.asRecord(view.commerceMeta).delivery,
    };
  }

  buildAppliedFilterView(appliedFilterJson: string) {
    return fromJson<JsonRecord>(appliedFilterJson, {});
  }

  buildFallbackView(payloadJson: string | null) {
    return (
      fromJson<JsonRecord | null>(payloadJson, null) ?? {
        degraded: true,
        reason: 'UNKNOWN_FALLBACK',
        userMessage: '当前没有拿到真实候选商品，请检查后端检索链路或稍后重试。',
      }
    );
  }

  buildSortOptions() {
    return [
      { code: 'relevance_desc', label: '相似度优先', owner: 'backend', default: true },
      { code: 'price_asc', label: '价格从低到高', owner: 'frontend' },
      { code: 'rating_desc', label: '评分从高到低', owner: 'frontend' },
      { code: 'delivery_asc', label: '送达从快到慢', owner: 'frontend' },
    ];
  }

  buildSearchProgress(items: Array<{ platformName: string; candidateItemId: string }>) {
    const grouped = new Map<string, Array<{ candidateItemId: string }>>();
    for (const item of items) {
      const group = grouped.get(item.platformName) ?? [];
      group.push({ candidateItemId: item.candidateItemId });
      grouped.set(item.platformName, group);
    }

    return {
      mode: 'platform_stream',
      message: '前端可按平台分组逐条展示候选商品，用于承接后端搜索等待时间。',
      platformGroups: [...grouped.entries()].map(([platformName, group]) => ({
        platformName,
        status: 'ready',
        count: group.length,
        itemIds: group.map((item) => item.candidateItemId),
      })),
    };
  }

  buildRequiredInfoView(appliedFilter: Record<string, unknown>) {
    const category = normalizeProductCategory(appliedFilter.categoryScope, 'general');
    if (category !== 'shoe') {
      return {
        category,
        fields: [],
      };
    }
    return {
      category: 'shoe',
      fields: [
        {
          key: 'shoeSize',
          label: '鞋码',
          type: 'select',
          required: false,
          source: 'user_memory_or_manual',
          options: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
        },
      ],
    };
  }

  private buildCommerceMeta(item: CandidateItem, rawPayload: JsonRecord) {
    const productRawPayload = this.asRecord(rawPayload.productRawPayload);
    const shop = this.asRecord(productRawPayload.shop);
    const ratings = this.asRecord(shop.ratings);
    const fulfillment = this.asRecord(productRawPayload.fulfillment);
    const attributes = this.asRecord(productRawPayload.attributes);
    const skuOptions = this.asRecord(productRawPayload.skuOptions);
    const skuMatrix = this.asRecord(productRawPayload.skuMatrix);
    const deliveryTimeText = this.toString(fulfillment.deliveryTimeText);
    const serviceLabels = this.toStringArray(fulfillment.serviceLabels);

    return {
      rating: {
        overall: this.toNumberOrNull(ratings.overall),
        productQuality: this.toNumberOrNull(ratings.productQuality),
        logisticsSpeed: this.toNumberOrNull(ratings.logisticsSpeed),
        service: this.toNumberOrNull(ratings.service),
      },
      delivery: {
        shipFrom: this.toString(fulfillment.shipFrom),
        shipTimeText: this.toString(fulfillment.shipTimeText),
        deliveryTimeText,
        deliveryDays: this.parseDeliveryDays(deliveryTimeText),
        freeShipping: fulfillment.freeShipping === true,
        returnShippingInsurance: fulfillment.returnShippingInsurance === true,
        sevenDayNoReasonReturn: fulfillment.sevenDayNoReasonReturn === true,
        serviceLabels,
      },
      sku: {
        availableSizes: this.resolveAvailableSizes(attributes, skuOptions),
        colorOptions: this.resolveColorOptions(attributes, skuOptions),
        hasSkuMatrix: Object.keys(skuMatrix).length > 0,
      },
      payment: {
        checkoutMode: 'external_link',
        productUrl: item.productUrl,
        supportedMethods: [
          { code: 'alipay', label: '支付宝' },
          { code: 'wechat_pay', label: '微信支付' },
          { code: 'unionpay', label: '银联' },
        ],
      },
    };
  }

  private buildSortSignals(
    item: CandidateItem,
    priceRank: number,
    matchSummary: JsonRecord,
    commerceMeta: ReturnType<StandardCandidateViewAdapterService['buildCommerceMeta']>,
  ) {
    const displayScore = this.toNumberOrNull(matchSummary.displayScore);
    const visualMatchConfidence = this.toNumberOrNull(matchSummary.visualMatchConfidence);
    const annScore = this.toNumberOrNull(matchSummary.annScore);
    const ratingScore = commerceMeta.rating.overall;
    const deliveryDays = commerceMeta.delivery.deliveryDays;

    return {
      backendRank: priceRank,
      priceAmount: Number(item.amount),
      relevanceScore: displayScore ?? visualMatchConfidence ?? annScore ?? null,
      displayScore,
      visualMatchConfidence,
      annScore,
      ratingScore,
      deliveryDays,
      stockRank: item.stockStatus === 'in_stock' ? 1 : item.stockStatus === 'unknown' ? 2 : 3,
    };
  }

  private buildDecisionTags(
    item: CandidateItem,
    priceRank: number,
    commerceMeta: ReturnType<StandardCandidateViewAdapterService['buildCommerceMeta']>,
  ) {
    const tags: Array<{ code: string; label: string }> = [];

    if (priceRank === 1) tags.push({ code: 'LOWEST_PRICE', label: '当前最低价' });
    if (item.stockStatus === 'in_stock') tags.push({ code: 'IN_STOCK', label: '有货' });
    if (item.stockStatus === 'unknown') tags.push({ code: 'STOCK_UNKNOWN', label: '库存待确认' });
    if (item.stockStatus === 'out_of_stock') tags.push({ code: 'OUT_OF_STOCK', label: '当前无货' });
    if (item.shopType === 'flagship') tags.push({ code: 'FLAGSHIP', label: '旗舰店' });
    if ((commerceMeta.rating.overall ?? 0) >= 4.7) tags.push({ code: 'HIGH_RATING', label: '高评分' });
    if ((commerceMeta.delivery.deliveryDays ?? 99) <= 2) tags.push({ code: 'FAST_DELIVERY', label: '送达较快' });
    if (commerceMeta.delivery.freeShipping) tags.push({ code: 'FREE_SHIPPING', label: '包邮' });

    return tags;
  }

  private buildDecisionSupport(
    item: CandidateItem,
    sortedItems: CandidateItem[],
    commerceMeta: ReturnType<StandardCandidateViewAdapterService['buildCommerceMeta']>,
  ) {
    const priceSortedItems = this.sortByPrice(sortedItems);
    const priceRank = priceSortedItems.findIndex((candidate) => candidate.id === item.id) + 1;
    const lowest = priceSortedItems[0] ?? item;
    const priceDelta = Number(item.amount) - Number(lowest.amount);
    const deliveryText = commerceMeta.delivery.deliveryTimeText;
    const availableSizes = commerceMeta.sku.availableSizes;

    return {
      priceRank,
      priceConclusion:
        priceRank === 1 ? '当前候选池最低价。' : `比当前最低价高 ${priceDelta.toFixed(2)} ${item.currency}。`,
      stockConclusion: this.buildStockConclusion(item.stockStatus),
      shopConclusion:
        item.shopType === 'flagship'
          ? '店铺类型为旗舰店，首版可作为更高可信度参考。'
          : '店铺类型不是旗舰店或信息不足，建议结合价格与库存判断。',
      ratingConclusion: commerceMeta.rating.overall
        ? `店铺综合评分 ${commerceMeta.rating.overall.toFixed(1)}。`
        : '暂无稳定评分数据。',
      deliveryConclusion: deliveryText ?? '暂无稳定送达时效数据。',
      sizeConclusion:
        availableSizes.length > 0
          ? `可选鞋码：${availableSizes.join('、')}。`
          : '尺码信息待平台详情页确认。',
      paymentConclusion: item.productUrl
        ? '可跳转商城链接，支付方式在前端先保留支付宝、微信、银联入口。'
        : '暂无可跳转商城链接。',
      priorityReason: this.buildPriorityReason(item, priceRank),
    };
  }

  private buildStockConclusion(stockStatus: string) {
    if (stockStatus === 'in_stock') return '当前标记为有货，适合优先查看。';
    if (stockStatus === 'out_of_stock') return '当前标记为无货，不适合立即下单。';
    return '库存状态未知，建议进入平台后确认。';
  }

  private buildPriorityReason(item: CandidateItem, priceRank: number) {
    if (priceRank === 1 && item.stockStatus === 'in_stock') return '价格最低且有货，当前优先级最高。';
    if (item.stockStatus === 'in_stock') return '当前有货，但价格不是最低。';
    if (priceRank === 1) return '价格最低，但库存状态需要确认。';
    return '可作为备选结果继续比较。';
  }

  private priceRank(item: CandidateItem, items: CandidateItem[]) {
    const sorted = this.sortByPrice(items);
    const rank = sorted.findIndex((candidate) => candidate.id === item.id) + 1;
    return rank > 0 ? rank : 1;
  }

  private sortByPrice(items: CandidateItem[]) {
    return [...items].sort((left, right) => {
      const delta = Number(left.amount) - Number(right.amount);
      if (Number.isFinite(delta) && delta !== 0) return delta;
      return (left.rank ?? 0) - (right.rank ?? 0);
    });
  }

  private resolveAvailableSizes(attributes: JsonRecord, skuOptions: JsonRecord) {
    const attributeSizes = this.toStringArray(attributes.availableSizes);
    if (attributeSizes.length > 0) return attributeSizes;
    const sizes = Array.isArray(skuOptions.sizes) ? skuOptions.sizes : [];
    return sizes
      .map((item) => this.toString(this.asRecord(item).value))
      .filter((item): item is string => Boolean(item));
  }

  private resolveColorOptions(attributes: JsonRecord, skuOptions: JsonRecord) {
    const attributeColors = this.toStringArray(attributes.colorOptions);
    if (attributeColors.length > 0) return attributeColors;
    const styles = Array.isArray(skuOptions.styles) ? skuOptions.styles : [];
    return styles
      .map((item) => this.toString(this.asRecord(item).name))
      .filter((item): item is string => Boolean(item));
  }

  private parseDeliveryDays(value: string | null) {
    if (!value) return null;
    if (/明日|次日|24/.test(value)) return 1;
    const match = value.match(/(\d+)\s*天/);
    return match ? Number(match[1]) : null;
  }

  private asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private toStringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
  }

  private toNumberOrNull(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
