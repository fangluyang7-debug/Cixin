import { ConfigService } from '@nestjs/config';
import { Product } from '@prisma/client';
import { LocalProductSearchProviderService } from '../../src/modules/product-pool/application/local-product-search-provider.service';
import { StandardProductSearchResultAdapterService } from '../../src/modules/product-pool/application/standard-product-search-result-adapter.service';
import { StandardProductSearchSignalsAdapterService } from '../../src/modules/product-pool/application/standard-product-search-signals-adapter.service';

function product(): Product {
  return {
    id: 'product_1',
    importBatchId: null,
    externalId: 'external_1',
    platform: 'jd',
    title: '测试商品',
    priceAmount: '499.00',
    currency: 'CNY',
    stockStatus: 'in_stock',
    shopName: '测试店铺',
    shopType: 'flagship',
    productUrl: 'https://example.test/product',
    sourceImageUrl: null,
    imageBucketGroup: null,
    imageObjectKey: null,
    imagePublicUrl: 'https://example.test/product.jpg',
    tagStatus: 'verified',
    brand: 'Test',
    category: 'shoe',
    modelLine: null,
    colorFamily: 'brown',
    colorway: null,
    shoeType: 'lifestyle',
    keywordsJson: '[]',
    normalizedTagsJson: '{}',
    rawPayloadJson: '{}',
    tagConfidence: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function recallCandidate() {
  return {
    product: product(),
    styleId: null,
    recallSources: new Set<'tag' | 'ann'>(['ann', 'tag']),
    tagMatchScore: 0.44,
    annScore: 0.598086,
    rawAnnScore: 0.598086,
    annPassedMinScore: false,
    businessScore: 0.5,
    initialScore: 0.53,
    embeddingId: 'embedding_1',
    imageRole: 'main',
    embeddingKind: 'visual',
    embeddingProvider: 'test',
  };
}

describe('product search verification semantics', () => {
  it('keeps the public fast image-search result explicitly unverified', async () => {
    const resultAdapter = new StandardProductSearchResultAdapterService(
      new ConfigService({
        ann: { provider: 'sqlite_vec', minScore: 0.68, topK: 50 },
        embedding: { provider: 'test', annEmbeddingKind: 'visual' },
        search: { globalCandidateLimit: 30, prefetchLimit: 120 },
      }),
    );
    const service = new LocalProductSearchProviderService(
      { product: { findMany: jest.fn().mockResolvedValue([product()]) } } as never,
      {
        search: jest.fn().mockResolvedValue([
          {
            productId: 'product_1',
            styleId: null,
            imageRole: 'main',
            rawScore: 0.8,
            score: 0.8,
            passedMinScore: true,
            embeddingId: 'embedding_1',
            embeddingKind: 'visual',
            provider: 'sqlite_vec',
            embeddingProvider: 'test',
          },
        ]),
      },
      {} as never,
      resultAdapter,
      new StandardProductSearchSignalsAdapterService(),
      { verifyCandidate: jest.fn() },
      {} as never,
      {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      new ConfigService({
        ann: { minScore: 0.68, topK: 50 },
        embedding: { annEmbeddingKind: 'visual' },
        search: {
          globalCandidateLimit: 30,
          prefetchLimit: 120,
          imageAnnRecallMinCandidates: 1,
          imageAnnRecallMaxCandidates: 30,
          imageBackfillMinScore: 0.38,
        },
      }),
    );

    const results = await service.searchFastAnnShoes({
      keywords: ['Test shoe'],
      profile: {
        category: 'shoe',
        brand: 'Test',
        modelLine: null,
        colorFamily: 'brown',
        colorway: null,
        shoeType: 'lifestyle',
        size: null,
        color: 'brown',
        styleTags: [],
        sceneTags: [],
        keywords: ['Test shoe'],
        confidence: 1,
        raw: {},
      },
      queryEmbedding: [0.1, 0.2, 0.3],
      embeddingKind: 'visual',
      category: 'shoe',
      limit: 30,
    });

    expect(results).toHaveLength(1);
    expect(results[0].matchSummary).toMatchObject({
      sameProduct: null,
      verificationStatus: 'not_verified',
      verificationSource: 'ann_only',
      annScore: 0.8,
      displayScore: 0.8,
    });
  });

  it('does not claim that ANN-only fast-path candidates are verified matches', async () => {
    const service = new LocalProductSearchProviderService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new ConfigService({ search: {} }),
    );

    const result = await (
      service as unknown as {
        fastVerify(candidate: ReturnType<typeof recallCandidate>): Promise<{
          verification: {
            sameProduct: boolean | null;
            verificationStatus: string;
            verificationSource: string;
          };
        }>;
      }
    ).fastVerify(recallCandidate());

    expect(result.verification).toMatchObject({
      sameProduct: null,
      verificationStatus: 'not_verified',
      verificationSource: 'ann_only',
    });
  });

  it('does not inflate an unverified ANN score into a perfect display score', () => {
    const adapter = new StandardProductSearchResultAdapterService(
      new ConfigService({
        ann: { provider: 'sqlite_vec' },
        embedding: { provider: 'test' },
      }),
    );
    const candidate = {
      ...recallCandidate(),
      visualVerifyScore: 0.598086,
      finalScore: 0.582736,
      coverImageUrl: 'https://example.test/product.jpg',
      verification: {
        sameProduct: null,
        sameColorway: null,
        confidence: 0.598086,
        verificationStatus: 'not_verified' as const,
        verificationSource: 'ann_only' as const,
        raw: { mode: 'ann_tag_fast_path' },
      },
    };

    const result = adapter.toCandidateSeed(candidate);

    expect(result.matchSummary).toMatchObject({
      displayScore: 0.598086,
      sameProduct: null,
      verificationStatus: 'not_verified',
      verificationSource: 'ann_only',
      visualMatchConfidence: null,
    });
    expect(result.recommendationReason).toContain(
      '该候选尚未经过逐商品视觉复核',
    );
  });
});
