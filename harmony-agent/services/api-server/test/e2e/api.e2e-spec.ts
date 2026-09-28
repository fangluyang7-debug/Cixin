import { encodeShoppingPayload, decodeShoppingPayload } from '../../src/core/runtime/shopping-payload';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import { createTestApp } from '../helpers/create-test-app';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';

describe('API HTTP contract', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let authorization: string;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const registered = await request(app.getHttpServer()).post('/api/v1/auth/register')
      .send({ email: 'contract@example.test', password: 'test-contract-password' }).expect(201);
    authorization = 'Bearer ' + registered.body.data.accessToken;
    userId = registered.body.data.user.userId;
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

  it('requires authentication and does not run model-dependent tasks in deferred mode', async () => {
    await request(app.getHttpServer()).post('/api/v1/sessions/text').send({ message: '推荐一下' }).expect(401);
    const response = await request(app.getHttpServer()).post('/api/v1/sessions/text')
      .set('Authorization', authorization).send({ message: '推荐一下' }).expect(503);
    expect(response.body.error.code).toBe('RUNTIME_BLOCKED');
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

  it('requires both user identity and maintenance authority before device calibration', async () => {
    const endpoint = '/api/v1/runtime/devices/test-worker/calibrate';
    await request(app.getHttpServer()).post(endpoint).expect(401);
    await request(app.getHttpServer()).post(endpoint).set('Authorization', authorization).expect(403);
    await request(app.getHttpServer()).post(endpoint).set('x-maintenance-token', 'test-maintenance-token').expect(401);
    await request(app.getHttpServer()).post(endpoint).set('Authorization', authorization)
      .set('x-maintenance-token', 'test-maintenance-token').expect(400);
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
        userId,
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
      .get('/api/v1/sessions/session_contract/candidates').set('Authorization', authorization)
      .expect(200);

    expect(decodeShoppingPayload('shopping.candidate-set', encodeShoppingPayload('shopping.candidate-set',response.body.data))).toEqual(response.body.data);
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

  it('uses authenticated revision and idempotency headers on shortlist writes', async () => {
    const previous=process.env.SESSION_REVISION_ENABLED;process.env.SESSION_REVISION_ENABLED='true';
    try {
      const send=()=>request(app.getHttpServer()).post('/api/v1/sessions/session_contract/candidates/candidate_contract/shortlist')
        .set('Authorization',authorization).set('idempotency-key','shortlist-once').set('x-session-version','0').set('x-request-revision','1').send({});
      const first=await send().expect(201),second=await send().expect(201);
      expect(first.body.data.stateVersion).toBe(1);expect(second.body.data).toEqual(first.body.data);
      expect(await prisma.sessionCartItem.count({where:{sessionId:'session_contract'}})).toBe(1);
      await request(app.getHttpServer()).delete('/api/v1/sessions/session_contract/cart/candidate_contract')
        .set('Authorization',authorization).set('idempotency-key','stale').set('x-session-version','0').expect(409);
    } finally { if(previous===undefined)delete process.env.SESSION_REVISION_ENABLED;else process.env.SESSION_REVISION_ENABLED=previous; }
  });

  it('rejects invalid candidate pagination input through the HTTP boundary', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/sessions/session_contract/candidates/more').set('Authorization', authorization)
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
