import { ProductImportItemDto } from '../dto/import-products.dto';

export const PRODUCT_IMPORT_BATCH_STATE_ADAPTER = Symbol('PRODUCT_IMPORT_BATCH_STATE_ADAPTER');

export interface ProductImportProgressState {
  succeededCount: number;
  failedCount: number;
  createdCount: number;
  updatedCount: number;
  processedCount?: number;
  importedProductIds?: string[];
}

export interface ProductImportBatchStateAdapter {
  buildAcceptedRaw(input: {
    batchSource: string;
    items: ProductImportItemDto[];
    adapterMetadata: Record<string, unknown>;
    acceptedAt?: Date;
  }): string;
  hasImportItems(rawJson: string): boolean;
  normalizeItemsForProcessing(input: {
    batchSource: string;
    rawJson: string;
  }): ProductImportItemDto[];
  getStartedAt(rawJson: string, fallback?: Date): string;
  buildRetryRaw(rawJson: string, retriedAt?: Date): string;
  buildItemsUnavailableFailureRaw(rawJson: string, failedAt?: Date): string;
  buildProcessingRaw(input: { rawJson: string; startedAt: string }): string;
  buildProgressRaw(input: {
    rawJson: string;
    startedAt: string;
    progress: ProductImportProgressState;
  }): string;
  buildCompletedRaw(input: {
    rawJson: string;
    startedAt: string;
    completedAt: string;
    progress: ProductImportProgressState;
  }): string;
  buildRolledBackRaw(input: {
    rawJson: string;
    rolledBackAt: string;
    result: Record<string, unknown>;
  }): string;
}
