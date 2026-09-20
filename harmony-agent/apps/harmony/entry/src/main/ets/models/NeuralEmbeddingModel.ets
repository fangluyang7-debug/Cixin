export interface NeuralValidationQuery {
  text: string;
  tokenIds: number[];
  embedding: number[];
}

export interface NeuralEmbeddingArtifact {
  formatVersion: number;
  modelId: string;
  modelVersion: string;
  modelFile: string;
  encoderType: string;
  teacherModelVersion: string;
  trainingSeed: number;
  productCount: number;
  vocabularySize: number;
  sequenceLength: number;
  hiddenDimension: number;
  embeddingDimension: number;
  supportedDimensions: number[];
  corpusSha256: string;
  vocabulary: string[];
  productExternalIds: string[];
  productScales: number[];
  quantizedProductVectorsBase64: string;
  validationQueries: NeuralValidationQuery[];
}
