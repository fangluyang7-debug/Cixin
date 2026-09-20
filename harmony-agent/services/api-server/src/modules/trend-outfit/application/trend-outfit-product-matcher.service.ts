import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CandidateItem, Product } from '@prisma/client';
import { stableHash } from '../../../cache/cache-key.util';
import { fromJson } from '../../../common/utils/json';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import {
  TrendOutfitBaseProduct,
  TrendOutfitBaseProductInput,
  TrendOutfitCandidate,
  TrendOutfitRecommendation,
} from './trend-outfit.types';

interface ProductMatchSignals {
  categoryScore: number;
  keywordScore: number;
  styleScore: number;
  sceneScore: number;
  priceScore: number;
  stockScore: number;
  hitTerms: string[];
  relaxed: boolean;
}

interface ScoredProduct {
  product: Product;
  trend: TrendOutfitCandidate;
  score: number;
  signals: ProductMatchSignals;
}

@Injectable()
export class TrendOutfitProductMatcherService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveBaseProductFromCandidateItem(input: {
    sessionId: string;
    candidateItemId: string;
  }): Promise<TrendOutfitBaseProductInput> {
    const candidateItemId = this.toString(input.candidateItemId);
    if (!candidateItemId) {
      throw new BadRequestException('TREND_OUTFIT_CANDIDATE_ITEM_ID_REQUIRED');
    }

    const item = await this.prisma.candidateItem.findFirst({
      where: {
        id: candidateItemId,
        snapshot: { sessionId: input.sessionId },
      },
    });
    if (!item) throw new NotFoundException('CANDIDATE_ITEM_NOT_FOUND');

    const rawPayload = fromJson<Record<string, unknown>>(item.rawPayloadJson, {});
    const normalizedAttributes = fromJson<Record<string, unknown>>(
      item.normalizedAttributesJson,
      {},
    );
    const productPoolSource = this.asRecord(rawPayload.productPoolSource);
    const productId =
      this.toString(productPoolSource.productId) ??
      this.toString(normalizedAttributes.productId);
    if (productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
      });
      if (product) return this.toBaseProductInputFromProduct(product);
    }

    return this.toBaseProductInputFromCandidate(item, rawPayload, normalizedAttributes);
  }

  async getProductPoolVersion() {
    const [count, latest] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.findFirst({
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    return stableHash({
      count,
      latestUpdatedAt: latest?.updatedAt.toISOString() ?? null,
    });
  }

  async matchProducts(input: {
    baseProduct: TrendOutfitBaseProduct;
    outfitCandidates: TrendOutfitCandidate[];
    limit: number;
  }): Promise<TrendOutfitRecommendation[]> {
    const products = await this.prisma.product.findMany({
      where: {
        id: { not: input.baseProduct.productId },
        tagStatus: { in: ['verified', 'review_needed'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    });

    const strictMatches = this.scoreProducts({
      products,
      baseProduct: input.baseProduct,
      outfitCandidates: input.outfitCandidates,
      relaxed: false,
    });
    const strictIds = new Set(strictMatches.map((match) => match.product.id));
    const relaxedMatches =
      strictMatches.length >= input.limit
        ? []
        : this.scoreProducts({
            products: products.filter((product) => !strictIds.has(product.id)),
            baseProduct: input.baseProduct,
            outfitCandidates: input.outfitCandidates,
            relaxed: true,
          });
    const primaryMatches = [...strictMatches, ...relaxedMatches];

    return primaryMatches
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit)
      .map((match) => this.toRecommendation(match));
  }

  private scoreProducts(input: {
    products: Product[];
    baseProduct: TrendOutfitBaseProduct;
    outfitCandidates: TrendOutfitCandidate[];
    relaxed: boolean;
  }) {
    const bestByProduct = new Map<string, ScoredProduct>();
    for (const product of input.products) {
      if (this.isSameBaseProduct(product, input.baseProduct)) continue;

      for (const trend of input.outfitCandidates) {
        if (this.isSameCategoryAsBase(product, input.baseProduct)) {
          continue;
        }
        const scored = this.scoreProductForTrend({
          product,
          trend,
          baseProduct: input.baseProduct,
          relaxed: input.relaxed,
        });
        if (!scored) continue;

        const existing = bestByProduct.get(product.id);
        if (!existing || scored.score > existing.score) {
          bestByProduct.set(product.id, scored);
        }
      }
    }

    const minScore = input.relaxed ? 0.14 : 0.2;
    return [...bestByProduct.values()]
      .filter((match) => match.score >= minScore)
      .sort((a, b) => b.score - a.score);
  }

  private scoreProductForTrend(input: {
    product: Product;
    trend: TrendOutfitCandidate;
    baseProduct: TrendOutfitBaseProduct;
    relaxed: boolean;
  }): ScoredProduct | null {
    const productTokens = this.productTokens(input.product);
    const categoryScore = this.categoryScore(input.product, input.trend, productTokens);
    if (!input.relaxed && this.hasCategorySignal(input.trend) && categoryScore <= 0) {
      return null;
    }

    const keywordResult = this.overlapScore(input.trend.keywords, productTokens.searchText);
    const styleResult = this.overlapScore(input.trend.styleTags, productTokens.searchText);
    const sceneResult = this.overlapScore(input.trend.sceneTags, productTokens.searchText);
    if (
      input.relaxed &&
      keywordResult.score <= 0 &&
      styleResult.score <= 0 &&
      sceneResult.score <= 0
    ) {
      return null;
    }

    const priceScore = this.priceScore(input.product, input.baseProduct);
    const stockScore = this.stockScore(input.product.stockStatus);
    const score =
      categoryScore * 0.22 +
      keywordResult.score * 0.32 +
      styleResult.score * 0.12 +
      sceneResult.score * 0.08 +
      priceScore +
      stockScore +
      this.clamp01(input.trend.confidence) * 0.12;

    return {
      product: input.product,
      trend: input.trend,
      score: Number(this.clamp01(score).toFixed(6)),
      signals: {
        categoryScore,
        keywordScore: keywordResult.score,
        styleScore: styleResult.score,
        sceneScore: sceneResult.score,
        priceScore,
        stockScore,
        hitTerms: [
          ...keywordResult.hits,
          ...styleResult.hits,
          ...sceneResult.hits,
        ],
        relaxed: input.relaxed,
      },
    };
  }

  private toRecommendation(match: ScoredProduct): TrendOutfitRecommendation {
    const price = this.toNumber(match.product.priceAmount) ?? 0;
    const hitTerms = [...new Set(match.signals.hitTerms)].slice(0, 4);
    const hitText = hitTerms.length > 0 ? hitTerms.join('、') : match.trend.displayCategory;
    return {
      productId: match.product.id,
      title: match.product.title,
      category: match.product.category ?? '',
      price,
      imageUrl: match.product.imagePublicUrl ?? match.product.sourceImageUrl ?? '',
      productUrl: match.product.productUrl,
      reason: [
        `匹配趋势搭配「${match.trend.displayCategory}」`,
        `命中 ${hitText}`,
        match.signals.relaxed ? '已放宽类目限制' : null,
        match.product.stockStatus === 'in_stock' ? '当前有货' : null,
      ]
        .filter((item): item is string => Boolean(item))
        .join('；'),
      matchedTrend: match.trend,
    };
  }

  private toBaseProductInputFromProduct(product: Product): TrendOutfitBaseProductInput {
    const rawPayload = fromJson<Record<string, unknown>>(product.rawPayloadJson, {});
    const normalizedTags = fromJson<Record<string, unknown>>(
      product.normalizedTagsJson,
      {},
    );
    const attributes = this.asRecord(rawPayload.attributes);
    return {
      productId: product.id,
      title: product.title,
      category:
        product.category ??
        this.toString(normalizedTags.category) ??
        this.toString(attributes.category) ??
        'shoe',
      brand:
        product.brand ??
        this.toString(normalizedTags.brand) ??
        this.toString(attributes.brand),
      color:
        product.colorFamily ??
        product.colorway ??
        this.toString(normalizedTags.colorFamily) ??
        this.toString(attributes.color),
      styleTags: this.collectStringArrays(
        normalizedTags.styleTags,
        attributes.styleTags,
        rawPayload.styleTags,
      ),
      sceneTags: this.collectStringArrays(
        normalizedTags.sceneTags,
        attributes.sceneTags,
        rawPayload.sceneTags,
      ),
      price: this.toNumber(product.priceAmount),
    };
  }

  private toBaseProductInputFromCandidate(
    item: CandidateItem,
    rawPayload: Record<string, unknown>,
    normalizedAttributes: Record<string, unknown>,
  ): TrendOutfitBaseProductInput {
    const productRawPayload = this.asRecord(rawPayload.productRawPayload);
    const attributes = this.asRecord(productRawPayload.attributes);
    return {
      productId:
        this.toString(normalizedAttributes.productId) ??
        this.toString(this.asRecord(rawPayload.productPoolSource).productId) ??
        item.id,
      title: item.title,
      category:
        this.toString(normalizedAttributes.category) ??
        this.toString(attributes.category) ??
        'shoe',
      brand:
        this.toString(normalizedAttributes.brand) ??
        this.toString(attributes.brand) ??
        null,
      color:
        this.toString(normalizedAttributes.colorFamily) ??
        this.toString(normalizedAttributes.colorway) ??
        this.toString(attributes.color) ??
        null,
      styleTags: this.collectStringArrays(
        normalizedAttributes.styleTags,
        attributes.styleTags,
        productRawPayload.styleTags,
      ),
      sceneTags: this.collectStringArrays(
        normalizedAttributes.sceneTags,
        attributes.sceneTags,
        productRawPayload.sceneTags,
      ),
      price: this.toNumber(item.amount),
    };
  }

  private productTokens(product: Product) {
    const rawPayload = fromJson<Record<string, unknown>>(product.rawPayloadJson, {});
    const normalizedTags = fromJson<Record<string, unknown>>(
      product.normalizedTagsJson,
      {},
    );
    const attributes = this.asRecord(rawPayload.attributes);
    const keywords = fromJson<string[]>(product.keywordsJson, []);
    const tokenParts = [
      product.title,
      product.category,
      product.brand,
      product.modelLine,
      product.colorFamily,
      product.colorway,
      product.shoeType,
      ...keywords,
      ...this.collectStringArrays(
        normalizedTags.styleTags,
        normalizedTags.sceneTags,
        attributes.styleTags,
        attributes.sceneTags,
        attributes.category,
        attributes.material,
        attributes.upperMaterial,
        attributes.scene,
      ),
    ];

    return {
      category: this.normalizeTerm(product.category),
      searchText: tokenParts
        .map((part) => this.normalizeTerm(part))
        .filter(Boolean)
        .join(' '),
    };
  }

  private categoryScore(
    product: Product,
    trend: TrendOutfitCandidate,
    productTokens: ReturnType<TrendOutfitProductMatcherService['productTokens']>,
  ) {
    const targetTerms = this.categoryTerms(trend);
    if (targetTerms.length === 0) return 0.2;

    for (const term of targetTerms) {
      if (productTokens.category && productTokens.category === term) return 1;
      if (productTokens.category && productTokens.category.includes(term)) return 0.85;
      if (productTokens.searchText.includes(term)) return 0.55;
    }

    const productCategory = this.normalizeTerm(product.category);
    if (productCategory && targetTerms.some((term) => term.includes(productCategory))) {
      return 0.45;
    }
    return 0;
  }

  private categoryTerms(trend: TrendOutfitCandidate) {
    return [
      trend.targetCategory,
      trend.displayCategory,
      ...trend.displayCategory.split(/[\/,，、\s]+/g),
    ]
      .map((term) => this.normalizeTerm(term))
      .filter((term): term is string => Boolean(term));
  }

  private hasCategorySignal(trend: TrendOutfitCandidate) {
    return this.categoryTerms(trend).length > 0;
  }

  private overlapScore(terms: string[], searchText: string) {
    const normalizedTerms = terms
      .map((term) => this.normalizeTerm(term))
      .filter((term): term is string => Boolean(term));
    if (normalizedTerms.length === 0) return { score: 0, hits: [] as string[] };

    const hits = normalizedTerms.filter((term) => searchText.includes(term));
    const denominator = Math.min(4, normalizedTerms.length);
    return {
      score: denominator > 0 ? Math.min(1, hits.length / denominator) : 0,
      hits,
    };
  }

  private priceScore(product: Product, baseProduct: TrendOutfitBaseProduct) {
    const price = this.toNumber(product.priceAmount);
    if (price === null) return 0.03;
    if (baseProduct.price === null || baseProduct.price <= 0) return 0.06;
    if (price <= baseProduct.price * 0.7) return 0.12;
    if (price <= baseProduct.price * 1.2) return 0.09;
    if (price <= baseProduct.price * 2) return 0.05;
    return 0.02;
  }

  private stockScore(stockStatus: string) {
    if (stockStatus === 'in_stock') return 0.12;
    if (stockStatus === 'unknown') return 0.04;
    return 0;
  }

  private isSameBaseProduct(product: Product, baseProduct: TrendOutfitBaseProduct) {
    return product.id === baseProduct.productId;
  }

  private isSameCategoryAsBase(
    product: Product,
    baseProduct: TrendOutfitBaseProduct,
  ) {
    const productCategory = this.normalizeTerm(product.category);
    const baseCategory = this.normalizeTerm(baseProduct.category);
    return Boolean(productCategory && baseCategory && productCategory === baseCategory);
  }

  private collectStringArrays(...values: unknown[]) {
    return [
      ...new Set(
        values.flatMap((value) => {
          if (Array.isArray(value)) {
            return value.filter(
              (item): item is string =>
                typeof item === 'string' && item.trim().length > 0,
            );
          }
          const single = this.toString(value);
          return single ? [single] : [];
        }),
      ),
    ];
  }

  private normalizeTerm(value: unknown) {
    return typeof value === 'string'
      ? value.trim().toLowerCase().replace(/\s+/g, '')
      : '';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private toNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const normalized = value.replace(/[^\d.]/g, '');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private clamp01(value: number) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
}
