export const PRODUCT_IMAGE_CONTENT_ADAPTER = Symbol(
  'PRODUCT_IMAGE_CONTENT_ADAPTER',
);

export interface ProductImageContent {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

export interface ProductImageContentInput {
  imageDataBase64?: string | null;
  localImagePath?: string | null;
  imageUrl?: string | null;
  contentType?: string | null;
  filename: string;
}

export interface ProductImageContentAdapter {
  loadImageContent(
    input: ProductImageContentInput,
  ): Promise<ProductImageContent | null>;
}
