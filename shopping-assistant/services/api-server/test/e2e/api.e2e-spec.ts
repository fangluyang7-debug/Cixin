import { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import { createTestApp } from '../helpers/create-test-app';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';

describe('API HTTP contract', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the standard success envelope for health', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: { status: 'ok', service: 'api-server' },
      error: null,
    });
    expect(response.body.requestId).toMatch(/^req_/);
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/not-a-real-route')
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND' },
    });
    expect(response.body.requestId).toMatch(/^req_/);
  });

  it('returns clarification with an empty candidate contract and no snapshot', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/sessions/text')
      .send({
        message: '推荐一下',
        entrySource: 'android_app',
        filters: { searchPipelineMode: 'light_tag_ann_fusion' },
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      intent: 'ask_clarification',
      effectiveFilter: { searchPipelineMode: 'light_tag_ann_fusion' },
      candidates: {
        candidateSnapshotId: null,
        degraded: false,
        items: [],
      },
      textQuery: {
        candidateSnapshotId: null,
        stateChangingTurn: false,
      },
    });
  });

  it('protects maintenance endpoints with the configured token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/product-pool/batches')
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('MAINTENANCE_TOKEN_INVALID');
      });

    await request(app.getHttpServer())
      .get('/api/v1/product-pool/batches')
      .set('x-maintenance-token', 'wrong')
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('MAINTENANCE_TOKEN_INVALID');
      });

    await request(app.getHttpServer())
      .get('/api/v1/product-pool/batches')
      .set('x-maintenance-token', 'test-maintenance-token')
      .expect(200)
      .expect(({ body }) => {
        expect(body.success).toBe(true);
        expect(body.data.items).toEqual([]);
      });
  });

  it('returns a stable candidate response contract from persisted snapshots', async () => {
    await prisma.imageAsset.create({
      data: {
        id: 'asset_contract',
        assetGroupId: 'asset_group_contract',
        variantType: 'compressed_recognition',
        sourceType: 'test',
        bucketGroup: 'test',
        objectKey: 'test/query.jpg',
        uploadStatus: 'uploaded',
      },
    });
    await prisma.querySession.create({
      data: {
        id: 'session_contract',
        assetId: 'asset_contract',
        status: 'ready',
        stage: 'candidate_ready',
        entrySource: 'test',
      },
    });
    await prisma.candidateSnapshot.create({
      data: {
        id: 'snapshot_contract',
        sessionId: 'session_contract',
        turnIndex: 0,
        appliedFilterJson: JSON.stringify({ categoryScope: 'shoe' }),
        items: {
          create: {
            id: 'candidate_contract',
            title: '测试候选鞋款',
            platformName: 'jd',
            amount: '499.00',
            currency: 'CNY',
            shopName: '测试旗舰店',
            shopType: 'flagship',
            stockStatus: 'in_stock',
            coverImageUrl: 'https://example.test/product.jpg',
            productUrl: 'https://example.test/product',
            matchSummaryJson: JSON.stringify({
              displayScore: 0.72,
              sameProduct: null,
              verificationStatus: 'not_verified',
            }),
            normalizedAttributesJson: JSON.stringify({ brand: 'Test' }),
            rank: 1,
          },
        },
      },
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/sessions/session_contract/candidates')
      .expect(200);

    expect(response.body.data).toMatchObject({
      candidateSnapshotId: 'snapshot_contract',
      degraded: false,
      appliedFilter: { categoryScope: 'shoe' },
      items: [
        {
          candidateItemId: 'candidate_contract',
          title: '测试候选鞋款',
          platformName: 'jd',
          price: { amount: '499.00', currency: 'CNY' },
          matchSummary: {
            sameProduct: null,
            verificationStatus: 'not_verified',
          },
        },
      ],
    });
  });

  it('rejects invalid candidate pagination input through the HTTP boundary', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/sessions/session_contract/candidates/more')
      .send({ limit: 0 })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_CANDIDATE_MORE_LIMIT');
  });

  it('previews and executes a product import rollback transactionally', async () => {
    await prisma.productImportBatch.create({
      data: {
        id: 'batch_rollback',
        batchSource: 'test',
        status: 'completed',
        totalCount: 1,
        succeededCount: 1,
      },
    });
    await prisma.product.create({
      data: {
        id: 'product_rollback',
        importBatchId: 'batch_rollback',
        externalId: 'external_rollback',
        platform: 'jd',
        title: '待回滚商品',
        priceAmount: '299.00',
        stockStatus: 'in_stock',
        productUrl: 'https://example.test/rollback',
        tagStatus: 'verified',
        category: 'shoe',
      },
    });
    await prisma.productImportChange.create({
      data: {
        id: 'change_rollback',
        batchId: 'batch_rollback',
        productId: 'product_rollback',
        action: 'created',
        afterJson: '{}',
      },
    });

    const preview = await request(app.getHttpServer())
      .post('/api/v1/product-pool/batches/batch_rollback/rollback')
      .set('x-maintenance-token', 'test-maintenance-token')
      .send({ dryRun: true })
      .expect(201);
    expect(preview.body.data).toMatchObject({
      dryRun: true,
      affectedProductCount: 1,
      conflictCount: 0,
    });
    await expect(
      prisma.product.findUnique({ where: { id: 'product_rollback' } }),
    ).resolves.not.toBeNull();

    const rollback = await request(app.getHttpServer())
      .post('/api/v1/product-pool/batches/batch_rollback/rollback')
      .set('x-maintenance-token', 'test-maintenance-token')
      .send({ dryRun: false })
      .expect(201);
    expect(rollback.body.data).toMatchObject({
      dryRun: false,
      deletedProductCount: 1,
      rolledBackChangeCount: 1,
    });
    await expect(
      prisma.product.findUnique({ where: { id: 'product_rollback' } }),
    ).resolves.toBeNull();
    await expect(
      prisma.productImportBatch.findUnique({ where: { id: 'batch_rollback' } }),
    ).resolves.toMatchObject({ status: 'rolled_back' });
  });
});
