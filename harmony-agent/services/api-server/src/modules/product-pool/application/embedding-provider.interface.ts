export interface EmbeddingResult {
  provider: string;
  modelName: string;
  dimension: number;
  vector: number[];
  vectorHash: string;
}

export interface EmbeddingInput {
  text?: string;
  imageUrl?: string | null;
  imageBase64?: string | null;
  imageContentType?: string | null;
  tags?: Record<string, unknown>;
}

export interface ImageEmbeddingInput {
  imageUrl?: string | null;
  imageBase64?: string | null;
  imageContentType?: string | null;
  textHint?: string;
  tags?: Record<string, unknown>;
}

export interface TextEmbeddingInput {
  text: string;
  tags?: Record<string, unknown>;
}

export interface EmbeddingProvider {
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
  embedImage(input: ImageEmbeddingInput): Promise<EmbeddingResult>;
  embedText(input: TextEmbeddingInput): Promise<EmbeddingResult>;
}
