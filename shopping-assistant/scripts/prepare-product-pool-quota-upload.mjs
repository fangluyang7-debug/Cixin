#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const dataRoot = resolveDataRoot(args.dataRoot);
const baseUrl = args.baseUrl ?? 'https://apiserver.zeabur.app';
const batchSource = args.batchSource ?? `collected_quota_mixed_${dateStamp()}`;
const batchSize = positiveInt(args.batchSize, 50);
const groupSize = positiveInt(args.groupSize, 1000);
const generatedRoot = path.join(repoRoot, 'samples/product-pool/generated');
const workRoot = path.resolve(args.workRoot ?? path.join(generatedRoot, batchSource));
const sourceOutRoot = path.join(workRoot, 'sources');
const groupsRoot = path.resolve(args.groupsRoot ?? path.join(workRoot, `quota-groups-${groupSize}x${batchSize}`));
const existingKeysFile = path.resolve(args.existingKeysFile ?? path.join(workRoot, 'cloud-existing-product-keys.jsonl'));
const combinedOut = path.join(workRoot, `${batchSource}-combined.json`);
const reportPath = path.join(workRoot, 'prepare-report.json');

const groupQuotas = {
  jdDigitalXlsx: positiveInt(args.jdDigitalPerGroup, 200),
  jdShoesXlsx: positiveInt(args.jdShoesPerGroup, 200),
  jdHomeXlsx: positiveInt(args.jdHomePerGroup, 100),
  suningVipshopJson: positiveInt(args.suningVipshopJsonPerGroup, 450),
  taobao: positiveInt(args.taobaoPerGroup, 50),
};

const quotaTotal = Object.values(groupQuotas).reduce((sum, value) => sum + value, 0);
if (quotaTotal !== groupSize) {
  throw new Error(`Group quotas must add up to ${groupSize}, got ${quotaTotal}: ${JSON.stringify(groupQuotas)}`);
}
if (groupSize % batchSize !== 0) {
  throw new Error(`groupSize must be divisible by batchSize. groupSize=${groupSize}, batchSize=${batchSize}`);
}

if (args.clean && existsSync(workRoot)) rmSync(workRoot, { recursive: true, force: true });
await mkdir(sourceOutRoot, { recursive: true });

console.log(JSON.stringify({
  repoRoot,
  dataRoot,
  batchSource,
  workRoot,
  groupsRoot,
  groupSize,
  batchSize,
  groupQuotas,
}, null, 2));

const discovered = await discoverSourceFiles(dataRoot);
const sourceSets = buildSourceSets(discovered);

const normalized = {};
for (const [bucket, spec] of Object.entries(sourceSets)) {
  if (spec.files.length === 0) {
    console.warn(`No files for bucket ${bucket}`);
    normalized[bucket] = { path: null, items: [] };
    continue;
  }
  const outFull = path.join(sourceOutRoot, `${bucket}-full.json`);
  const outFirst = path.join(sourceOutRoot, `${bucket}-first80.json`);
  const outRejected = path.join(sourceOutRoot, `${bucket}-rejected.jsonl`);
  const outReport = path.join(sourceOutRoot, `${bucket}-normalize-report.json`);
  console.log(`Normalizing ${bucket}: ${spec.files.length} file(s)`);
  runNode([
    'scripts/normalize-collected-products.mjs',
    '--batch-source',
    `${batchSource}_${bucket}`,
    '--force-platform',
    spec.platform,
    '--out-full',
    outFull,
    '--out-first',
    outFirst,
    '--out-rejected',
    outRejected,
    '--out-report',
    outReport,
    ...spec.files.flatMap((file) => ['--file', file.path]),
  ]);
  const payload = JSON.parse(await readFile(outFull, 'utf8'));
  normalized[bucket] = { path: outFull, items: payload.items ?? [] };
}

let excludeKeys = new Set();
if (!args.skipCloudKeyExport) {
  console.log('Exporting cloud keys to avoid re-uploading existing products...');
  runNode([
    'scripts/export-cloud-product-pool-keys.mjs',
    '--base-url',
    baseUrl,
    '--env-file',
    '.env',
    '--platforms',
    'jd,suning,taobao,tmall,vipshop,xianyu',
    '--out',
    existingKeysFile,
  ]);
}
if (existsSync(existingKeysFile)) excludeKeys = await readExcludeKeys(existingKeysFile);

const pools = {
  jdDigitalXlsx: dedupeAndFilter(normalized.jdDigitalXlsx.items, excludeKeys),
  jdShoesXlsx: dedupeAndFilter(normalized.jdShoesXlsx.items, excludeKeys),
  jdHomeXlsx: dedupeAndFilter(normalized.jdHomeXlsx.items, excludeKeys),
  suningVipshopJson: dedupeAndFilter([
    ...normalized.suningJson.items,
    ...normalized.vipshopJson.items,
  ], excludeKeys),
  taobao: dedupeAndFilter(normalized.taobao.items, excludeKeys),
};

const groups = buildQuotaGroups(pools, groupQuotas, groupSize, batchSize);
await writeQuotaGroups(groups, groupsRoot, batchSource, batchSize);

const allItems = groups.flatMap((group) => group.items);
await writeJson(combinedOut, { batchSource, items: allItems });

const report = {
  generatedAt: new Date().toISOString(),
  dataRoot,
  batchSource,
  workRoot,
  groupsRoot,
  combinedOut,
  existingKeysFile: existsSync(existingKeysFile) ? existingKeysFile : null,
  sourceFiles: Object.fromEntries(Object.entries(sourceSets).map(([bucket, spec]) => [bucket, spec.files.map((file) => file.path)])),
  sourceCounts: Object.fromEntries(Object.entries(normalized).map(([bucket, value]) => [bucket, value.items.length])),
  poolCountsAfterCloudExclusion: Object.fromEntries(Object.entries(pools).map(([bucket, value]) => [bucket, value.length])),
  groupQuotas,
  groupCount: groups.length,
  itemCount: allItems.length,
  categoryCounts: countBy(allItems, categoryOf),
  platformCounts: countBy(allItems, platformOf),
  groupPreview: groups.slice(0, 5).map(groupSummary),
};
await writeJson(reportPath, report);

console.log(JSON.stringify({
  groupsRoot,
  groupCount: groups.length,
  itemCount: allItems.length,
  reportPath,
  platformCounts: report.platformCounts,
  categoryCounts: report.categoryCounts,
  groupPreview: report.groupPreview,
}, null, 2));

function buildQuotaGroups(pools, quotas, targetGroupSize, targetBatchSize) {
  const queues = Object.fromEntries(
    Object.entries(pools).map(([bucket, items]) => [bucket, balancedQueue(items)]),
  );
  const groups = [];
  for (;;) {
    const groupItems = [];
    const groupBucketCounts = {};
    for (const [bucket, quota] of Object.entries(quotas)) {
      const queue = queues[bucket] ?? [];
      const picked = queue.splice(0, quota);
      groupBucketCounts[bucket] = picked.length;
      groupItems.push(...picked.map((item) => markBucket(item, bucket)));
    }
    if (groupItems.length === 0) break;
    const batches = buildQuotaBatches(groupItems, groupBucketCounts, targetBatchSize);
    groups.push({
      index: groups.length + 1,
      items: batches.flatMap((batch) => batch.items),
      batches,
      bucketCounts: groupBucketCounts,
    });
    if (groupItems.length < targetGroupSize) break;
  }
  return groups;
}

function buildQuotaBatches(items, quotas, targetBatchSize) {
  const queues = groupBy(items, bucketOf);
  for (const [bucket, bucketItems] of queues.entries()) {
    queues.set(bucket, balancedQueue(bucketItems));
  }
  const bucketBatchPlans = buildBucketBatchPlans(quotas, Math.ceil(items.length / targetBatchSize), targetBatchSize);
  const batches = [];
  while (remainingTotal(queues) > 0) {
    const batchItems = [];
    const targetSize = Math.min(targetBatchSize, remainingTotal(queues));
    const allocation = bucketBatchPlans[batches.length] ?? allocateSlots(queues, targetSize);
    for (const [bucket, count] of allocation) {
      const queue = queues.get(bucket) ?? [];
      batchItems.push(...queue.splice(0, count));
    }
    batches.push({
      index: batches.length + 1,
      items: interleave(batchItems, (item) => `${bucketOf(item)}:${categoryOf(item)}:${platformOf(item)}`),
    });
  }
  return batches;
}

function buildBucketBatchPlans(bucketCounts, batchCount, targetBatchSize) {
  const buckets = Object.keys(bucketCounts);
  const totalCount = Object.values(bucketCounts).reduce((sum, value) => sum + value, 0);
  const capacities = Array.from({ length: batchCount }, (_, index) =>
    Math.min(targetBatchSize, Math.max(0, totalCount - index * targetBatchSize)),
  );
  const plans = Array.from({ length: batchCount }, () => new Map());
  for (const [bucketIndex, bucket] of buckets.entries()) {
    let remaining = bucketCounts[bucket];
    const base = Math.floor(remaining / batchCount);
    for (let index = 0; index < batchCount; index += 1) {
      const free = capacities[index] - sumPlan(plans[index]);
      const count = Math.min(base, remaining, Math.max(0, free));
      plans[index].set(bucket, count);
      remaining -= count;
    }
    let cursor = bucketIndex % Math.max(1, batchCount);
    while (remaining > 0) {
      let placed = false;
      for (let step = 0; step < batchCount; step += 1) {
        const targetIndex = (cursor + step) % batchCount;
        if (sumPlan(plans[targetIndex]) >= capacities[targetIndex]) continue;
        plans[targetIndex].set(bucket, (plans[targetIndex].get(bucket) ?? 0) + 1);
        remaining -= 1;
        cursor = (targetIndex + 1) % batchCount;
        placed = true;
        break;
      }
      if (!placed) {
        throw new Error(`Cannot distribute bucket ${bucket}; no batch capacity left.`);
      }
    }
  }

  for (const [index, plan] of plans.entries()) {
    const sum = sumPlan(plan);
    if (sum !== capacities[index]) {
      throw new Error(`Invalid batch quota plan: expected ${capacities[index]}, got ${sum}`);
    }
  }
  return plans;
}

function sumPlan(plan) {
  return [...plan.values()].reduce((sum, value) => sum + value, 0);
}

async function writeQuotaGroups(groups, outRoot, sourcePrefix, targetBatchSize) {
  if (existsSync(outRoot)) rmSync(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });
  const manifestGroups = [];
  for (const group of groups) {
    const groupId = `group${String(group.index).padStart(4, '0')}`;
    const groupDir = path.join(outRoot, groupId);
    const batchDir = path.join(groupDir, 'batches');
    await mkdir(batchDir, { recursive: true });
    const groupBatchSource = `${sourcePrefix}_${groupId}`;
    const groupPath = path.join(groupDir, `${sourcePrefix}-${groupId}.json`);
    await writeJson(groupPath, {
      batchSource: groupBatchSource,
      items: group.items.map(stripBucketMarker),
    });
    const batchRecords = [];
    for (const batch of group.batches) {
      const batchId = `batch${String(batch.index).padStart(4, '0')}`;
      const batchPath = path.join(batchDir, `${sourcePrefix}-${groupId}-${batchId}.json`);
      const batchSource = `${groupBatchSource}_${batchId}`;
      await writeJson(batchPath, {
        batchSource,
        items: batch.items.map(stripBucketMarker),
      });
      batchRecords.push({
        index: batch.index,
        count: batch.items.length,
        path: batchPath,
        batchSource,
        bucketCounts: countBy(batch.items, bucketOf),
        platformCounts: countBy(batch.items, platformOf),
        categoryCounts: countBy(batch.items, categoryOf),
      });
    }
    const record = {
      groupId,
      index: group.index,
      count: group.items.length,
      groupPath,
      batchDir,
      batchCount: group.batches.length,
      bucketCounts: group.bucketCounts,
      platformCounts: countBy(group.items, platformOf),
      categoryCounts: countBy(group.items, categoryOf),
      batches: batchRecords,
    };
    const groupManifestPath = path.join(groupDir, 'manifest.json');
    await writeJson(groupManifestPath, { ...record, manifestPath: groupManifestPath, batchSize: targetBatchSize });
    manifestGroups.push({ ...record, manifestPath: groupManifestPath });
  }
  await writeJson(path.join(outRoot, 'manifest.json'), {
    outputRoot: outRoot,
    batchSourcePrefix: sourcePrefix,
    groupSize,
    batchSize,
    groupCount: groups.length,
    itemCount: groups.reduce((sum, group) => sum + group.items.length, 0),
    groups: manifestGroups,
  });
}

function buildSourceSets(files) {
  return {
    jdDigitalXlsx: {
      platform: 'jd',
      files: files.filter((file) => file.ext === '.xlsx' && /数码/i.test(file.base)),
    },
    jdShoesXlsx: {
      platform: 'jd',
      files: files.filter((file) => file.ext === '.xlsx' && /鞋/i.test(file.base)),
    },
    jdHomeXlsx: {
      platform: 'jd',
      files: files.filter((file) => file.ext === '.xlsx' && /家电|家電/i.test(file.base)),
    },
    suningJson: {
      platform: 'suning',
      files: files.filter((file) => file.ext === '.json' && /苏宁|suning/i.test(file.fullText)),
    },
    vipshopJson: {
      platform: 'vipshop',
      files: files.filter((file) => file.ext === '.json' && /唯品|vipshop|vip\.com/i.test(file.fullText)),
    },
    taobao: {
      platform: 'taobao',
      files: files.filter((file) => file.ext === '.json' && /淘宝|taobao|tmall|天猫/i.test(file.fullText)),
    },
  };
}

async function discoverSourceFiles(root) {
  const files = [];
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN'));

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipPath(fullPath)) continue;
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.json', '.jsonl', '.xlsx', '.xls', '.csv'].includes(ext)) continue;
      if (shouldSkipPath(fullPath)) continue;
      const size = statSync(fullPath).size;
      if (size <= 0) continue;
      files.push({
        path: fullPath,
        base: path.basename(fullPath),
        ext,
        fullText: fullPath,
        size,
      });
    }
  }
}

function shouldSkipPath(filePath) {
  const text = String(filePath).toLowerCase();
  return (
    text.includes('测试集') ||
    text.includes('測試集') ||
    text.includes('八爪鱼rpa运行日志') ||
    text.includes('rpa运行日志') ||
    text.includes('lost_and_found') ||
    text.includes('normalize-report') ||
    text.includes('rejected') ||
    text.includes('cloud-existing-product-keys') ||
    text.endsWith('.zip')
  );
}

function resolveDataRoot(input) {
  const candidates = [
    input,
    path.join(repoRoot, 'data'),
    path.resolve(repoRoot, '..', 'data'),
    path.join('E:/', '学习资料', 'data'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(resolved) && statSync(resolved).isDirectory()) return resolved;
  }
  throw new Error(`Data root not found. Tried: ${candidates.join(', ')}`);
}

function balancedQueue(items) {
  return interleave(items, (item) => `${platformOf(item)}:${categoryOf(item)}`);
}

function dedupeAndFilter(items, excludeKeys) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = dedupeKey(item);
    if (excludeKeys.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function dedupeKey(item) {
  const platform = platformOf(item);
  const externalId = nonEmptyString(item?.externalId);
  if (externalId) return `${platform}:${externalId}`.toLowerCase();
  return `${platform}:hash-${shortHash(`${item?.productUrl ?? ''}|${item?.imageUrl ?? ''}|${item?.title ?? ''}`)}`.toLowerCase();
}

async function readExcludeKeys(filePath) {
  const text = await readFile(filePath, 'utf8');
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed);
    if (typeof row === 'string') keys.add(row.toLowerCase());
    else if (row.key) keys.add(String(row.key).toLowerCase());
    else if (row.platform && row.externalId) keys.add(`${row.platform}:${row.externalId}`.toLowerCase());
  }
  return keys;
}

function allocateSlots(queues, targetSize) {
  const active = [...queues.entries()]
    .filter(([, queue]) => queue.length > 0)
    .map(([key, queue]) => ({ key, remaining: queue.length }));
  const allocation = new Map();
  if (active.length === 0) return allocation;

  let slots = targetSize;
  while (slots > 0 && active.some((entry) => entry.remaining > 0)) {
    const available = active.filter((entry) => entry.remaining > 0);
    const passSlots = Math.max(1, Math.floor(slots / available.length));
    let assigned = 0;
    for (const entry of available) {
      if (slots <= 0) break;
      const count = Math.min(entry.remaining, passSlots, slots);
      allocation.set(entry.key, (allocation.get(entry.key) ?? 0) + count);
      entry.remaining -= count;
      slots -= count;
      assigned += count;
    }
    if (assigned === 0) break;
  }
  return allocation;
}

function interleave(items, keyFn) {
  const groups = groupBy(items, keyFn);
  const keys = [...groups.keys()].sort();
  const result = [];
  while (result.length < items.length) {
    let moved = false;
    for (const key of keys) {
      const next = groups.get(key)?.shift();
      if (next) {
        result.push(next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return result;
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function remainingTotal(queues) {
  return [...queues.values()].reduce((sum, queue) => sum + queue.length, 0);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function markBucket(item, bucket) {
  return {
    ...item,
    __quotaBucket: bucket,
  };
}

function stripBucketMarker(item) {
  const { __quotaBucket, ...rest } = item;
  return rest;
}

function bucketOf(item) {
  return item.__quotaBucket ?? 'unknown';
}

function platformOf(item) {
  return nonEmptyString(item?.platform)?.toLowerCase() ?? 'manual';
}

function categoryOf(item) {
  return nonEmptyString(item?.categoryHint ?? item?.rawPayload?.attributes?.category ?? item?.category)?.toLowerCase() ?? 'unknown';
}

function groupSummary(group) {
  return {
    groupId: `group${String(group.index).padStart(4, '0')}`,
    count: group.items.length,
    bucketCounts: group.bucketCounts,
    platformCounts: countBy(group.items, platformOf),
    categoryCounts: countBy(group.items, categoryOf),
    firstBatch: group.batches[0]
      ? {
          count: group.batches[0].items.length,
          bucketCounts: countBy(group.batches[0].items, bucketOf),
          platformCounts: countBy(group.batches[0].items, platformOf),
          categoryCounts: countBy(group.batches[0].items, categoryOf),
        }
      : null,
  };
}

function runNode(commandArgs) {
  execFileSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--data-root') parsed.dataRoot = argv[++index];
    else if (token === '--base-url') parsed.baseUrl = argv[++index];
    else if (token === '--batch-source') parsed.batchSource = argv[++index];
    else if (token === '--work-root') parsed.workRoot = argv[++index];
    else if (token === '--groups-root') parsed.groupsRoot = argv[++index];
    else if (token === '--existing-keys-file') parsed.existingKeysFile = argv[++index];
    else if (token === '--group-size') parsed.groupSize = argv[++index];
    else if (token === '--batch-size') parsed.batchSize = argv[++index];
    else if (token === '--jd-digital-per-group') parsed.jdDigitalPerGroup = argv[++index];
    else if (token === '--jd-shoes-per-group') parsed.jdShoesPerGroup = argv[++index];
    else if (token === '--jd-home-per-group') parsed.jdHomePerGroup = argv[++index];
    else if (token === '--suning-vipshop-json-per-group') parsed.suningVipshopJsonPerGroup = argv[++index];
    else if (token === '--taobao-per-group') parsed.taobaoPerGroup = argv[++index];
    else if (token === '--skip-cloud-key-export') parsed.skipCloudKeyExport = true;
    else if (token === '--clean') parsed.clean = true;
  }
  return parsed;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, 16);
}

function dateStamp() {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}
