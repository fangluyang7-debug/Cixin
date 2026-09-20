import { NormalizedSubjectBox } from './query-image-preprocess-adapter.interface';

export const QUERY_IMAGE_CONTENT_ADAPTER = Symbol('QUERY_IMAGE_CONTENT_ADAPTER');

export interface QueryImageMetadata {
  width?: number | null;
  height?: number | null;
  format?: string | null;
}

export interface QueryImageCropResult {
  buffer: Buffer;
  metadata: {
    width: number;
    height: number;
    format: string | null;
  };
  cropRegionPx: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  strategy: string;
}

export interface QueryImageContentAdapter {
  readMetadata(signedUrl: string): Promise<QueryImageMetadata>;
  cropForEmbedding(input: {
    signedUrl: string;
    box: NormalizedSubjectBox;
    paddingRatio: number;
    targetSize: number;
    jpegQuality: number;
  }): Promise<QueryImageCropResult>;
}
