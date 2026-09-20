import relationalStore from '@ohos.data.relationalStore';
import { Product, ProductJsonItem } from '../models/Product';
import { ProductEmbeddingSeed } from '../models/EmbeddingModel';
import hilog from '@ohos.hilog';
import { common } from '@kit.AbilityKit';

const STORE_CONFIG: relationalStore.StoreConfig = {
  name: 'ShoppingAssistant.db',
  securityLevel: relationalStore.SecurityLevel.S1,
};

const SQL_CREATE_TABLE = `CREATE TABLE IF NOT EXISTS Product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  externalId TEXT,
  platform TEXT,
  title TEXT,
  price TEXT,
  currency TEXT,
  stockStatus TEXT,
  shopName TEXT,
  shopType TEXT,
  productUrl TEXT,
  imageUrl TEXT
)`;

const SQL_CREATE_EMBEDDING_TABLE = `CREATE TABLE IF NOT EXISTS ProductEmbedding (
  productId INTEGER NOT NULL,
  modelVersion TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  vector BLOB NOT NULL,
  vectorScale REAL NOT NULL,
  PRIMARY KEY(productId, modelVersion)
)`;

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const EMBEDDING_INSERT_BATCH_SIZE = 200;

export class StoreManager {
  private static instance: StoreManager;
  private rdbStore: relationalStore.RdbStore | null = null;

  private constructor() {}

  public static getInstance(): StoreManager {
    if (!StoreManager.instance) {
      StoreManager.instance = new StoreManager();
    }
    return StoreManager.instance;
  }

  public async initStore(context: common.Context): Promise<void> {
    try {
      this.rdbStore = await relationalStore.getRdbStore(context, STORE_CONFIG);
      if (this.rdbStore) {
        await this.rdbStore.executeSql(SQL_CREATE_TABLE);
        await this.rdbStore.executeSql(SQL_CREATE_EMBEDDING_TABLE);
        hilog.info(0x0000, 'StoreManager', 'RdbStore initialized and table created.');
      }
    } catch (err) {
      hilog.error(0x0000, 'StoreManager', `Init RdbStore failed, err: ${JSON.stringify(err)}`);
    }
  }

  public async getProductCount(): Promise<number> {
    if (!this.rdbStore) {
      return 0;
    }

    const predicates = new relationalStore.RdbPredicates('Product');
    let resultSet: relationalStore.ResultSet | null = null;
    try {
      resultSet = await this.rdbStore.query(predicates, ['id']);
      return resultSet.rowCount;
    } catch (err) {
      hilog.error(0x0000, 'StoreManager', `Count failed, err: ${JSON.stringify(err)}`);
      return 0;
    } finally {
      if (resultSet) {
        resultSet.close();
      }
    }
  }

  public async batchInsertProducts(products: ProductJsonItem[]): Promise<number> {
    if (!this.rdbStore || products.length === 0) {
      return 0;
    }

    const valuesBuckets: relationalStore.ValuesBucket[] = products.map((item) => {
      const bucket: relationalStore.ValuesBucket = {};
      bucket.externalId = item.externalId;
      bucket.platform = item.platform;
      bucket.title = item.title;
      bucket.price = item.price;
      bucket.currency = item.currency;
      bucket.stockStatus = item.stockStatus;
      bucket.shopName = item.shopName;
      bucket.shopType = item.shopType;
      bucket.productUrl = item.productUrl;
      bucket.imageUrl = item.imageUrl;
      return bucket;
    });

    try {
      const rows = await this.rdbStore.batchInsert('Product', valuesBuckets);
      hilog.info(0x0000, 'StoreManager', `Batch inserted ${rows} products.`);
      return rows;
    } catch (err) {
      hilog.error(0x0000, 'StoreManager', `Batch insert failed, err: ${JSON.stringify(err)}`);
      return 0;
    }
  }

  public async clearProducts(): Promise<void> {
    if (!this.rdbStore) {
      return;
    }

    try {
      await this.rdbStore.executeSql('DELETE FROM ProductEmbedding');
      await this.rdbStore.executeSql('DELETE FROM Product');
      hilog.info(0x0000, 'StoreManager', 'Product table cleared.');
    } catch (err) {
      hilog.error(0x0000, 'StoreManager', `Clear products failed, err: ${JSON.stringify(err)}`);
    }
  }

  public async queryTopProducts(limit: number = 3): Promise<Product[]> {
    return this.searchProducts('', limit, 0);
  }

  public async queryAllProducts(limit: number = 3000): Promise<Product[]> {
    if (!this.rdbStore) {
      return [];
    }
    const normalizedLimit: number = Math.max(1, Math.floor(limit));
    const predicates = new relationalStore.RdbPredicates('Product');
    predicates.orderByAsc('id');
    predicates.limitAs(normalizedLimit);

    let resultSet: relationalStore.ResultSet | null = null;
    const products: Product[] = [];
    try {
      resultSet = await this.rdbStore.query(predicates);
      while (resultSet.goToNextRow()) {
        products.push(this.readProduct(resultSet));
      }
    } catch (err) {
      hilog.error(0x0000, 'StoreManager', `Query all products failed: ${JSON.stringify(err)}`);
    } finally {
      if (resultSet) {
        resultSet.close();
      }
    }
    return products;
  }

  public async ensureProductEmbeddings(
    seeds: ProductEmbeddingSeed[],
    modelVersion: string
  ): Promise<void> {
    if (!this.rdbStore || seeds.length === 0) {
      return;
    }
    const predicates = new relationalStore.RdbPredicates('ProductEmbedding');
    predicates.equalTo('modelVersion', modelVersion);
    let resultSet: relationalStore.ResultSet | null = null;
    try {
      resultSet = await this.rdbStore.query(predicates, ['productId']);
      if (resultSet.rowCount === seeds.length) {
        return;
      }
    } finally {
      if (resultSet) {
        resultSet.close();
      }
    }

    await this.rdbStore.executeSql('DELETE FROM ProductEmbedding');
    for (let start: number = 0; start < seeds.length; start += EMBEDDING_INSERT_BATCH_SIZE) {
      const end: number = Math.min(seeds.length, start + EMBEDDING_INSERT_BATCH_SIZE);
      const valuesBuckets: relationalStore.ValuesBucket[] = [];
      for (let index: number = start; index < end; index++) {
        const seed: ProductEmbeddingSeed = seeds[index];
        const bucket: relationalStore.ValuesBucket = {};
        bucket.productId = seed.productId;
        bucket.modelVersion = seed.modelVersion;
        bucket.dimension = seed.dimension;
        bucket.vector = seed.vector;
        bucket.vectorScale = seed.vectorScale;
        valuesBuckets.push(bucket);
      }
      await this.rdbStore.batchInsert('ProductEmbedding', valuesBuckets);
    }
    hilog.info(
      0x0000,
      'StoreManager',
      `Persisted ${seeds.length} product embeddings for ${modelVersion}.`
    );
  }

  /**
   * Searches the local product table by title, shop name, or platform.
   * Results use a deterministic id order and support the offset/limit needed by a later results page.
   */
  public async searchProducts(
    keyword: string,
    limit: number = DEFAULT_SEARCH_LIMIT,
    offset: number = 0
  ): Promise<Product[]> {
    if (!this.rdbStore) {
      hilog.warn(0x0000, 'StoreManager', 'Search skipped because RdbStore is not ready.');
      return [];
    }

    const normalizedKeyword = keyword.trim();
    const normalizedLimit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(limit)));
    const normalizedOffset = Math.max(0, Math.floor(offset));
    const predicates = new relationalStore.RdbPredicates('Product');

    if (normalizedKeyword.length > 0) {
      predicates.beginWrap()
        .contains('title', normalizedKeyword)
        .or()
        .contains('shopName', normalizedKeyword)
        .or()
        .contains('platform', normalizedKeyword)
        .endWrap();
    }

    predicates.orderByAsc('id');
    predicates.limitAs(normalizedLimit);
    if (normalizedOffset > 0) {
      predicates.offsetAs(normalizedOffset);
    }

    let resultSet: relationalStore.ResultSet | null = null;
    const products: Product[] = [];
    try {
      resultSet = await this.rdbStore.query(predicates);
      while (resultSet.goToNextRow()) {
        products.push(this.readProduct(resultSet));
      }
      hilog.info(
        0x0000,
        'StoreManager',
        `Search completed. keyword=${normalizedKeyword}, offset=${normalizedOffset}, results=${products.length}`
      );
    } catch (err) {
      hilog.error(0x0000, 'StoreManager', `Search failed, err: ${JSON.stringify(err)}`);
    } finally {
      if (resultSet) {
        resultSet.close();
      }
    }
    return products;
  }

  private readProduct(resultSet: relationalStore.ResultSet): Product {
    return new Product(
      resultSet.getString(resultSet.getColumnIndex('externalId')),
      resultSet.getString(resultSet.getColumnIndex('platform')),
      resultSet.getString(resultSet.getColumnIndex('title')),
      resultSet.getString(resultSet.getColumnIndex('price')),
      resultSet.getString(resultSet.getColumnIndex('currency')),
      resultSet.getString(resultSet.getColumnIndex('stockStatus')),
      resultSet.getString(resultSet.getColumnIndex('shopName')),
      resultSet.getString(resultSet.getColumnIndex('shopType')),
      resultSet.getString(resultSet.getColumnIndex('productUrl')),
      resultSet.getString(resultSet.getColumnIndex('imageUrl')),
      resultSet.getLong(resultSet.getColumnIndex('id'))
    );
  }
}
