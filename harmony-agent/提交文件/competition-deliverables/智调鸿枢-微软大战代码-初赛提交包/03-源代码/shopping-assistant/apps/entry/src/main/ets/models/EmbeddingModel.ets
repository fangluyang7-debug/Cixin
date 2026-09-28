import { Product } from './Product';

export interface LsaEmbeddingArtifact {
  formatVersion: number;
  modelId: string;
  modelVersion: string;
  encoderType: string;
  trainingSeed: number;
  productCount: number;
  vocabularySize: number;
  embeddingDimension: number;
  supportedDimensions: number[];
  corpusSha256: string;
  explainedVarianceRatio: number;
  vocabulary: string[];
  idf: number[];
  componentScales: number[];
  quantizedComponentsBase64: string;
  productExternalIds: string[];
  productScales: number[];
  quantizedProductVectorsBase64: string;
}

export interface ProductEmbeddingSeed {
  productId: number;
  modelVersion: string;
  dimension: number;
  vector: Uint8Array;
  vectorScale: number;
}

export interface EmbeddingSearchResult {
  product: Product;
  score: number;
}

export interface EmbeddingModelInfo {
  modelId: string;
  modelVersion: string;
  encoderType: string;
  vocabularySize: number;
  embeddingDimension: number;
  productCount: number;
  corpusSha256: string;
  explainedVarianceRatio: number;
}
