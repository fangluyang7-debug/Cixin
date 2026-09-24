import { setTimeout as sleep } from 'node:timers/promises';
import { stableHash } from '../../src/cache/cache-key.util';
import { InMemoryCacheStore } from '../../src/cache/implementations/in-memory-cache.store';

describe('cache behavior', () => {
  it('stores values and preserves empty arrays', async () => {
    const store = new InMemoryCacheStore();
    await store.set('value', { ok: true }, 60);
    await store.set('empty', [], 60);

    await expect(store.get('value')).resolves.toEqual({ ok: true });
    await expect(store.get('empty')).resolves.toEqual([]);
  });

  it('expires values after their TTL', async () => {
    const store = new InMemoryCacheStore();
    await store.set('expires', 'gone', 0.001);
    await sleep(5);
    await expect(store.get('expires')).resolves.toBeNull();
  });

  it('hashes object keys stably without hiding array order', () => {
    expect(stableHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(stableHash(['nike', 'shoe'])).not.toBe(
      stableHash(['shoe', 'nike']),
    );
  });
});
