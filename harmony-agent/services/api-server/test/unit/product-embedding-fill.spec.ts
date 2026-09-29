import { ProductPoolService } from '../../src/modules/product-pool/application/product-pool.service';

describe('missing product embedding repair', () => {
  it('previews and fills only uncovered products without deleting existing vectors', async () => {
    const covered = { productId: 'p1', vectorJson: '[1,0]' };
    const embeddings = [covered];
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]) },
      productImageEmbedding: {
        findMany: jest.fn().mockResolvedValue(embeddings),
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          embeddings.some(row => row.productId === where.productId) ? { id: where.productId } : null),
        deleteMany: jest.fn(),
      },
    };
    const service = Object.create(ProductPoolService.prototype) as ProductPoolService;
    (service as any).prisma = prisma;
    (service as any).config = { get: (key: string) => ({
      'embedding.provider': 'real', 'embedding.modelName': 'embed-model', 'embedding.dimension': 2,
    } as Record<string, unknown>)[key] };
    jest.spyOn(service as any, 'assertRealEmbeddingProvider').mockImplementation(() => {});
    jest.spyOn(service as any, 'invalidateStatsCache').mockImplementation(() => Promise.resolve());
    jest.spyOn(service as any, 'createEmbeddingsForExistingProduct').mockImplementation(async (rawProduct: unknown) => {
      const product = rawProduct as { id: string };
      embeddings.push({ productId: product.id, vectorJson: '[0,1]' });
    });
    const preview = await service.fillMissingEmbeddings({ embeddingKind: 'visual', dryRun: true });
    expect(preview).toMatchObject({ missingCount: 1, selectedProductIds: ['p2'], attemptedCount: 0 });
    expect((service as any).createEmbeddingsForExistingProduct).not.toHaveBeenCalled();
    const filled = await service.fillMissingEmbeddings({ embeddingKind: 'visual', dryRun: false });
    expect(filled).toMatchObject({ succeededCount: 1, failedCount: 0 });
    expect((service as any).createEmbeddingsForExistingProduct).toHaveBeenCalledWith({ id: 'p2' }, ['visual']);
    expect(prisma.productImageEmbedding.deleteMany).not.toHaveBeenCalled();
  });
});
