import { ArtifactStoreService, canonicalJson, contentHash } from '../../src/core/runtime/artifact-store.service';
import { PrismaService } from '../../src/persistence/prisma/prisma.service';

describe('Artifact content and authorization', () => {
  function fixture() {
    const records = new Map<string, any>();
    const prisma = { artifactRecord: {
      create: jest.fn(async ({ data }) => { const row = { payloadJson: null, expiresAt: null, createdAt: new Date(), ...data }; records.set(row.id, row); return row; }),
      findFirst: jest.fn(async ({ where }) => [...records.values()].find(row => Object.entries(where).every(([k, v]) => row[k] === v)))
    }, imageAsset: { findFirst: jest.fn(async () => ({ id: 'asset_a' })) } };
    return { records, store: new ArtifactStoreService(prisma as unknown as PrismaService) };
  }
  it('canonicalizes key order without changing decimal money or null', () => {
    expect(canonicalJson({ z: null, a: { money: '123.4500', tags: ['x', 'y'] } })).toBe(canonicalJson({ a: { tags: ['x', 'y'], money: '123.4500' }, z: null }));
    for (const value of [undefined, NaN, Infinity, { x: undefined }, new Date()]) expect(() => canonicalJson(value)).toThrow();
  });
  it('rejects cross-owner reads, expired content and corruption', async () => {
    const { store, records } = fixture();
    const ref = await store.publishJson('owner_a', 'test.query', { text: '鞋', price: '12.3400' });
    expect((await store.manifest('owner_a', ref)).sizeBytes).toBe(Buffer.byteLength('{"price":"12.3400","text":"鞋"}'));
    await expect(store.read('owner_b', ref)).rejects.toThrow('ARTIFACT_NOT_FOUND');
    await expect(store.read('owner_a', { ...ref, contentVersion: 2 })).rejects.toThrow();
    const row = records.get(ref.artifactId);
    row.payloadJson += ' ';
    await expect(store.read('owner_a', ref)).rejects.toThrow('ARTIFACT_NOT_FOUND');
    row.payloadJson = '{"price":"12.3400","text":"鞋"}'; row.expiresAt = new Date(0);
    await expect(store.read('owner_a', ref)).rejects.toThrow('ARTIFACT_NOT_FOUND');
  });
  it('hashes actual uploaded bytes and keeps object locators private', async () => {
    const { store } = fixture(); const bytes = Buffer.from([1, 2, 3]);
    const ref = await store.publishImage('owner_a', 'asset_a', bytes, 'image/jpeg');
    expect(ref.contentHash).toBe(contentHash(bytes));
    expect(await store.imageAsset('owner_a', ref)).toBe('asset_a');
    expect(JSON.stringify(await store.manifest('owner_a', ref))).not.toContain('asset_a');
  });
  it('does not publish a JSON object with unauthorized dependencies', async () => {
    const { store, records } = fixture();
    const ref = await store.publishJson('owner_a', 'test.query', {});
    await expect(store.publishJson('owner_b', 'shopping.result', {}, [ref])).rejects.toThrow();
    expect(records.size).toBe(1);
  });
});
