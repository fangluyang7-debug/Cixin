import { Injectable } from "@nestjs/common";
import { CandidateItem } from "@prisma/client";
import { createId } from "../../../common/utils/id";
import { fromJson } from "../../../common/utils/json";
import {
  displayPlatformLabel,
  normalizePlatformKey,
} from "../../../common/platforms/platform-normalization";
import {
  SmartSuggestionCard,
  SuggestionViewAdapter,
} from "./suggestion-view-adapter.interface";

type JsonRecord = Record<string, unknown>;

@Injectable()
export class StandardSuggestionViewAdapterService implements SuggestionViewAdapter {
  buildSuggestionsView(input: {
    items: CandidateItem[];
    degraded: boolean;
    activeFilter?: Record<string, unknown>;
  }): Record<string, unknown> {
    const activeFilter = input.activeFilter ?? {};
    const inStockCount = input.items.filter(
      (item) => item.stockStatus === "in_stock",
    ).length;
    const unknownStockCount = input.items.filter(
      (item) => item.stockStatus === "unknown",
    ).length;
    const outOfStockCount = input.items.filter(
      (item) => item.stockStatus === "out_of_stock",
    ).length;
    const freeShippingCount = input.items.filter((item) =>
      this.isFreeShipping(item),
    ).length;
    const topCandidate = this.pickTopCandidate(input.items);
    const cards = this.buildSmartCards(input.items, activeFilter);

    return {
      recommendationConclusion:
        topCandidate !== null
          ? `当前建议优先查看 ${topCandidate.title}，理由是${topCandidate.reason}。`
          : "当前候选结果不足，建议重新上传更清晰的鞋图或放宽筛选条件。",
      candidateSummary: {
        totalCount: input.items.length,
        inStockCount,
        unknownStockCount,
        outOfStockCount,
        freeShippingCount,
        degraded: input.degraded,
        lowestPrice: this.lowestPrice(input.items),
      },
      topCandidate,
      cards,
      nextRefineOptions: cards
        .filter(
          (card) =>
            card.action.type === "submit_turn" &&
            typeof card.action.message === "string" &&
            card.action.message.length > 0,
        )
        .map((card) => ({
          title: card.title,
          message: card.action.message,
        })),
    };
  }

  private buildSmartCards(
    items: CandidateItem[],
    activeFilter: Record<string, unknown>,
  ) {
    const cards: SmartSuggestionCard[] = [];
    const seen = new Set<string>();
    const add = (card: SmartSuggestionCard) => {
      const remainingCount = card.preview?.remainingCount ?? items.length;
      if (remainingCount < 2) return;
      const key = [
        card.action.type,
        card.action.message ?? "",
        card.action.field ?? "",
        card.action.candidateItemId ?? "",
      ].join(":");
      if (seen.has(key)) return;
      seen.add(key);
      cards.push(card);
    };

    this.addLowPriceCard(add, items, activeFilter);
    this.addPlatformCards(add, items, activeFilter);
    this.addPriceCards(add, items, activeFilter);
    this.addStockCard(add, items, activeFilter);
    this.addFlagshipCard(add, items, activeFilter);
    this.addDeliveryCard(add, items, activeFilter);
    this.addFreeShippingCard(add, items, activeFilter);
    this.addBrandCard(add, items, activeFilter);
    this.addColorCard(add, items, activeFilter);
    this.addSizeCard(add, items, activeFilter);
    this.addPriceHistoryCard(add, items);
    this.addTrendOutfitCard(add, items);

    return cards
      .sort((left, right) => {
        if (right.priority !== left.priority)
          return right.priority - left.priority;
        return right.confidence - left.confidence;
      })
      .slice(0, 6);
  }

  private addLowPriceCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    if (
      items.length < 3 ||
      this.toString(activeFilter.sortRule) === "price_asc"
    ) {
      return;
    }
    const lowest = this.lowestPrice(items);
    add({
      cardId: createId("card"),
      type: "sort",
      title: "查看同款低价",
      subtitle: lowest ? `最低 ¥${lowest.amount}` : `${items.length} 件候选`,
      reason: "当前候选池已具备价格对比空间。",
      confidence: 0.86,
      priority: this.priority(92, items.length),
      action: {
        type: "submit_turn",
        message: "先看最低价",
        filterPatch: { sortRule: "price_asc" },
      },
      preview: {
        remainingCount: items.length,
        affectedFields: ["sortRule"],
      },
    });
  }

  private addPlatformCards(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    const activePlatforms = this.activePlatforms(activeFilter);
    const groups = new Map<string, CandidateItem[]>();
    for (const item of items) {
      const platform = this.normalizePlatform(item.platformName);
      if (!platform) continue;
      const group = groups.get(platform) ?? [];
      group.push(item);
      groups.set(platform, group);
    }

    for (const [platform, group] of groups) {
      if (group.length < 3 || activePlatforms.includes(platform)) continue;
      const title = `只看${this.displayPlatform(platform)}`;
      add({
        cardId: createId("card"),
        type: "filter",
        title,
        subtitle: `当前有 ${group.length} 件符合`,
        reason: `${this.displayPlatform(platform)}候选数量足够，可减少跨平台比较成本。`,
        confidence: 0.82,
        priority: this.priority(82, group.length),
        action: {
          type: "submit_turn",
          message: title,
          filterPatch: { platformsInclude: [platform] },
        },
        preview: {
          remainingCount: group.length,
          affectedFields: ["platformsInclude"],
        },
      });
    }
  }

  private addPriceCards(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    const activePriceMax = this.toOptionalNumber(activeFilter.priceMax);
    const candidates = [300, 500, 800, 1000]
      .map((threshold) => ({
        threshold,
        count: items.filter((item) => {
          const amount = this.itemPrice(item);
          return Number.isFinite(amount) && amount <= threshold;
        }).length,
      }))
      .filter(({ threshold, count }) => {
        if (count < 3) return false;
        if (activePriceMax !== null && threshold >= activePriceMax)
          return false;
        return true;
      })
      .slice(0, 2);

    for (const { threshold, count } of candidates) {
      add({
        cardId: createId("card"),
        type: "filter",
        title: `只看 ${threshold} 元以下`,
        subtitle: `当前有 ${count} 件符合`,
        reason: "低价区间仍有足够相似商品。",
        confidence: 0.84,
        priority: this.priority(88, count),
        action: {
          type: "submit_turn",
          message: `只看${threshold}元以内`,
          filterPatch: { priceMax: threshold },
        },
        preview: {
          remainingCount: count,
          affectedFields: ["priceMax"],
        },
      });
    }
  }

  private addStockCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    if (activeFilter.stockOnly === true) return;
    const remainingCount = items.filter(
      (item) => item.stockStatus === "in_stock",
    ).length;
    if (remainingCount < 3) return;
    add({
      cardId: createId("card"),
      type: "filter",
      title: "只看有货",
      subtitle: `当前有 ${remainingCount} 件符合`,
      reason: "过滤无货和库存未知商品后仍有足够候选。",
      confidence: 0.86,
      priority: this.priority(86, remainingCount),
      action: {
        type: "submit_turn",
        message: "只看有货",
        filterPatch: { stockOnly: true },
      },
      preview: {
        remainingCount,
        affectedFields: ["stockOnly"],
      },
    });
  }

  private addFlagshipCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    if (this.toString(activeFilter.shopType) === "flagship") return;
    const remainingCount = items.filter(
      (item) => this.normalize(item.shopType) === "flagship",
    ).length;
    if (remainingCount < 2) return;
    add({
      cardId: createId("card"),
      type: "filter",
      title: "只看官方旗舰店",
      subtitle: `当前有 ${remainingCount} 件符合`,
      reason: "旗舰店货源更适合作为购买决策优先项。",
      confidence: 0.81,
      priority: this.priority(84, remainingCount),
      action: {
        type: "submit_turn",
        message: "只看旗舰店",
        filterPatch: { shopType: "flagship" },
      },
      preview: {
        remainingCount,
        affectedFields: ["shopType"],
      },
    });
  }

  private addDeliveryCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    if (this.toString(activeFilter.sortRule) === "delivery_asc") return;
    const remainingCount = items.filter((item) =>
      this.isFastDelivery(item),
    ).length;
    if (remainingCount < 2) return;
    add({
      cardId: createId("card"),
      type: "sort",
      title: "送达最快优先",
      subtitle: `${remainingCount} 件有较快配送信号`,
      reason: "先按配送时效排序，避免误杀可能可买的候选。",
      confidence: 0.75,
      priority: this.priority(76, remainingCount),
      action: {
        type: "submit_turn",
        message: "送达最快优先",
        filterPatch: { sortRule: "delivery_asc" },
      },
      preview: {
        remainingCount: items.length,
        affectedFields: ["sortRule"],
      },
    });
  }

  private addFreeShippingCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    if (activeFilter.freeShippingOnly === true) return;
    const remainingCount = items.filter((item) =>
      this.isFreeShipping(item),
    ).length;
    if (remainingCount < 3) return;
    add({
      cardId: createId("card"),
      type: "filter",
      title: "只看包邮",
      subtitle: `当前有 ${remainingCount} 件符合`,
      reason: "包邮候选数量足够，可以减少到手价不确定性。",
      confidence: 0.76,
      priority: this.priority(74, remainingCount),
      action: {
        type: "submit_turn",
        message: "只看包邮",
        filterPatch: { freeShippingOnly: true },
      },
      preview: {
        remainingCount,
        affectedFields: ["freeShippingOnly"],
      },
    });
  }

  private addBrandCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    if (this.toString(activeFilter.brand)) return;
    const group = this.largestGroup(items, (item) =>
      this.toString(this.normalizedAttributes(item).brand),
    );
    if (!group || group.items.length < 3) return;
    add({
      cardId: createId("card"),
      type: "filter",
      title: `只看 ${group.key}`,
      subtitle: `当前有 ${group.items.length} 件符合`,
      reason: "候选中该品牌占比更高，适合继续收敛。",
      confidence: 0.72,
      priority: this.priority(70, group.items.length),
      action: {
        type: "submit_turn",
        message: `只看${group.key}`,
        filterPatch: { brand: group.key },
      },
      preview: {
        remainingCount: group.items.length,
        affectedFields: ["brand"],
      },
    });
  }

  private addColorCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    if (this.toString(activeFilter.color)) return;
    const group = this.largestGroup(items, (item) =>
      this.normalizeColor(
        this.toString(this.normalizedAttributes(item).colorFamily) ??
          this.toString(this.normalizedAttributes(item).colorway),
      ),
    );
    if (!group || group.items.length < 3) return;
    const display = this.displayColor(group.key);
    add({
      cardId: createId("card"),
      type: "filter",
      title: `筛选：${display}`,
      subtitle: `当前有 ${group.items.length} 件符合`,
      reason: "候选中该颜色信号更集中。",
      confidence: 0.7,
      priority: this.priority(68, group.items.length),
      action: {
        type: "submit_turn",
        message: `只看${display}`,
        filterPatch: { color: group.key },
      },
      preview: {
        remainingCount: group.items.length,
        affectedFields: ["color"],
      },
    });
  }

  private addSizeCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
    activeFilter: JsonRecord,
  ) {
    if (this.toString(activeFilter.size)) return;
    const hasSizeOptions = items.some(
      (item) =>
        this.toStringArray(this.normalizedAttributes(item).availableSizes)
          .length > 0,
    );
    if (!hasSizeOptions || items.length < 2) return;
    add({
      cardId: createId("card"),
      type: "question",
      title: "筛选鞋码",
      subtitle: "选择常穿尺码",
      reason: "部分候选带有尺码信息，确认尺码后可以减少无效跳转。",
      confidence: 0.68,
      priority: this.priority(64, items.length),
      action: {
        type: "open_filter_sheet",
        field: "size",
      },
      preview: {
        remainingCount: items.length,
        affectedFields: ["size"],
      },
    });
  }

  private addPriceHistoryCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
  ) {
    const candidate = items.find((item) => this.hasPriceHistory(item));
    if (!candidate) return;
    add({
      cardId: createId("card"),
      type: "inspect",
      title: "查看历史价格走势",
      subtitle: candidate.title,
      reason: "该候选带有历史价格引用，可进入详情判断当前价位。",
      confidence: 0.78,
      priority: this.priority(72, items.length),
      action: {
        type: "open_price_history",
        candidateItemId: candidate.id,
      },
      preview: {
        remainingCount: 1,
        affectedFields: ["priceHistory"],
      },
    });
  }

  private addTrendOutfitCard(
    add: (card: SmartSuggestionCard) => void,
    items: CandidateItem[],
  ) {
    const candidate = this.pickTopRawCandidate(items);
    if (!candidate) return;
    add({
      cardId: createId("card"),
      type: "recommend",
      title: "相似风格推荐",
      subtitle: candidate.title,
      reason: "基于当前最优候选继续生成穿搭和风格相关商品。",
      confidence: 0.74,
      priority: this.priority(66, items.length),
      action: {
        type: "open_trend_outfit",
        candidateItemId: candidate.id,
      },
      preview: {
        remainingCount: items.length,
        affectedFields: ["candidateItemId"],
      },
    });
  }

  private pickTopCandidate(items: CandidateItem[]) {
    const candidate = this.pickTopRawCandidate(items);
    if (!candidate) return null;
    const reason =
      candidate.stockStatus === "in_stock"
        ? "它在当前结果中价格靠前且标记为有货"
        : "它是当前结果中的低价候选，但库存需要确认";

    return {
      candidateItemId: candidate.id,
      title: candidate.title,
      platformName: candidate.platformName,
      price: {
        amount: candidate.amount,
        currency: candidate.currency,
      },
      stockStatus: candidate.stockStatus,
      reason,
    };
  }

  private pickTopRawCandidate(items: CandidateItem[]) {
    if (items.length === 0) return null;
    const ranked = [...items].sort((left, right) => {
      const rankDelta = (left.rank ?? 9999) - (right.rank ?? 9999);
      if (rankDelta !== 0) return rankDelta;
      return this.itemPrice(left) - this.itemPrice(right);
    });
    return (
      ranked.find((item) => item.stockStatus === "in_stock") ??
      ranked[0] ??
      null
    );
  }

  private lowestPrice(items: CandidateItem[]) {
    const sorted = [...items].sort(
      (left, right) => this.itemPrice(left) - this.itemPrice(right),
    );
    const lowest = sorted.find((item) => Number.isFinite(this.itemPrice(item)));
    return lowest
      ? {
          amount: lowest.amount,
          currency: lowest.currency,
        }
      : null;
  }

  private activePlatforms(activeFilter: JsonRecord) {
    return [
      ...this.toStringArray(activeFilter.platformsInclude),
      this.toString(activeFilter.platform),
    ]
      .filter((item): item is string => Boolean(item))
      .map((item) => this.normalizePlatform(item))
      .filter((item): item is string => Boolean(item));
  }

  private largestGroup(
    items: CandidateItem[],
    keyForItem: (item: CandidateItem) => string | null,
  ) {
    const groups = new Map<string, CandidateItem[]>();
    for (const item of items) {
      const key = keyForItem(item);
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    return (
      [...groups.entries()]
        .map(([key, groupItems]) => ({ key, items: groupItems }))
        .sort((left, right) => right.items.length - left.items.length)[0] ??
      null
    );
  }

  private productRawPayload(item: CandidateItem) {
    const raw = fromJson<JsonRecord>(item.rawPayloadJson, {});
    const productRawPayload = this.asRecord(raw.productRawPayload);
    return Object.keys(productRawPayload).length > 0 ? productRawPayload : raw;
  }

  private normalizedAttributes(item: CandidateItem) {
    return fromJson<JsonRecord>(item.normalizedAttributesJson, {});
  }

  private fulfillment(item: CandidateItem) {
    return this.asRecord(this.productRawPayload(item).fulfillment);
  }

  private isFreeShipping(item: CandidateItem) {
    return this.fulfillment(item).freeShipping === true;
  }

  private isFastDelivery(item: CandidateItem) {
    const fulfillment = this.fulfillment(item);
    const text = [
      this.toString(fulfillment.deliveryTimeText),
      this.toString(fulfillment.shipTimeText),
      ...this.toStringArray(fulfillment.serviceLabels),
    ]
      .filter(Boolean)
      .join(" ");
    return /次日|明日|24\s*小时|24小时|1\s*天|一天/i.test(text);
  }

  private hasPriceHistory(item: CandidateItem) {
    const priceHistory = this.asRecord(
      this.productRawPayload(item).priceHistory,
    );
    const points = Array.isArray(priceHistory.points)
      ? priceHistory.points
      : [];
    return points.length >= 2 || Object.keys(priceHistory).length > 1;
  }

  private itemPrice(item: CandidateItem) {
    const price = Number(item.amount);
    return Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
  }

  private priority(base: number, remainingCount: number) {
    return Math.min(99, base + Math.min(remainingCount, 12));
  }

  private normalizePlatform(value: string | null | undefined) {
    return normalizePlatformKey(value) ?? this.normalize(value);
  }

  private displayPlatform(platform: string) {
    return displayPlatformLabel(platform);
  }

  private normalizeColor(value: string | null) {
    const normalized = this.normalize(value);
    if (!normalized) return null;
    if (/黑白|black.*white|white.*black/.test(normalized)) return "black_white";
    if (/白|white/.test(normalized)) return "white";
    if (/黑|black/.test(normalized)) return "black";
    if (/灰|gray|grey/.test(normalized)) return "gray";
    if (/蓝|blue/.test(normalized)) return "blue";
    if (/红|red/.test(normalized)) return "red";
    if (/绿|green/.test(normalized)) return "green";
    if (/棕|brown/.test(normalized)) return "brown";
    return normalized;
  }

  private displayColor(color: string) {
    const labels: Record<string, string> = {
      black_white: "黑白色",
      white: "白色",
      black: "黑色",
      gray: "灰色",
      blue: "蓝色",
      red: "红色",
      green: "绿色",
      brown: "棕色",
    };
    return labels[color] ?? color;
  }

  private toString(value: unknown) {
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private toStringArray(value: unknown) {
    return Array.isArray(value)
      ? value
          .map((item) => this.toString(item))
          .filter((item): item is string => item !== null)
      : [];
  }

  private toOptionalNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalize(value?: string | null) {
    return value?.trim().toLowerCase() ?? null;
  }

  private asRecord(value: unknown): JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  }
}
