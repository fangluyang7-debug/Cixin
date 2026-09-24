import { ContentSearchResult } from '../../../adapters/content-search/content-search-provider.interface';

export interface TrendOutfitBaseProductInput {
  productId: string;
  title: string;
  category: string;
  brand?: string | null;
  color?: string | null;
  styleTags?: string[];
  sceneTags?: string[];
  price?: number | null;
}

export interface TrendOutfitBaseProduct {
  productId: string;
  title: string;
  normalizedTitle: string;
  category: string;
  brand: string | null;
  color: string | null;
  styleTags: string[];
  sceneTags: string[];
  price: number | null;
}

export interface TrendOutfitCandidate {
  targetCategory: string;
  displayCategory: string;
  keywords: string[];
  styleTags: string[];
  sceneTags: string[];
  confidence: number;
  reason: string;
}

export interface TrendEvidenceSource {
  title: string;
  snippet: string;
  url: string;
  source: string;
}

export interface TrendOutfitExtractionInput {
  baseProduct: TrendOutfitBaseProduct;
  searchResults: ContentSearchResult[];
}

export interface TrendOutfitExtractionResult {
  trendSummary: string;
  outfitCandidates: TrendOutfitCandidate[];
  evidenceSources: TrendEvidenceSource[];
}

export interface TrendOutfitRecommendation {
  productId: string;
  title: string;
  category: string;
  price: number;
  imageUrl: string;
  productUrl: string;
  reason: string;
  matchedTrend: TrendOutfitCandidate;
}

export interface TrendOutfitResponse {
  baseProduct: TrendOutfitBaseProduct;
  trendSummary: string;
  outfitAdvice: string[];
  recommendations: TrendOutfitRecommendation[];
  evidenceSources: TrendEvidenceSource[];
  fallback: boolean;
  debug?: {
    searchProvider: string;
    attemptedProviders: string[];
    providerResultCounts: Record<string, number>;
    queries: string[];
    searchResultCount: number;
    searchResultsPreview: TrendEvidenceSource[];
  };
}
