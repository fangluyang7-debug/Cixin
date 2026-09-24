#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const baseUrl = trimTrailingSlash(args.baseUrl ?? process.env.API_BASE_URL ?? 'https://apiserver.zeabur.app');
const outPath = path.resolve(args.out ?? 'samples/product-pool/generated/cloud-product-keys.jsonl');
const limit = Math.min(parsePositiveInteger(args.limit) ?? 200, 200);
const platforms = parseCsv(args.platforms);

loadDotEnv(path.resolve(args.envFile ?? '.env'));

const rows = [];
const summary = {
  baseUrl,
  exportedAt: new Date().toISOString(),
  totalSeen: 0,
  writtenCount: 0,
  platformCounts: {},
};

if (platforms.length > 0) {
  for (const platform of platforms) {
    await exportPlatform(platform);
  }
} else {
  await exportPlatform(null);
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(
  outPath,
  rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''),
  'utf8',
);

console.log(
  JSON.stringify(
    {
      ...summary,
      outPath,
    },
    null,
    2,
  ),
);

async function exportPlatform(platform) {
  let offset = 0;
  let total = null;
  while (total === null || offset < total) {
    const url = new URL(`${baseUrl}/api/v1/product-pool/products`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    if (platform) url.searchParams.set('platform', platform);

    const response = await getJson(url.toString());
    const data = response.data ?? response;
    const items = Array.isArray(data.items) ? data.items : [];
    total = Number.isFinite(Number(data.total)) ? Number(data.total) : offset + items.length;
    summary.totalSeen += items.length;

    for (const item of items) {
      const itemPlatform = nonEmptyString(item.platform)?.toLowerCase();
      const externalId = nonEmptyString(item.externalId);
      if (!itemPlatform || !externalId) continue;
      rows.push({
        key: `${itemPlatform}:${externalId}`,
        platform: itemPlatform,
        externalId,
        productId: item.productId ?? null,
        importBatchId: item.importBatchId ?? null,
        embeddingReady: Boolean(item.embeddingReady),
        embeddingCount: Number(item.counts?.embeddings ?? 0),
        title: item.title ?? null,
      });
      summary.writtenCount += 1;
      summary.platformCounts[itemPlatform] = (summary.platformCounts[itemPlatform] ?? 0) + 1;
    }

    if (items.length === 0) break;
    offset += items.length;
  }
}

async function getJson(url) {
  const headers = {};
  const maintenanceToken = args.maintenanceToken ?? process.env.MAINTENANCE_API_TOKEN;
  if (maintenanceToken) headers['x-maintenance-token'] = maintenanceToken;
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function loadDotEnv(envPath) {
  try {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex <= 0) continue;
      const key = trimmed.slice(0, equalsIndex).trim();
      let value = trimmed.slice(equalsIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Could not load env file ${envPath}: ${error.message}`);
    }
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--base-url') parsed.baseUrl = argv[++index];
    else if (token === '--out') parsed.out = argv[++index];
    else if (token === '--env-file') parsed.envFile = argv[++index];
    else if (token === '--maintenance-token') parsed.maintenanceToken = argv[++index];
    else if (token === '--limit') parsed.limit = argv[++index];
    else if (token === '--platforms') parsed.platforms = argv[++index];
  }
  return parsed;
}

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
