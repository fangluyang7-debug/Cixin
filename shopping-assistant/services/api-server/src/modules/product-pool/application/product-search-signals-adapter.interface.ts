import { Product } from '@prisma/client';

export const PRODUCT_SEARCH_SIGNALS_ADAPTER = Symbol(
  'PRODUCT_SEARCH_SIGNALS_ADAPTER',
);

export interface ProductSearchPriceStats {
  min: number;
  max: number;
}

export interface ProductSearchSignals {
  businessScore: number;
  ratingScore: number;
  deliveryDays: number;
}

export interface ProductSearchSignalsAdapter {
  deriveSignals(
    product: Product,
    priceStats: ProductSearchPriceStats,
  ): ProductSearchSignals;
}
