import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadSeedCatalog, assertImportReadiness, assertBatch, imageItem, main } from './upload-harmony-products.mjs';

test('uses exactly the current phone manifest and deduplicates with server identity rules', async () => {
  const catalog = await loadSeedCatalog();
  assert.equal(catalog.files.length, 22);
  assert.equal(catalog.sourceCount, 2700);
  assert.equal(catalog.items.length, 2496);
  assert.equal(catalog.duplicates.length, 204);
  assert.equal(new Set(catalog.items.map(item => `${item.platform}:${item.externalId}`)).size, 2496);
  assert.ok(catalog.files.every(file => !file.name.includes('embedding')));
});

test('allows an empty catalog for bootstrap but blocks missing infrastructure/models', () => {
  const ready = { modelMode: 'required', available: false, checks: Object.fromEntries(
    ['database', 'cos', 'vision', 'embedding'].map(key => [key, { available: true }])) };
  assert.doesNotThrow(() => assertImportReadiness(ready));
  for (const key of ['database', 'cos', 'vision', 'embedding']) {
    assert.throws(() => assertImportReadiness({ ...ready, checks: { ...ready.checks, [key]: { available: false } } }));
  }
  assert.throws(() => assertImportReadiness({ ...ready, modelMode: 'deferred' }));
});

test('does not equate accepted/completed batches with searchable vector coverage', () => {
  const batch = { status: 'completed', failedCount: 0, succeededCount: 25, productCount: 25,
    searchableProductCount: 25, productsWithEmbeddingCount: 25, embeddingCount: 50 };
  assert.doesNotThrow(() => assertBatch(batch, 25));
  for (const change of [{ status: 'queued' }, { failedCount: 1 }, { productCount: 24 },
    { searchableProductCount: 24 }, { productsWithEmbeddingCount: 24 }, { embeddingCount: 25 }]) {
    assert.throws(() => assertBatch({ ...batch, ...change }, 25));
  }
});

test('transports image bytes as JPEG, without cloud-inaccessible local paths', async () => {
  const image = await sharp({ create: { width: 32, height: 64, channels: 3, background: 'red' } }).png().toBuffer();
  const item = await imageItem({ title: 'test', localImagePath: 'unused.png', imageDataBase64: image.toString('base64') });
  assert.equal(item.localImagePath, undefined);
  assert.equal(item.imageContentType, 'image/jpeg');
  const metadata = await sharp(Buffer.from(item.imageDataBase64, 'base64')).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 480);
  assert.equal(metadata.height, 480);
});

test('check-only authenticates and accepts readiness 503 caused only by an empty catalog without uploading', async t => {
  const oldEnv = { ...process.env };
  t.after(() => { process.env = oldEnv; });
  process.env.API_BASE_URL = 'https://cloud.example';
  process.env.MAINTENANCE_API_TOKEN = 'test-maintenance';
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['x-maintenance-token'], 'test-maintenance');
    if (url.endsWith('/health/readiness')) return new Response(JSON.stringify({ error: { details: {
      modelMode: 'required', checks: Object.fromEntries(['database', 'cos', 'vision', 'embedding'].map(key => [key, { available: true }])),
    } } }), { status: 503 });
    return new Response(JSON.stringify({ success: true, data: [] }));
  });
  await main(['--check-only']);
  assert.equal(calls.length, 2);
});

async function uploadFixture(t, failPost = false) {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'harmony-upload-test-'));
  const oldEnv = { ...process.env };
  t.after(async () => { process.env = oldEnv; await rm(outputDirectory, { recursive: true, force: true }); });
  process.env.API_BASE_URL = 'https://cloud.example';
  process.env.MAINTENANCE_API_TOKEN = 'test-maintenance';
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
  const catalog = { files: [], sourceCount: 1, duplicates: [], digest: 'fixture', items: [{
    externalId: 'fixture', platform: 'manual', title: 'test', price: '1',
    productUrl: 'https://example.com/product', imageDataBase64: image.toString('base64'),
  }] };
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const reply = data => new Response(JSON.stringify({ success: true, data }));
    if (options.method === 'POST') {
      posts++;
      const body = JSON.parse(options.body);
      assert.equal(body.items.length, 1);
      assert.equal(body.items[0].imageContentType, 'image/jpeg');
      if (failPost) throw new Error('Simulated connection lost after sending');
      return reply({ batchId: 'test-batch' });
    }
    if (url.endsWith('/health/readiness')) return reply({ available: true, modelMode: 'required',
      checks: Object.fromEntries(['database', 'cos', 'vision', 'embedding'].map(key => [key, { available: true }])) });
    if (url.endsWith('/batches/test-batch')) return reply({ status: 'completed', failedCount: 0, succeededCount: 1,
      productCount: 1, searchableProductCount: 1, productsWithEmbeddingCount: 1, embeddingCount: 2 });
    return reply({ totalProducts: 1 });
  });
  return { dependencies: { outputDirectory, loadCatalog: async () => catalog }, posts: () => posts };
}

test('uploads, verifies coverage, persists progress and resumes without duplicate POSTs', async t => {
  const fixture = await uploadFixture(t);
  await main([], fixture.dependencies);
  await main([], fixture.dependencies);
  assert.equal(fixture.posts(), 1);
  const progress = JSON.parse(await readFile(path.join(fixture.dependencies.outputDirectory, 'progress.json'), 'utf8'));
  assert.ok(Object.values(progress.batches).every(batch => batch.complete));
});

test('a lost POST response is recorded and never automatically resubmitted', async t => {
  const fixture = await uploadFixture(t, true);
  await assert.rejects(main([], fixture.dependencies), /connection lost/);
  await assert.rejects(main([], fixture.dependencies), /Uncertain prior submission/);
  assert.equal(fixture.posts(), 1);
});

test('retries a transient readiness failure before uploading', async t => {
  const fixture = await uploadFixture(t);
  let readinessCalls = 0;
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/health/readiness')) {
      readinessCalls += 1;
      if (readinessCalls === 1) return new Response(JSON.stringify({ error: { details: {
        modelMode: 'required', checks: { database: { available: true }, cos: { available: true },
          vision: { available: false }, embedding: { available: true } },
      } } }), { status: 503 });
    }
    return originalFetch(url, options);
  });
  await main(['--check-only'], fixture.dependencies);
  assert.equal(readinessCalls, 2);
});
