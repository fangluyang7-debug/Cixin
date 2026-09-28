import { StoreManager } from '../database/StoreManager';
import { ProductJsonItem } from '../models/Product';
import hilog from '@ohos.hilog';
import util from '@ohos.util';
import { common } from '@kit.AbilityKit';
import { NeuralEmbeddingIndex } from './NeuralEmbeddingIndex';

interface ProductJsonDocument {
  items: ProductJsonItem[];
}

interface RawfileLoadResult {
  parsed: number;
  inserted: number;
}

const RAW_PRODUCT_FILES: string[] = [
  'collected_shoes_20260605-full-chunk0001.json',
  'seed_all_20260606_chunk0001.json',
  'seed_all_20260606_chunk0002.json',
  'seed_all_20260606_chunk0003.json',
  'seed_all_20260606_chunk0004.json',
  'seed_all_20260606_chunk0005.json',
  'seed_all_20260606_chunk0006.json',
  'seed_all_20260606_chunk0007.json',
  'seed_all_20260606_chunk0008.json',
  'seed_all_20260606_chunk0009.json',
  'seed_all_20260606_chunk0010.json',
  'seed_shoes_20260605_chunk0001.json',
  'seed_shoes_20260605_chunk0002.json',
  'seed_shoes_20260605_chunk0003.json',
  'seed_shoes_20260605_chunk0004.json',
  'seed_shoes_20260605_chunk0005.json',
  'seed_shoes_20260605_chunk0006.json',
  'seed_shoes_20260605_chunk0007.json',
  'seed_shoes_20260605_chunk0008.json',
  'seed_shoes_20260605_chunk0009.json',
  'seed_shoes_20260605_chunk0010.json',
  'seed_mixed_20260610_demo1000_combined.json',
];

const EXPECTED_SEED_PRODUCT_COUNT = 2700;

export class DataInitService {
  private static initializationPromise: Promise<void> | null = null;

  public static checkAndInitData(context: common.Context): Promise<void> {
    if (!DataInitService.initializationPromise) {
      DataInitService.initializationPromise = DataInitService.initialize(context);
    }
    return DataInitService.initializationPromise;
  }

  public static async waitUntilReady(): Promise<void> {
    if (DataInitService.initializationPromise) {
      await DataInitService.initializationPromise;
    }
  }

  private static async initialize(context: common.Context): Promise<void> {
    const storeManager = StoreManager.getInstance();
    await storeManager.initStore(context);

    const count = await storeManager.getProductCount();
    hilog.info(0x0000, 'DataInitService', `Current product count: ${count}`);

    if (count === 0 || count < EXPECTED_SEED_PRODUCT_COUNT) {
      if (count > 0) {
        hilog.info(
          0x0000,
          'DataInitService',
          `Existing seed data is incomplete (${count}/${EXPECTED_SEED_PRODUCT_COUNT}), rebuilding product table...`
        );
        await storeManager.clearProducts();
      }

      hilog.info(0x0000, 'DataInitService', 'Starting data initialization...');
      await DataInitService.loadDataFromRawfile(context);
    } else {
      hilog.info(0x0000, 'DataInitService', 'Database already initialized, skipping data loading.');
    }
    await NeuralEmbeddingIndex.getInstance().initialize(context);
  }

  private static async loadDataFromRawfile(context: common.Context): Promise<void> {
    let totalParsed = 0;
    let totalInserted = 0;

    for (const fileName of RAW_PRODUCT_FILES) {
      const result = await DataInitService.loadOneRawfile(context, fileName);
      totalParsed += result.parsed;
      totalInserted += result.inserted;
    }

    hilog.info(
      0x0000,
      'DataInitService',
      `Data initialization finished. Parsed ${totalParsed} items, inserted ${totalInserted} rows.`
    );
  }

  private static async loadOneRawfile(
    context: common.Context,
    fileName: string
  ): Promise<RawfileLoadResult> {
    try {
      const resourceManager = context.resourceManager;
      const rawData = await resourceManager.getRawFileContent(fileName);
      if (!rawData) {
        hilog.warn(0x0000, 'DataInitService', `Raw product file is empty: ${fileName}`);
        return { parsed: 0, inserted: 0 };
      }

      const textDecoder = new util.TextDecoder('utf-8', { ignoreBOM: true });
      const jsonString = textDecoder.decodeToString(rawData);
      const parsedData: ProductJsonDocument = JSON.parse(jsonString) as ProductJsonDocument;
      const items: ProductJsonItem[] = parsedData.items;

      if (items && items.length > 0) {
        hilog.info(0x0000, 'DataInitService', `Parsed ${items.length} items from ${fileName}. Inserting...`);
        const inserted = await StoreManager.getInstance().batchInsertProducts(items);
        return { parsed: items.length, inserted };
      } else {
        hilog.warn(0x0000, 'DataInitService', `Parsed JSON has no items array or it is empty: ${fileName}`);
        return { parsed: 0, inserted: 0 };
      }
    } catch (error) {
      hilog.error(0x0000, 'DataInitService', `Failed to load rawfile data from ${fileName}: ${JSON.stringify(error)}`);
      return { parsed: 0, inserted: 0 };
    }
  }
}
