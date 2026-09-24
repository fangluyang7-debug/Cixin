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
const maxGroups = parsePositiveInteger(args.maxGroups);
const inputBaseName = path.basename(inputPath, path.extname(inputPath));
const outputRoot = path.resolve(
  args.outRoot ?? path.join(path.dirname(inputPath), `${inputBaseName}-groups-${groupSize}x${batchSize}`),
);
const batchSourcePrefix =
  nonEmptyString(args.batchSourcePrefix) ?? nonEmptyString(payload.batchSource) ?? inputBaseName;

if (args.clean) {
  await rm(outputRoot, { force: true, recursive: true });
}

await mkdir(outputRoot, { recursive: true });

const groups = [];
let totalBatchCount = 0;

for (let groupOffset = 0; groupOffset < payload.items.length; groupOffset += groupSize) {
  if (maxGroups && groups.length >= maxGroups) break;

  const groupIndex = groups.length + 1;
  const groupId = `group${String(groupIndex).padStart(4, '0')}`;
  const groupItems = payload.items.slice(groupOffset, groupOffset + groupSize);
  const groupDir = path.join(outputRoot, groupId);
  const batchDir = path.join(groupDir, 'batches');
  const groupBatchSource = `${batchSourcePrefix}_${groupId}`;
  const groupFilePath = path.join(groupDir, `${inputBaseName}-${groupId}.json`);
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
    const batchFilePath = path.join(batchDir, `${inputBaseName}-${groupId}-${batchId}.json`);
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
    batchSourcePrefix,
    groupSize,
    batchSize,
    ...groupSummary,
  });

  groups.push(groupSummary);
}

const manifest = {
  inputPath,
  outputRoot,
  sourceBatchSource: payload.batchSource ?? null,
  batchSourcePrefix,
  sourceCount: payload.items.length,
  groupSize,
  batchSize,
  groupCount: groups.length,
  batchCount: totalBatchCount,
  writtenCount: groups.reduce((sum, group) => sum + group.count, 0),
  groups,
};

const manifestPath = path.join(outputRoot, 'manifest.json');
await writeJson(manifestPath, manifest);

console.log(JSON.stringify({ ...manifest, groups: groups.map(summarizeGroup), manifestPath }, null, 2));

function summarizeGroup(group) {
  return {
    index: group.index,
    groupId: group.groupId,
    offset: group.offset,
    count: group.count,
    groupPath: group.groupPath,
    manifestPath: group.manifestPath,
    batchDir: group.batchDir,
    batchCount: group.batchCount,
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
    else if (token === '--batch-source-prefix') parsed.batchSourcePrefix = argv[++index];
    else if (token === '--max-groups') parsed.maxGroups = argv[++index];
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

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/split-product-pool-groups.mjs --file samples/product-pool/generated/collected_all_20260606-full.json
  node scripts/split-product-pool-groups.mjs --file input.json --group-size 1000 --batch-size 50 --out-root output-dir --clean
`);
}
