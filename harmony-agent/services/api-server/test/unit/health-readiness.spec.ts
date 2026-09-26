import { ConfigService } from '@nestjs/config';
import { CloudReadinessService } from '../../src/core/runtime/cloud-readiness.service';
import { HealthController } from '../../src/modules/health/controllers/health.controller';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';
import { TencentCosStorageAdapterService } from '../../src/adapters/storage/tencent-cos-storage-adapter.service';

describe('Cloud readiness', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });
  function fixture(modelMode = 'required') {
    const model = { baseUrl: 'https://provider.invalid/v1', apiKey: 'test', modelName: 'model' };
    const prisma = { product: { findFirst: jest.fn().mockResolvedValue({ id: 'p' }) } };
    const storage = { probeReadWrite: jest.fn().mockResolvedValue(undefined) };
    const readiness = new CloudReadinessService(prisma as unknown as PrismaService,
      new ConfigService({ runtime: { cloudModelMode: modelMode }, modelProviders: { chat: model, vision: model }, embedding: model }),
      storage as unknown as TencentCosStorageAdapterService);
    return { readiness, prisma, storage };
  }
  it('defers model calls while retaining real infrastructure probes and shopping blocking', async () => {
    global.fetch = jest.fn();
    const { readiness, prisma, storage } = fixture('deferred');
    const controller = new HealthController(readiness);
    const infrastructure = await controller.getInfrastructure();
    expect(infrastructure.data).toMatchObject({ available: true, shoppingAvailable: false, modelMode: 'deferred' });
    await expect(controller.getReadiness()).rejects.toThrow();
    expect((await readiness.check()).checks.embedding.reason).toBe('MODEL_INTEGRATION_DEFERRED');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(1);
    expect(storage.probeReadWrite).toHaveBeenCalledTimes(1);
  });
  it('still fails infrastructure readiness if COS is unavailable in deferred mode', async () => {
    global.fetch = jest.fn();
    const { readiness, storage } = fixture('deferred');
    storage.probeReadWrite.mockRejectedValue(new Error('unavailable'));
    await expect(new HealthController(readiness).getInfrastructure()).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('requires successful DB, COS and model probes and coalesces concurrent checks', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) => ({ ok: true,
      json: async () => url.endsWith('/embeddings/multimodal') ? { data: [{ embedding: [1, 2] }] } : { choices: [{ message: { content: 'OK' } }] } }));
    const { readiness, prisma, storage } = fixture();
    const [left, right] = await Promise.all([readiness.check(), readiness.check()]);
    expect(left.available).toBe(true); expect(right).toBe(left); await readiness.check();
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(1);
    expect(storage.probeReadWrite).toHaveBeenCalledTimes(1); expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(left)).not.toContain('apiKey');
  });
  it('blocks when configured models fail', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    const { readiness } = fixture();
    await expect(new HealthController(readiness).getReadiness()).rejects.toThrow();
    expect((await readiness.check()).checks.vision.available).toBe(false);
  });
  it('does not treat COS configuration as a successful probe', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('unavailable'));
    const { readiness, storage } = fixture(); storage.probeReadWrite.mockRejectedValue(new Error('private url'));
    const result = await readiness.check();
    expect(result.available).toBe(false); expect(result.checks.cos.reason).toBe('COS_PROBE_FAILED');
    expect(JSON.stringify(result)).not.toContain('private url');
  });
});
