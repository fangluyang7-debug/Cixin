export type ProductPlatform =
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

export type ProductStockStatus = 'in_stock' | 'out_of_stock' | 'unknown';

export interface ProductImportItemDto {
  externalId?: string;
  platform: ProductPlatform;
  title: string;
  price: string;
  currency: string;
  stockStatus: ProductStockStatus;
  shopName?: string;
  shopType?: string;
  productUrl: string;
  imageUrl?: string;
  localImagePath?: string;
  imageDataBase64?: string;
  imageContentType?: string;
  brandHint?: string;
  categoryHint?: string;
  rawPayload?: Record<string, unknown>;
}

export interface ImportProductsDto {
  batchSource: string;
  items: ProductImportItemDto[];
}

export const PRODUCT_PLATFORMS: ProductPlatform[] = [
  'taobao',
  'tmall',
  'jd',
  'vipshop',
  'suning',
  'dewu',
  'pdd',
  'douyin',
  'xianyu',
  'manual',
];

export const PRODUCT_STOCK_STATUSES: ProductStockStatus[] = [
  'in_stock',
  'out_of_stock',
  'unknown',
];
