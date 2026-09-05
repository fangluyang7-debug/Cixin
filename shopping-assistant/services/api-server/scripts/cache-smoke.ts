import * as assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { TREND_CACHE_KEYS } from '../src/cache/cache-namespaces';
import { stableHash } from '../src/cache/cache-key.util';
import { InMemoryCacheStore } from '../src/cache/implementations/in-memory-cache.store';

async function main() {
  const store = new InMemoryCacheStore();
  await store.set('smoke:value', { ok: true }, 60);
  assert.deepEqual(await store.get('smoke:value'), { ok: true });

  await store.set('smoke:empty-array', [], 60);
  assert.deepEqual(await store.get('smoke:empty-array'), []);

  await store.set('smoke:expires', 'gone', 0.001);
  await sleep(5);
  assert.equal(await store.get('smoke:expires'), null);

  assert.equal(
    stableHash({ b: 2, a: { d: 4, c: 3 } }),
    stableHash({ a: { c: 3, d: 4 }, b: 2 }),
  );
  assert.notEqual(stableHash(['nike', 'shoe']), stableHash(['shoe', 'nike']));

  assert.equal(TREND_CACHE_KEYS.queryPlan('item-hash'), 'trend:query-plan:item-hash');
  assert.equal(
    TREND_CACHE_KEYS.search('serper', 'query-hash'),
    'trend:search:serper:query-hash',
  );
  assert.equal(
    TREND_CACHE_KEYS.extract('base-hash', 'result-hash'),
    'trend:extract:base-hash:result-hash',
  );
  assert.equal(
    TREND_CACHE_KEYS.recommend('base-hash', 'pool-v1'),
    'trend:recommend:base-hash:pool-v1',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
