import { ConfigService } from '@nestjs/config';
import { TencentCosStorageAdapterService } from '../../src/adapters/storage/tencent-cos-storage-adapter.service';
import { AssetsService } from '../../src/modules/assets/application/assets.service';
import { ProductPoolService } from '../../src/modules/product-pool/application/product-pool.service';
import { LocalProductSearchProviderService } from '../../src/modules/product-pool/application/local-product-search-provider.service';
import { SearchDebugService } from '../../src/modules/sessions/application/search-debug.service';

const signed = 'https://bucket.example/image.jpg?signature=test';
const product = {
  id: 'product-1', imageBucketGroup: 'demo-assets', imageObjectKey: 'products/image.jpg',
  imagePublicUrl: 'https://bucket.example/image.jpg', sourceImageUrl: 'https://source.example/image.jpg',
};

describe('private COS image chain', () => {
  it.each([
    ['catalog', ProductPoolService.prototype],
    ['search', LocalProductSearchProviderService.prototype],
    ['diagnostics', SearchDebugService.prototype],
  ])('%s prefers a fresh signed URL over the stored unsigned URL', async (_name, prototype) => {
    const storage = { getSignedReadUrl: jest.fn().mockResolvedValue(signed) };
    const service = Object.assign(Object.create(prototype), { storage });
    expect(await service.resolveProductImageUrl(product)).toBe(signed);
    expect(storage.getSignedReadUrl).toHaveBeenCalledWith({
      bucketGroup: 'demo-assets', objectKey: 'products/image.jpg', expiresSeconds: 900,
    });
  });

  it('signs catalog list and detail responses without persisting signed URLs', async () => {
    const prisma = { product: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([product]),
      findUnique: jest.fn().mockResolvedValue(product),
    } };
    const service: ProductPoolService = Object.assign(Object.create(ProductPoolService.prototype), {
      prisma, storage: { getSignedReadUrl: jest.fn().mockResolvedValue(signed) },
      productViewAdapter: {
        toListItem: () => ({ productId: product.id, imageUrl: product.imagePublicUrl }),
        toDetail: () => ({ productId: product.id, imageUrl: product.imagePublicUrl }),
      },
    });
    expect((await service.listProducts()).items[0].imageUrl).toBe(signed);
    expect((await service.getProduct(product.id)).imageUrl).toBe(signed);
    expect(product.imagePublicUrl).not.toContain('signature');
  });

  it.each([true, false])('only signs uploaded content: uploaded=%s', async (uploaded) => {
    const storage = {
      putImage: jest.fn().mockResolvedValue({ provider: 'tencent_cos', bucketGroup: 'demo-assets', objectKey: 'image.jpg' }),
      getSignedReadUrl: jest.fn().mockResolvedValue(signed),
    };
    const prisma = { imageAsset: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)) } };
    const service = new AssetsService(prisma as never, storage, {
      normalizeCreateInput: () => ({ variantType: 'demo_asset',
        file: uploaded ? { buffer: Buffer.from('test'), contentType: 'image/jpeg', sizeBytes: 4 } : undefined }),
    } as never);
    const result = await service.createImageAsset({ variantType: 'demo_asset' } as never);
    expect(result.imageRef.signedReadUrl).toBe(uploaded ? signed : null);
    expect(result.imageRef.signedReadUrlExpiresSeconds).toBe(uploaded ? 900 : null);
    expect(storage.getSignedReadUrl).toHaveBeenCalledTimes(uploaded ? 1 : 0);
  });
});

describe('COS transport', () => {
  const config = new ConfigService({ objectStorage: {
    region: 'ap-singapore', secretId: 'test-id', secretKey: 'test-key',
    buckets: { demoAssets: 'test-bucket' }, requestTimeoutMs: 15000,
  } });
  afterEach(() => jest.restoreAllMocks());

  it('honors the advertised URL lifetime while tolerating clock skew', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const url = await new TencentCosStorageAdapterService(config).getSignedReadUrl({
      bucketGroup: 'demo-assets', objectKey: 'products/test image.jpg', expiresSeconds: 900,
    });
    expect(new URL(url!).pathname).toBe('/products/test%20image.jpg');
    expect(new URL(url!).searchParams.get('q-sign-time')).toBe('1799999940;1800000900');
  });

  it('bounds uploads and does not expose provider errors or credentials', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider-secret'));
    await expect(new TencentCosStorageAdapterService(config).putImage({
      assetId: 'asset', assetGroupId: 'group', variantType: 'demo_asset', content: Buffer.from('image'),
    })).rejects.toThrow('IMAGE_UPLOAD_NETWORK_FAILED');
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
