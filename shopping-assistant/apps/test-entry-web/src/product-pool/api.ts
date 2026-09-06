import type {
  ApiEnvelope,
  BatchDetail,
  BatchList,
  BatchQuality,
  JsonRecord,
  ProductDetail,
  ProductList,
  ProductPoolStats,
  RollbackPreview,
} from './types';

export class ProductPoolApi {
  constructor(
    private readonly getBaseUrl: () => string,
    private readonly getMaintenanceToken: () => string,
  ) {}

  stats() {
    return this.request<ProductPoolStats>('/api/v1/product-pool/stats');
  }

  batches(params: URLSearchParams) {
    return this.request<BatchList>(
      `/api/v1/product-pool/batches?${params.toString()}`,
      { maintenance: true },
    );
  }

  batch(batchId: string) {
    return this.request<BatchDetail>(
      `/api/v1/product-pool/batches/${encodeURIComponent(batchId)}?productLimit=100`,
      { maintenance: true },
    );
  }

  batchQuality(batchId: string) {
    return this.request<BatchQuality>(
      `/api/v1/product-pool/batches/${encodeURIComponent(batchId)}/quality`,
      { maintenance: true },
    );
  }

  retryBatch(batchId: string) {
    return this.request<JsonRecord>(
      `/api/v1/product-pool/batches/${encodeURIComponent(batchId)}/retry`,
      { method: 'POST', maintenance: true },
    );
  }

  rollbackBatch(batchId: string, dryRun: boolean) {
    return this.request<RollbackPreview>(
      `/api/v1/product-pool/batches/${encodeURIComponent(batchId)}/rollback`,
      {
        method: 'POST',
        maintenance: true,
        body: { dryRun },
      },
    );
  }

  deleteBatch(batchId: string, dryRun: boolean) {
    return this.request<JsonRecord>('/api/v1/product-pool/batches/delete', {
      method: 'POST',
      maintenance: true,
      body: { batchId, dryRun },
    });
  }

  products(params: URLSearchParams) {
    return this.request<ProductList>(
      `/api/v1/product-pool/products?${params.toString()}`,
    );
  }

  product(productId: string) {
    return this.request<ProductDetail>(
      `/api/v1/product-pool/products/${encodeURIComponent(productId)}`,
    );
  }

  updateProduct(productId: string, body: JsonRecord) {
    return this.request<ProductDetail>(
      `/api/v1/product-pool/products/${encodeURIComponent(productId)}`,
      {
        method: 'PATCH',
        maintenance: true,
        body,
      },
    );
  }

  deleteProducts(productIds: string[], dryRun: boolean) {
    return this.request<JsonRecord>('/api/v1/product-pool/products/delete', {
      method: 'POST',
      maintenance: true,
      body: { productIds, dryRun },
    });
  }

  importProducts(payload: unknown) {
    return this.request<{
      batchId: string;
      batchSource: string;
      totalCount: number;
      status: string;
    }>('/api/v1/product-pool/import', {
      method: 'POST',
      maintenance: true,
      body: payload,
    });
  }

  rebuildEmbeddings(input: { limit?: number; embeddingKind?: string }) {
    const params = new URLSearchParams();
    if (input.limit) params.set('limit', String(input.limit));
    if (input.embeddingKind) {
      params.set('embeddingKind', input.embeddingKind);
    }
    return this.request<JsonRecord>(
      `/api/v1/product-pool/embeddings/rebuild?${params.toString()}`,
      {
        method: 'POST',
        maintenance: true,
      },
    );
  }

  private async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH';
      maintenance?: boolean;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const headers = new Headers();
    if (options.body !== undefined) {
      headers.set('content-type', 'application/json');
    }
    if (options.maintenance) {
      const token = this.getMaintenanceToken().trim();
      if (token) headers.set('x-maintenance-token', token);
    }

    const response = await fetch(
      `${this.getBaseUrl().trim().replace(/\/$/, '')}${path}`,
      {
        method: options.method ?? 'GET',
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    );
    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || !payload.success || payload.data === null) {
      const error = new Error(
        payload.error?.message ??
          payload.error?.code ??
          `HTTP_${response.status}`,
      );
      error.name = payload.error?.code ?? `HTTP_${response.status}`;
      throw error;
    }
    return payload.data;
  }
}
