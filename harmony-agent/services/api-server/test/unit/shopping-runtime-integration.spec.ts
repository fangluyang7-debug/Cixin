import { ConfigService } from '@nestjs/config';
import { CloudPlatformAdapterService } from '../../src/core/runtime/cloud-platform-adapter.service';
import { CloudReadinessService } from '../../src/core/runtime/cloud-readiness.service';
import { ExecutorRegistryService } from '../../src/core/runtime/executor-registry.service';
import { RuntimeRunnerService } from '../../src/core/runtime/runtime-runner.service';
import { RuntimeRunService } from '../../src/core/runtime/runtime-run.service';
import { RuntimeEventBusService } from '../../src/core/runtime/runtime-event-bus.service';
import { ToolRegistryService } from '../../src/core/runtime/tool-registry.service';
import { ResourceAwareSchedulerService } from '../../src/core/runtime/scheduler.service';
import { PerformanceRegistryService } from '../../src/core/runtime/performance-registry.service';
import { TelemetryService } from '../../src/core/runtime/telemetry.service';
import { PlatformDiscoveryService } from '../../src/core/runtime/platform-discovery.service';
import { createShoppingPlugin } from '../../src/core/runtime/shopping-plugin';
import { IMAGE_SEARCH_STAGES } from '../../src/core/runtime/image-search-task-graph';
import { ShoppingImageStagesService } from '../../src/modules/sessions/application/shopping-image-stages.service';
import { ShoppingRuntimeService } from '../../src/modules/sessions/application/shopping-runtime.service';

function fixture(healthy = true) {
  const config = new ConfigService();
  const cloud = new CloudPlatformAdapterService(config, { check: async () => ({ available: healthy, checks: {} }) } as unknown as CloudReadinessService);
  const platforms = { discover: async () => [{ adapter: cloud, profile: await cloud.getStaticProfile(),
    state: await cloud.getRuntimeState(), executors: await cloud.discoverExecutors() }] } as unknown as PlatformDiscoveryService;
  const tools = new ToolRegistryService(); tools.registerPlugin(createShoppingPlugin(config));
  const performance = new PerformanceRegistryService(config);
  const events = new RuntimeEventBusService();
  const scheduler = new ResourceAwareSchedulerService(tools, platforms, performance, config, events);
  const runs = new RuntimeRunService(scheduler, events);
  const registry = new ExecutorRegistryService();
  const runner = new RuntimeRunnerService(runs, registry, new TelemetryService(performance));
  const asset = { id: 'asset_test', assetGroupId: 'group', uploadStatus: 'uploaded', bucketGroup: 'recognition', objectKey: 'input.jpg' };
  const prisma = { imageAsset: { findUnique: jest.fn().mockResolvedValue(asset) }, product: { findMany: jest.fn().mockResolvedValue([]) },
    querySession: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    queryImagePreprocessSnapshot: { create: jest.fn().mockResolvedValue({}) } };
  const storage = { getSignedReadUrl: jest.fn().mockResolvedValue('https://cos.invalid/image?secret-signature'),
    putImage: jest.fn().mockResolvedValue({ provider: 'tencent_cos', bucketGroup: 'recognition', objectKey: 'crop.jpg' }) };
  const content = { readMetadata: jest.fn().mockResolvedValue({ width: 100, height: 100 }),
    cropForEmbedding: jest.fn().mockResolvedValue({ buffer: Buffer.from('image') }) };
  const profiles = { classifyProductCategory: jest.fn().mockResolvedValue({ category: 'shoe', confidence: 0.9 }),
    identifyProductProfile: jest.fn().mockResolvedValue({ category: 'shoe', keywords: ['shoe'], styleTags: [], sceneTags: [], confidence: 0.9, raw: {} }) };
  const embeddings = { embedImage: jest.fn().mockResolvedValue({ provider: 'test', modelName: 'visual', vector: [1,2], dimension: 2, vectorHash: 'hash' }) };
  const seed = { title: 'shoe', platformName: 'shop', amount: '12', currency: 'CNY', stockStatus: 'in_stock',
    productUrl: 'https://shop.invalid/p', shopName: 'shop', shopType: 'store', coverImageUrl: '', matchSummary: {}, normalizedAttributes: {}, rawPayload: {}, recommendationReason: [] };
  const search = { searchFastAnnShoes: jest.fn().mockResolvedValue([seed, seed]) };
  const sessions = { getSession: jest.fn().mockResolvedValue({ session: { sessionId: 'test' } }),
    writeRuntimeCandidateSnapshot: jest.fn().mockResolvedValue('snapshot'),
    createTextSession: jest.fn().mockResolvedValue({ candidates: { items: [] } }) };
  const candidates = { getCurrentCandidates: jest.fn().mockResolvedValue({ items: [seed] }) };
  const assets = { createImageAsset: jest.fn().mockResolvedValue({ assetId: 'asset_test' }) };
  const stages = new ShoppingImageStagesService(prisma as any, assets as any, sessions as any, candidates as any,
    storage as any, content as any, profiles as any, embeddings as any, search as any);
  const runtime = new ShoppingRuntimeService(registry, runner, runs, sessions as any, {} as any, stages);
  runtime.onModuleInit();
  return { runtime, runs, performance, content, profiles, search, sessions, assets };
}

describe('Shopping Runtime integration', () => {
  it('plans and executes every image stage, then learns only from real execution', async () => {
    const test = fixture();
    expect(test.performance.list()).toEqual([]);
    const result = await test.runtime.execute('shopping.image', { taskId: 'phone_test', dto: { assetId: 'asset_test' },
      deviceProfile: { batteryPercent: 70, secretKey: 'not-for-graph' } });
    const run = test.runs.get(result.runtimeRunId)!;
    expect(run.executionPlan?.executionOrder).toEqual([...IMAGE_SEARCH_STAGES]);
    expect(run.executionPlan?.assignments.every(item => item.status === 'succeeded')).toBe(true);
    expect(run.telemetry).toHaveLength(12);
    expect(test.performance.list()).toHaveLength(12);
    expect(test.profiles.classifyProductCategory).toHaveBeenCalledTimes(1);
    expect(test.search.searchFastAnnShoes).toHaveBeenCalledTimes(1);
    expect(test.sessions.writeRuntimeCandidateSnapshot.mock.calls[0][0].candidates).toHaveLength(1);
    expect(JSON.stringify(run)).not.toContain('secret-signature');
    expect(JSON.stringify(run)).not.toContain('not-for-graph');
    expect(run.taskGraph?.clientTaskId).toBe('phone_test');
    expect(run.telemetry[0].metadata?.segmentedTiming).toEqual(expect.objectContaining({ uploadMs: null, downloadMs: null }));
    // A first sample must not trap the workflow below minimumPerformanceSamples.
    await expect(test.runtime.execute('shopping.image', { dto: { assetId: 'asset_test' } })).resolves.toBeDefined();
  });
  it('blocks unavailable cloud without invoking a business service or inventing samples', async () => {
    const test = fixture(false);
    await expect(test.runtime.execute('shopping.image', { dto: { assetId: 'asset_test' } })).rejects.toThrow();
    expect(test.content.readMetadata).not.toHaveBeenCalled(); expect(test.performance.list()).toEqual([]);
    expect(test.runs.latest()?.status).toBe('blocked');
  });
  it('propagates quality failure to every downstream assignment', async () => {
    const test = fixture(); test.content.readMetadata.mockResolvedValue({ width: 1, height: 1 });
    await expect(test.runtime.execute('shopping.image', { dto: { assetId: 'asset_test' } })).rejects.toThrow();
    const run = test.runs.latest()!;
    expect(run.executionPlan?.assignments.find(item => item.taskId === 'quality-check')?.status).toBe('failed');
    expect(test.profiles.classifyProductCategory).not.toHaveBeenCalled();
    expect(test.sessions.writeRuntimeCandidateSnapshot).not.toHaveBeenCalled();
  });
  it('honors phone cloud privacy prohibition', async () => {
    const test = fixture();
    await expect(test.runtime.execute('shopping.image', { dto: { assetId: 'asset_test' }, taskProfile: { allowCloud: false } })).rejects.toThrow();
    expect(test.runs.latest()?.status).toBe('blocked'); expect(test.content.readMetadata).not.toHaveBeenCalled();
  });
  it('schedules the upload before classification', async () => {
    const test = fixture();
    await test.runtime.execute('shopping.image_upload', { dto: { imageBase64: 'eA==', contentType: 'image/jpeg' } });
    expect(test.assets.createImageAsset).toHaveBeenCalledTimes(1);
    expect(test.runs.latest()?.executionPlan?.assignments[1].taskId).toBe('asset');
  });
});
