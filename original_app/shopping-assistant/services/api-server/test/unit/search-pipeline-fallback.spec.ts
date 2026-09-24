import { SessionsService } from '../../src/modules/sessions/application/sessions.service';
import { LocalProductSearchProviderService } from '../../src/modules/product-pool/application/local-product-search-provider.service';

describe('image search pipeline fallback', () => {
  it('falls back to pure visual ANN when lightweight tags are unavailable', async () => {
    const service = Object.create(SessionsService.prototype) as Record<string, any>;
    service.identifyLightweightProfileOrNull = jest.fn().mockResolvedValue(null);
    service.searchFastAnnShoesWithFallback = jest.fn().mockResolvedValue({
      candidates: [],
      fallback: null,
    });

    await service.searchLightTagAnnFusionWithFallback({
      sessionId: 'sess_fallback',
      asset: { id: 'asset_1', bucketGroup: 'test', objectKey: 'shoe.jpg' },
      categoryHint: 'shoe',
      queryEmbedding: [0.1, 0.2],
      queryImageUrl: 'https://example.invalid/shoe.jpg',
      filters: { searchPipelineMode: 'light_tag_ann_fusion' },
    });

    expect(service.searchFastAnnShoesWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'asset_1',
        embeddingKind: 'visual',
        queryEmbedding: [0.1, 0.2],
      }),
    );
  });

  it('keeps the 0.55 result threshold during image backfill', async () => {
    const service = Object.create(
      LocalProductSearchProviderService.prototype,
    ) as Record<string, any>;
    service.config = {
      get: (key: string) =>
        key === 'search.imageBackfillMinScore' ? 0.38 : undefined,
    };
    service.buildRankedResults = jest.fn().mockResolvedValue([]);

    await service.backfillImageResults({
      ranked: [],
      fusedCandidates: [],
      profile: { category: 'shoe', keywords: [] },
      queryImageUrl: 'https://example.invalid/shoe.jpg',
      filters: {},
      resultLimit: 20,
    });

    expect(service.buildRankedResults).toHaveBeenCalledWith(
      expect.objectContaining({ minScore: 0.55 }),
    );
  });

  it('does not let a late recognition job overwrite a user-edited profile', async () => {
    const service = Object.create(SessionsService.prototype) as Record<string, any>;
    const update = jest.fn().mockResolvedValue({});
    service.prisma = {
      productProfileSnapshot: {
        findUnique: jest.fn().mockResolvedValue({
          rawJson: JSON.stringify({
            userEdited: true,
            userProfilePatch: { brand: 'Nike' },
          }),
        }),
        update,
      },
    };

    await service.writeDetailedProfileSnapshot(
      'sess_user_edit',
      {
        category: 'shoe',
        brand: 'Adidas',
        modelLine: null,
        colorFamily: 'white',
        colorway: null,
        shoeType: 'running',
        size: null,
        color: 'white',
        styleTags: [],
        sceneTags: [],
        keywords: ['Adidas'],
        confidence: 0.9,
        raw: {},
      },
      { detailedProfileStatus: 'ready', sourceImage: 'query_crop' },
    );

    const data = update.mock.calls[0][0].data;
    expect(data.brand).toBeUndefined();
    expect(JSON.parse(data.rawJson)).toEqual(
      expect.objectContaining({
        userEdited: true,
        userProfilePatch: { brand: 'Nike' },
        recognizedProfileOriginal: expect.objectContaining({ brand: 'Adidas' }),
      }),
    );
  });

  it('keeps the 0.55 result threshold on the pure ANN fast path', async () => {
    const service = Object.create(
      LocalProductSearchProviderService.prototype,
    ) as Record<string, any>;
    service.normalizeResultLimit = () => 20;
    service.recallWindow = () => 20;
    service.withProfileBrandScope = (filters: unknown) => filters;
    service.loadVerifiedProducts = jest.fn().mockResolvedValue([{ id: 'p1' }]);
    service.applyUserFilters = (products: unknown) => products;
    service.applyCategoryScope = (products: unknown) => products;
    service.computePriceStats = () => ({});
    service.recallByAnn = jest.fn().mockResolvedValue([]);
    service.hasMeaningfulProfile = () => false;
    service.fuseCandidates = () => [
      { product: { id: 'low' }, styleId: null, initialScore: 0.54, annScore: 0.5, finalScore: 0.54 },
      { product: { id: 'high' }, styleId: null, initialScore: 0.56, annScore: 0.5, finalScore: 0.56 },
    ];
    service.fusionKey = (id: string) => id;
    service.passesProfileCandidate = () => true;
    service.fastVerify = (candidate: unknown) => Promise.resolve(candidate);
    service.imageBackfillMinScore = () => 0.38;
    service.resultMinScore = () => 0.55;
    service.compareVerifiedCandidates = () => 0;
    service.searchResultAdapter = {
      toCandidateSeed: (candidate: Record<string, unknown>) => candidate,
    };

    const result = await service.searchAnnOnly({
      keywords: ['shoe'],
      filters: {},
      profile: { category: 'shoe', keywords: [] },
      queryEmbedding: [0.1],
      embeddingKind: 'visual',
      limit: 20,
    });

    expect(result).toHaveLength(1);
    expect(result[0].product.id).toBe('high');
  });
});
