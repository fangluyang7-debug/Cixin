import { Inject, Injectable } from '@nestjs/common';
import { fromJson, toJsonString } from '../../../common/utils/json';
import { ProductImportItemDto } from '../dto/import-products.dto';
import {
  PRODUCT_IMPORT_ADAPTER,
  ProductImportAdapter,
} from './product-import-adapter.interface';
import {
  ProductImportBatchStateAdapter,
  ProductImportProgressState,
} from './product-import-batch-state-adapter.interface';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class StandardProductImportBatchStateAdapterService implements ProductImportBatchStateAdapter {
  constructor(
    @Inject(PRODUCT_IMPORT_ADAPTER)
    private readonly productImportAdapter: ProductImportAdapter,
  ) {}

  buildAcceptedRaw(input: {
    batchSource: string;
    items: ProductImportItemDto[];
    adapterMetadata: Record<string, unknown>;
    acceptedAt?: Date;
  }): string {
    return toJsonString({
      schemaVersion: 'product_import_async_v1',
      batchSource: input.batchSource,
      items: input.items,
      acceptedAt: (input.acceptedAt ?? new Date()).toISOString(),
      adapter: input.adapterMetadata,
      progress: this.emptyProgress(),
    });
  }

  hasImportItems(rawJson: string): boolean {
    const raw = this.parse(rawJson);
    return Array.isArray(raw.items) && raw.items.length > 0;
  }

  normalizeItemsForProcessing(input: {
    batchSource: string;
    rawJson: string;
  }): ProductImportItemDto[] {
    try {
      const raw = this.parse(input.rawJson);
      return this.productImportAdapter.normalizeBatch({
        batchSource:
          typeof raw.batchSource === 'string' && raw.batchSource.trim().length > 0
            ? raw.batchSource
            : input.batchSource,
        schemaVersion: raw.schemaVersion,
        items: raw.items,
      }).dto.items;
    } catch {
      return [];
    }
  }

  getStartedAt(rawJson: string, fallback?: Date): string {
    const raw = this.parse(rawJson);
    return typeof raw.startedAt === 'string'
      ? raw.startedAt
      : (fallback ?? new Date()).toISOString();
  }

  buildRetryRaw(rawJson: string, retriedAt?: Date): string {
    return toJsonString({
      ...this.parse(rawJson),
      retriedAt: (retriedAt ?? new Date()).toISOString(),
      progress: this.emptyProgress(),
    });
  }

  buildItemsUnavailableFailureRaw(rawJson: string, failedAt?: Date): string {
    return toJsonString({
      ...this.parse(rawJson),
      failedAt: (failedAt ?? new Date()).toISOString(),
      failureReason: 'PRODUCT_IMPORT_BATCH_ITEMS_NOT_AVAILABLE',
    });
  }

  buildProcessingRaw(input: { rawJson: string; startedAt: string }): string {
    return toJsonString({
      ...this.parse(input.rawJson),
      startedAt: input.startedAt,
      progress: this.emptyProgress(),
    });
  }

  buildProgressRaw(input: {
    rawJson: string;
    startedAt: string;
    progress: ProductImportProgressState;
  }): string {
    return toJsonString({
      ...this.parse(input.rawJson),
      startedAt: input.startedAt,
      progress: input.progress,
    });
  }

  buildCompletedRaw(input: {
    rawJson: string;
    startedAt: string;
    completedAt: string;
    progress: ProductImportProgressState;
  }): string {
    return toJsonString({
      ...this.parse(input.rawJson),
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      progress: input.progress,
    });
  }

  buildRolledBackRaw(input: {
    rawJson: string;
    rolledBackAt: string;
    result: Record<string, unknown>;
  }): string {
    return toJsonString({
      ...this.parse(input.rawJson),
      rolledBackAt: input.rolledBackAt,
      rollback: input.result,
    });
  }

  private parse(rawJson: string): JsonRecord {
    return fromJson<JsonRecord>(rawJson, {});
  }

  private emptyProgress(): ProductImportProgressState {
    return {
      succeededCount: 0,
      failedCount: 0,
      createdCount: 0,
      updatedCount: 0,
    };
  }
}
