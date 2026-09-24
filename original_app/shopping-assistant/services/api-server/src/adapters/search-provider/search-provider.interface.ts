import { ProductProfileResult } from "../model/model-adapter.interface";

export const SEARCH_PROVIDER = Symbol("SEARCH_PROVIDER");

export const PRODUCT_SEARCH_PIPELINE_MODES = [
  "current_ann_then_refine",
  "light_tag_ann_fusion",
] as const;

export type ProductSearchPipelineMode =
  (typeof PRODUCT_SEARCH_PIPELINE_MODES)[number];

export interface CandidateSeed {
  title: string;
  platformName: string;
  amount: string;
  currency: string;
  shopName: string;
  shopType: string;
  stockStatus: "in_stock" | "out_of_stock" | "unknown";
  coverImageUrl: string;
  productUrl: string;
  matchSummary: Record<string, unknown>;
  normalizedAttributes: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  recommendationReason: string[];
  productPoolKey?: string | null;
}

export interface SearchMoreInput {
  keywords: string[];
  filters?: Record<string, unknown>;
  profile?: ProductProfileResult | null;
  queryEmbedding: number[];
  queryImageUrl?: string | null;
  embeddingKind?: "visual" | "multimodal";
  excludeProductKeys: string[];
  limit: number;
}

export interface FastAnnSearchInput {
  keywords: string[];
  filters?: Record<string, unknown>;
  profile?: ProductProfileResult | null;
  queryEmbedding: number[];
  queryImageUrl?: string | null;
  assetId?: string;
  category?: string | null;
  embeddingKind?: "visual" | "multimodal";
  excludeProductKeys?: string[];
  limit?: number;
}

export interface SearchProvider {
  searchShoes(input: {
    keywords: string[];
    filters?: Record<string, unknown>;
    profile?: ProductProfileResult | null;
    queryEmbedding?: number[];
    queryImageUrl?: string | null;
    assetId?: string;
    embeddingKind?: "visual" | "multimodal";
    limit?: number;
  }): Promise<CandidateSeed[]>;
  searchFastAnnShoes?(input: FastAnnSearchInput): Promise<CandidateSeed[]>;
  searchMoreShoes?(input: SearchMoreInput): Promise<CandidateSeed[]>;
}
