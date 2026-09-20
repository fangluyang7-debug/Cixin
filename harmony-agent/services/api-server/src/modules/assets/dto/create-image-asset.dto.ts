export class CreateImageAssetDto {
  assetGroupId?: string;
  variantType?: 'compressed_recognition' | 'original_source' | 'demo_asset';
  isPrimaryRecognitionAsset?: boolean;
  sourceType?: 'camera' | 'album' | 'demo';
  clientContext?: Record<string, unknown>;
}
