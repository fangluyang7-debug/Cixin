export const PRODUCT_RAW_PAYLOAD_ADAPTER = Symbol(
  'PRODUCT_RAW_PAYLOAD_ADAPTER',
);

export interface ProductStyleImageInput {
  styleId: string | null;
  styleName: string | null;
  imageUrl: string;
}

export interface ProductAttributeView {
  brand: string | null;
  modelLine: string | null;
  shoeType: string | null;
  upperMaterial: string | null;
  soleMaterial: string | null;
  availableSizes: unknown[];
  colorOptions: unknown[];
  ratingOverall: number | null;
  deliveryTimeText: string | null;
}

export interface ProductRawPayloadAdapter {
  extractStyleImages(
    rawPayload?: Record<string, unknown>,
  ): ProductStyleImageInput[];
  extractStyleImagesFromJson(rawPayloadJson: string): ProductStyleImageInput[];
  buildAttributeView(rawPayloadJson: string): ProductAttributeView;
}
