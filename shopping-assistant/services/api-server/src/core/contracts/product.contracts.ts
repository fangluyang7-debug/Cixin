import { ImageObjectRef } from './image.contracts';

export type MarketplacePlatform =
  | 'taobao'
  | 'tmall'
  | 'jd'
  | 'vipshop'
  | 'suning'
  | 'dewu'
  | 'pdd'
  | 'douyin'
  | 'xianyu'
  | 'manual';

export type StockStatus = 'in_stock' | 'out_of_stock' | 'unknown';

export type ProductDataQuality = {
  hasValidProductUrl: boolean;
  hasValidImageUrl: boolean;
  hasSkuDetail: boolean;
  hasServiceDetail: boolean;
  hasParameterDetail: boolean;
  sourceCompleteness: 'list_only' | 'detail_partial' | 'detail_full' | 'manual';
  warnings: string[];
};

export type ProductImportItemV1 = {
  externalId?: string | null;
  platform: MarketplacePlatform;
  title: string;
  price: string;
  currency?: 'CNY';
  stockStatus: StockStatus;
  productUrl: string;
  images: {
    mainImageUrl: string;
    mainImageRef?: ImageObjectRef | null;
    styleImageUrls?: string[];
  };
  shop?: {
    name?: string | null;
    type?: string | null;
    rating?: string | null;
  };
  brandHint?: string | null;
  parameters?: Record<string, string | string[] | null>;
  service?: Record<string, string | boolean | null>;
  sku?: {
    styles?: Array<{
      styleId?: string | null;
      name: string;
      imageUrl?: string | null;
    }>;
    sizes?: string[];
    priceMatrix?: Array<{
      styleName: string;
      size: string;
      price?: string | null;
      stockStatus?: StockStatus;
    }>;
  };
  dataQuality?: ProductDataQuality;
  rawPayload?: Record<string, unknown>;
};

export type ProductImportBatchContract = {
  batchSource: string;
  schemaVersion: 'product_import_v1';
  items: ProductImportItemV1[];
  rawPayload?: Record<string, unknown>;
};

export type ProductProfileContract = {
  category: 'shoe' | string;
  brand?: string | null;
  modelLine?: string | null;
  colorFamily?: string | null;
  colorway?: string | null;
  shoeType?: string | null;
  size?: string | null;
  styleTags: string[];
  sceneTags: string[];
  keywords: string[];
  confidence: number;
  schemaVersion: string;
  raw?: Record<string, unknown>;
};
