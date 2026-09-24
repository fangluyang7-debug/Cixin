#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  printUsage();
  process.exit(1);
}

const inputPath = path.resolve(args.file);
const chunkSize = parsePositiveInteger(args.chunkSize) ?? 100;
const maxChunks = parsePositiveInteger(args.maxChunks);
const payload = JSON.parse(await readFile(inputPath, 'utf8'));

if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
  throw new Error('Input must be a ProductPool payload: { batchSource, items: [] }.');
}

const inputBaseName = path.basename(inputPath, path.extname(inputPath));
const outputDir = path.resolve(args.outDir ?? path.join(path.dirname(inputPath), `${inputBaseName}-chunks`));
const batchSource = nonEmptyString(args.batchSourcePrefix) ?? nonEmptyString(payload.batchSource) ?? inputBaseName;
const chunks = [];

for (let offset = 0; offset < payload.items.length; offset += chunkSize) {
  if (maxChunks && chunks.length >= maxChunks) break;
  const index = chunks.length + 1;
  const items = payload.items.slice(offset, offset + chunkSize);
  const fileName = `${inputBaseName}-chunk${String(index).padStart(4, '0')}.json`;
  chunks.push({
    index,
    offset,
    count: items.length,
    path: path.join(outputDir, fileName),
    payload: {
      batchSource: `${batchSource}_chunk${String(index).padStart(4, '0')}`,
      items,
    },
  });
}

await mkdir(outputDir, { recursive: true });
for (const chunk of chunks) {
  await writeFile(chunk.path, `${JSON.stringify(chunk.payload, null, 2)}\n`, 'utf8');
}

console.log(
  JSON.stringify(
    {
      inputPath,
      outputDir,
      sourceBatchSource: payload.batchSource ?? null,
      batchSourcePrefix: batchSource,
      sourceCount: payload.items.length,
      chunkSize,
      chunkCount: chunks.length,
      writtenCount: chunks.reduce((sum, chunk) => sum + chunk.count, 0),
      chunks: chunks.map((chunk) => ({
        index: chunk.index,
        offset: chunk.offset,
        count: chunk.count,
        path: chunk.path,
        batchSource: chunk.payload.batchSource,
      })),
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' || token === '-f') parsed.file = argv[++index];
    else if (token === '--chunk-size') parsed.chunkSize = argv[++index];
    else if (token === '--out-dir') parsed.outDir = argv[++index];
    else if (token === '--batch-source-prefix') parsed.batchSourcePrefix = argv[++index];
    else if (token === '--max-chunks') parsed.maxChunks = argv[++index];
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
  node scripts/split-product-pool-payload.mjs --file samples/product-pool/generated/input-full.json --chunk-size 100
  node scripts/split-product-pool-payload.mjs --file input.json --chunk-size 100 --out-dir samples/product-pool/generated/input-chunks
`);
}
