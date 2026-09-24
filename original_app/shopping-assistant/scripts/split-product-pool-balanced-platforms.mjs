#!/usr/bin/env node

import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));

if (!args.files || args.files.length === 0) {
  printUsage();
  process.exit(1);
}

const groupSize = parsePositiveInteger(args.groupSize) ?? 1000;
const batchSize = parsePositiveInteger(args.batchSize) ?? 50;
const perPlatformLimit = parsePositiveInteger(args.perPlatformLimit);
const inputPaths = args.files.map((file) => path.resolve(file));
const firstInputPath = inputPaths[0];
const inputBaseName = path.basename(firstInputPath, path.extname(firstInputPath));
const outputRoot = path.resolve(
  args.outRoot ?? path.join(path.dirname(firstInputPath), `${inputBaseName}-balanced-${groupSize}x${batchSize}`),
);
const combinedOut = args.combinedOut ? path.resolve(args.combinedOut) : null;
const batchSourcePrefix = nonEmptyString(args.batchSourcePrefix) ?? `${inputBaseName}_balanced`;
const excludeKeys = await readExcludeKeys(args.excludeKeysFile);

if (args.clean) {
  await rm(outputRoot, { force: true, recursive: true });
}

await mkdir(outputRoot, { recursive: true });

const { items, inputSummaries, duplicateCount, excludedCount } = await readAndDedupeItems(inputPaths);
const selectedItems = applyPerPlatformLimit(items, perPlatformLimit);
const batches = buildBalancedBatches(selectedItems, batchSize);
const groups = await writeGroups({ batches, outputRoot, inputBaseName, batchSourcePrefix, groupSize });

if (combinedOut) {
  await mkdir(path.dirname(combinedOut), { recursive: true });
  await writeJson(combinedOut, {
    batchSource: batchSourcePrefix,
    items: selectedItems,
  });
}

const manifest = {
  inputPaths,
  outputRoot,
  combinedOut,
  batchSourcePrefix,
  sourceCount: items.length + duplicateCount + excludedCount,
  dedupedCount: items.length,
  duplicateCount,
  excludedCloudExistingCount: excludedCount,
  excludeKeysFile: args.excludeKeysFile ? path.resolve(args.excludeKeysFile) : null,
  writtenCount: selectedItems.length,
  groupSize,
  batchSize,
  perPlatformLimit: perPlatformLimit ?? null,
  platformCounts: countByPlatform(selectedItems),
  inputSummaries,
  groupCount: groups.length,
  batchCount: batches.length,
  groups,
};

const manifestPath = path.join(outputRoot, 'manifest.json');
await writeJson(manifestPath, manifest);

console.log(
  JSON.stringify(
    {
      ...manifest,
      manifestPath,
      groups: groups.map((group) => ({
        groupId: group.groupId,
        count: group.count,
        batchCount: group.batchCount,
        groupPath: group.groupPath,
        manifestPath: group.manifestPath,
      })),
    },
    null,
    2,
  ),
);

async function readAndDedupeItems(inputPaths) {
  const seen = new Set();
  const items = [];
  const inputSummaries = [];
  let duplicateCount = 0;
  let excludedCount = 0;

  for (const inputPath of inputPaths) {
    const payload = JSON.parse(await readFile(inputPath, 'utf8'));
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
      throw new Error(`Input must be a ProductPool payload with items[]: ${inputPath}`);
    }

    let acceptedCount = 0;
    let excludedExistingCount = 0;
    for (const item of payload.items) {
      const key = dedupeKey(item);
      if (excludeKeys.has(key)) {
        excludedCount += 1;
        excludedExistingCount += 1;
        continue;
      }
      if (seen.has(key)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(key);
      items.push(item);
      acceptedCount += 1;
    }

    inputSummaries.push({
      inputPath,
      batchSource: payload.batchSource ?? null,
      sourceCount: payload.items.length,
      acceptedCount,
      excludedExistingCount,
      platformCounts: countByPlatform(payload.items),
    });
  }

  return { items, inputSummaries, duplicateCount, excludedCount };
}

function applyPerPlatformLimit(items, limit) {
  if (!limit) return items;
  const counts = {};
  const selected = [];
  for (const item of items) {
    const platform = platformOf(item);
    counts[platform] = counts[platform] ?? 0;
    if (counts[platform] >= limit) continue;
    selected.push(item);
    counts[platform] += 1;
  }
  return selected;
}

function buildBalancedBatches(items, batchSize) {
  const queues = new Map();
  for (const item of items) {
    const platform = platformOf(item);
    if (!queues.has(platform)) queues.set(platform, []);
    queues.get(platform).push(item);
  }

  const batches = [];
  while (remainingTotal(queues) > 0) {
    const targetSize = Math.min(batchSize, remainingTotal(queues));
    const allocation = allocateBatchSlots(queues, targetSize);
    const batchItems = [];
    for (const [platform, count] of allocation) {
      const queue = queues.get(platform) ?? [];
      batchItems.push(...queue.splice(0, count));
    }
    batches.push({
      index: batches.length + 1,
      items: interleaveByPlatform(batchItems),
      platformCounts: countByPlatform(batchItems),
    });
  }

  return batches;
}

function allocateBatchSlots(queues, targetSize) {
  const active = [...queues.entries()]
    .filter(([, queue]) => queue.length > 0)
    .map(([platform, queue]) => ({ platform, remaining: queue.length }));
  const allocation = new Map();
  if (active.length === 0) return allocation;

  let slots = targetSize;
  if (active.length <= targetSize) {
    for (const entry of active) {
      allocation.set(entry.platform, 1);
      slots -= 1;
      entry.remaining -= 1;
    }
  }

  while (slots > 0) {
    const remaining = active.reduce((sum, entry) => sum + Math.max(entry.remaining, 0), 0);
    if (remaining <= 0) break;

    const ranked = active
      .filter((entry) => entry.remaining > 0)
      .map((entry) => {
        const exact = (entry.remaining / remaining) * slots;
        return {
          ...entry,
          floor: Math.floor(exact),
          fraction: exact - Math.floor(exact),
        };
      })
      .sort((left, right) => right.fraction - left.fraction || right.remaining - left.remaining);

    let assigned = 0;
    for (const entry of ranked) {
      const count = Math.min(entry.remaining, entry.floor);
      if (count <= 0) continue;
      allocation.set(entry.platform, (allocation.get(entry.platform) ?? 0) + count);
      const activeEntry = active.find((candidate) => candidate.platform === entry.platform);
      activeEntry.remaining -= count;
      assigned += count;
    }

    slots -= assigned;
    if (assigned > 0) continue;

    const next = ranked.find((entry) => entry.remaining > 0);
    if (!next) break;
    allocation.set(next.platform, (allocation.get(next.platform) ?? 0) + 1);
    const activeEntry = active.find((candidate) => candidate.platform === next.platform);
    activeEntry.remaining -= 1;
    slots -= 1;
  }

  return allocation;
}

function interleaveByPlatform(items) {
  const queues = new Map();
  for (const item of items) {
    const platform = platformOf(item);
    if (!queues.has(platform)) queues.set(platform, []);
    queues.get(platform).push(item);
  }

  const orderedPlatforms = [...queues.keys()].sort();
  const result = [];
  while (result.length < items.length) {
    for (const platform of orderedPlatforms) {
      const next = queues.get(platform)?.shift();
      if (next) result.push(next);
    }
  }
  return result;
}

async function writeGroups({ batches, outputRoot, inputBaseName, batchSourcePrefix, groupSize }) {
  const groups = [];
  const groupBatchCapacity = Math.max(1, Math.floor(groupSize / batchSize));

  for (let batchOffset = 0; batchOffset < batches.length; batchOffset += groupBatchCapacity) {
    const groupBatches = batches.slice(batchOffset, batchOffset + groupBatchCapacity);
    const groupIndex = groups.length + 1;
    const groupId = `group${String(groupIndex).padStart(4, '0')}`;
    const groupDir = path.join(outputRoot, groupId);
    const batchDir = path.join(groupDir, 'batches');
    const groupItems = groupBatches.flatMap((batch) => batch.items);
    const groupBatchSource = `${batchSourcePrefix}_${groupId}`;
    const groupPath = path.join(groupDir, `${inputBaseName}-balanced-${groupId}.json`);

    await mkdir(batchDir, { recursive: true });
    await writeJson(groupPath, {
      batchSource: groupBatchSource,
      items: groupItems,
    });

    const writtenBatches = [];
    for (const batch of groupBatches) {
      const localBatchIndex = writtenBatches.length + 1;
      const batchId = `batch${String(localBatchIndex).padStart(4, '0')}`;
      const batchSource = `${groupBatchSource}_${batchId}`;
      const batchPath = path.join(batchDir, `${inputBaseName}-balanced-${groupId}-${batchId}.json`);
      await writeJson(batchPath, {
        batchSource,
        items: batch.items,
      });
      writtenBatches.push({
        index: localBatchIndex,
        globalIndex: batch.index,
        count: batch.items.length,
        platformCounts: batch.platformCounts,
        path: batchPath,
        batchSource,
      });
    }

    const groupManifest = {
      groupId,
      index: groupIndex,
      count: groupItems.length,
      platformCounts: countByPlatform(groupItems),
      groupPath,
      batchDir,
      batchCount: writtenBatches.length,
      batches: writtenBatches,
    };
    const groupManifestPath = path.join(groupDir, 'manifest.json');
    await writeJson(groupManifestPath, {
      outputRoot,
      batchSourcePrefix: groupBatchSource,
      groupSize,
      batchSize,
      ...groupManifest,
      manifestPath: groupManifestPath,
    });
    groups.push({ ...groupManifest, manifestPath: groupManifestPath });
  }

  return groups;
}

function remainingTotal(queues) {
  return [...queues.values()].reduce((sum, queue) => sum + queue.length, 0);
}

function countByPlatform(items) {
  const counts = {};
  for (const item of items) {
    const platform = platformOf(item);
    counts[platform] = (counts[platform] ?? 0) + 1;
  }
  return counts;
}

function platformOf(item) {
  return nonEmptyString(item?.platform)?.toLowerCase() ?? 'manual';
}

function dedupeKey(item) {
  const platform = platformOf(item);
  const externalId = nonEmptyString(item?.externalId);
  if (externalId) return `${platform}:${externalId}`;
  return `${platform}:hash-${shortHash(`${item?.productUrl ?? ''}|${item?.imageUrl ?? ''}|${item?.title ?? ''}`)}`;
}

async function readExcludeKeys(filePath) {
  if (!filePath) return new Set();
  const resolved = path.resolve(filePath);
  const text = await readFile(resolved, 'utf8');
  const keys = new Set();

  if (!text.trim()) return keys;
  if (text.trim().startsWith('[')) {
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error(`Exclude keys JSON must be an array: ${resolved}`);
    for (const row of rows) addExcludeKey(keys, row);
    return keys;
  }

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      addExcludeKey(keys, JSON.parse(trimmed));
    } catch (error) {
      throw new Error(`Invalid exclude key JSONL at ${resolved}:${index + 1}: ${error.message}`);
    }
  }
  return keys;
}

function addExcludeKey(keys, row) {
  if (typeof row === 'string') {
    keys.add(row.trim().toLowerCase());
    return;
  }
  const directKey = nonEmptyString(row?.key);
  if (directKey) {
    keys.add(directKey.toLowerCase());
    return;
  }
  const platform = nonEmptyString(row?.platform)?.toLowerCase();
  const externalId = nonEmptyString(row?.externalId);
  if (platform && externalId) keys.add(`${platform}:${externalId}`);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, 16);
}

function parseArgs(argv) {
  const parsed = { files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' || token === '-f') parsed.files.push(argv[++index]);
    else if (token === '--out-root') parsed.outRoot = argv[++index];
    else if (token === '--combined-out') parsed.combinedOut = argv[++index];
    else if (token === '--exclude-keys-file') parsed.excludeKeysFile = argv[++index];
    else if (token === '--group-size') parsed.groupSize = argv[++index];
    else if (token === '--batch-size') parsed.batchSize = argv[++index];
    else if (token === '--per-platform-limit') parsed.perPlatformLimit = argv[++index];
    else if (token === '--batch-source-prefix') parsed.batchSourcePrefix = argv[++index];
    else if (token === '--clean') parsed.clean = true;
    else if (!parsed.files.length) parsed.files.push(token);
  }
  return parsed;
}

function parsePositiveInteger(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/split-product-pool-balanced-platforms.mjs --file jd-full.json --file suning-full.json --out-root output-dir --combined-out combined.json
  node scripts/split-product-pool-balanced-platforms.mjs --file input-a.json --file input-b.json --exclude-keys-file cloud-product-keys.jsonl --batch-size 50 --group-size 1000 --per-platform-limit 1000 --clean
`);
}
