#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  printUsage();
  process.exit(1);
}

const inputPath = path.resolve(args.file);
const payload = JSON.parse(await readFile(inputPath, 'utf8'));

if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
  throw new Error('Input must be a ProductPool payload: { batchSource, items: [] }.');
}

const groupSize = parsePositiveInteger(args.groupSize) ?? 1000;
const batchSize = parsePositiveInteger(args.batchSize) ?? 50;
const perPlatformLimit = parsePositiveInteger(args.perPlatformLimit);
const selectedPlatforms = parseCsvSet(args.platforms);
const inputBaseName = path.basename(inputPath, path.extname(inputPath));
const outputRoot = path.resolve(
  args.outRoot ??
    path.join(
      path.dirname(inputPath),
      `${inputBaseName}-by-platform-${perPlatformLimit ? `first${perPlatformLimit}` : 'all'}-${groupSize}x${batchSize}`,
    ),
);
const batchSourcePrefix =
  nonEmptyString(args.batchSourcePrefix) ?? nonEmptyString(payload.batchSource) ?? inputBaseName;

if (args.clean) {
  await rm(outputRoot, { force: true, recursive: true });
}

await mkdir(outputRoot, { recursive: true });

const byPlatform = new Map();
for (const item of payload.items) {
  const platform = nonEmptyString(item?.platform)?.toLowerCase() ?? 'manual';
  if (selectedPlatforms && !selectedPlatforms.has(platform)) continue;
  if (!byPlatform.has(platform)) byPlatform.set(platform, []);
  byPlatform.get(platform).push(item);
}

const platforms = [];
for (const [platform, sourceItems] of [...byPlatform.entries()].sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  const items = perPlatformLimit ? sourceItems.slice(0, perPlatformLimit) : sourceItems;
  if (items.length === 0) continue;

  const platformDir = path.join(outputRoot, platform);
  await mkdir(platformDir, { recursive: true });

  const platformBatchSourcePrefix = `${batchSourcePrefix}_${platform}`;
  const platformFilePath = path.join(
    platformDir,
    `${inputBaseName}-${platform}-${perPlatformLimit ? `first${items.length}` : 'all'}.json`,
  );

  await writeJson(platformFilePath, {
    batchSource: platformBatchSourcePrefix,
    items,
  });

  const groups = [];
  let totalBatchCount = 0;

  for (let groupOffset = 0; groupOffset < items.length; groupOffset += groupSize) {
    const groupIndex = groups.length + 1;
    const groupId = `group${String(groupIndex).padStart(4, '0')}`;
    const groupItems = items.slice(groupOffset, groupOffset + groupSize);
    const groupDir = path.join(platformDir, groupId);
    const batchDir = path.join(groupDir, 'batches');
    const groupBatchSource = `${platformBatchSourcePrefix}_${groupId}`;
    const groupFilePath = path.join(
      groupDir,
      `${inputBaseName}-${platform}-${groupId}.json`,
    );
    const batches = [];

    await mkdir(batchDir, { recursive: true });

    await writeJson(groupFilePath, {
      batchSource: groupBatchSource,
      items: groupItems,
    });

    for (let batchOffset = 0; batchOffset < groupItems.length; batchOffset += batchSize) {
      const batchIndex = batches.length + 1;
      const batchId = `batch${String(batchIndex).padStart(4, '0')}`;
      const globalBatchIndex = totalBatchCount + 1;
      const batchItems = groupItems.slice(batchOffset, batchOffset + batchSize);
      const batchFilePath = path.join(
        batchDir,
        `${inputBaseName}-${platform}-${groupId}-${batchId}.json`,
      );
      const batchSource = `${groupBatchSource}_${batchId}`;

      await writeJson(batchFilePath, {
        batchSource,
        items: batchItems,
      });

      batches.push({
        index: batchIndex,
        globalIndex: globalBatchIndex,
        offset: groupOffset + batchOffset,
        count: batchItems.length,
        path: batchFilePath,
        batchSource,
      });
      totalBatchCount += 1;
    }

    const groupManifestPath = path.join(groupDir, 'manifest.json');
    const groupSummary = {
      index: groupIndex,
      groupId,
      offset: groupOffset,
      count: groupItems.length,
      groupPath: groupFilePath,
      manifestPath: groupManifestPath,
      batchDir,
      batchCount: batches.length,
      batches,
    };

    await writeJson(groupManifestPath, {
      inputPath,
      outputRoot,
      platform,
      platformFilePath,
      batchSourcePrefix: platformBatchSourcePrefix,
      groupSize,
      batchSize,
      ...groupSummary,
    });

    groups.push(groupSummary);
  }

  const platformManifestPath = path.join(platformDir, 'manifest.json');
  const platformSummary = {
    platform,
    sourceCount: sourceItems.length,
    writtenCount: items.length,
    platformDir,
    platformFilePath,
    manifestPath: platformManifestPath,
    groupCount: groups.length,
    batchCount: totalBatchCount,
    groups,
  };

  await writeJson(platformManifestPath, {
    inputPath,
    outputRoot,
    sourceBatchSource: payload.batchSource ?? null,
    batchSourcePrefix: platformBatchSourcePrefix,
    groupSize,
    batchSize,
    perPlatformLimit: perPlatformLimit ?? null,
    ...platformSummary,
  });

  platforms.push(platformSummary);
}

const manifest = {
  inputPath,
  outputRoot,
  sourceBatchSource: payload.batchSource ?? null,
  batchSourcePrefix,
  sourceCount: payload.items.length,
  groupSize,
  batchSize,
  perPlatformLimit: perPlatformLimit ?? null,
  platformCount: platforms.length,
  writtenCount: platforms.reduce((sum, platform) => sum + platform.writtenCount, 0),
  platforms,
};

const manifestPath = path.join(outputRoot, 'manifest.json');
await writeJson(manifestPath, manifest);

console.log(
  JSON.stringify(
    {
      ...manifest,
      manifestPath,
      platforms: platforms.map(summarizePlatform),
    },
    null,
    2,
  ),
);

function summarizePlatform(platform) {
  return {
    platform: platform.platform,
    sourceCount: platform.sourceCount,
    writtenCount: platform.writtenCount,
    platformDir: platform.platformDir,
    platformFilePath: platform.platformFilePath,
    manifestPath: platform.manifestPath,
    groupCount: platform.groupCount,
    batchCount: platform.batchCount,
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' || token === '-f') parsed.file = argv[++index];
    else if (token === '--out-root') parsed.outRoot = argv[++index];
    else if (token === '--group-size') parsed.groupSize = argv[++index];
    else if (token === '--batch-size') parsed.batchSize = argv[++index];
    else if (token === '--per-platform-limit') parsed.perPlatformLimit = argv[++index];
    else if (token === '--platforms') parsed.platforms = argv[++index];
    else if (token === '--batch-source-prefix') parsed.batchSourcePrefix = argv[++index];
    else if (token === '--clean') parsed.clean = true;
    else if (!parsed.file) parsed.file = token;
  }
  return parsed;
}

function parsePositiveInteger(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseCsvSet(value) {
  if (!value) return null;
  const items = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? new Set(items) : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/split-product-pool-by-platform.mjs --file samples/product-pool/generated/collected_all_20260606-full.json --per-platform-limit 1000
  node scripts/split-product-pool-by-platform.mjs --file input.json --platforms suning,vipshop,xianyu --group-size 1000 --batch-size 50 --out-root output-dir --clean
`);
}
