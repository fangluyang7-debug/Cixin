import { Injectable } from '@nestjs/common';
import { Product } from '@prisma/client';
import { fromJson } from '../../../common/utils/json';
import {
  ProductSearchPriceStats,
  ProductSearchSignals,
  ProductSearchSignalsAdapter,
} from './product-search-signals-adapter.interface';

@Injectable()
export class StandardProductSearchSignalsAdapterService
  implements ProductSearchSignalsAdapter
{
  deriveSignals(
    product: Product,
    priceStats: ProductSearchPriceStats,
  ): ProductSearchSignals {
    return {
      businessScore: this.scoreBusiness(product, priceStats),
      ratingScore: this.ratingScore(product),
      deliveryDays: this.deliveryDays(product),
    };
  }

  private scoreBusiness(product: Product, priceStats: ProductSearchPriceStats) {
    const amount = Number(product.priceAmount);
    const priceScore =
      Number.isFinite(amount) &&
      Number.isFinite(priceStats.min) &&
      priceStats.max > priceStats.min
        ? 1 - (amount - priceStats.min) / (priceStats.max - priceStats.min)
        : 0.5;
    const stockScore =
      product.stockStatus === 'in_stock'
        ? 1
        : product.stockStatus === 'unknown'
          ? 0.45
          : 0;
    const shopScore = /flagship|official|旗舰|官方/i.test(
      product.shopType ?? product.shopName ?? '',
    )
      ? 1
      : 0.5;
    return Number(
      this.clamp01(priceScore * 0.35 + stockScore * 0.45 + shopScore * 0.2)
        .toFixed(6),
    );
  }

  private ratingScore(product: Product) {
    const rawPayload = fromJson<Record<string, unknown>>(
      product.rawPayloadJson,
      {},
    );
    const shop = this.asRecord(rawPayload.shop);
    const ratings = this.asRecord(shop.ratings);
    return this.toOptionalNumber(ratings.overall) ?? 0;
  }

  private deliveryDays(product: Product) {
    const rawPayload = fromJson<Record<string, unknown>>(
      product.rawPayloadJson,
      {},
    );
    const fulfillment = this.asRecord(rawPayload.fulfillment);
    const text = this.toString(fulfillment.deliveryTimeText);
    if (!text) return 99;
    if (/明日|次日|24/.test(text)) return 1;
    const match = text.match(/(\d+)\s*天/);
    return match ? Number(match[1]) : 99;
  }

  private toOptionalNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private clamp01(value: number) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
}
