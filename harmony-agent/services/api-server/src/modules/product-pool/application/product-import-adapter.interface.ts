import { ImportProductsDto } from '../dto/import-products.dto';

export const PRODUCT_IMPORT_ADAPTER = Symbol('PRODUCT_IMPORT_ADAPTER');

export interface ProductImportAdapterResult {
  dto: ImportProductsDto;
  metadata: {
    adapterName: string;
    schemaVersion: string;
    normalizedAt: string;
    itemCount: number;
    warnings: string[];
  };
}

export interface ProductImportAdapter {
  normalizeBatch(input: unknown): ProductImportAdapterResult;
}
