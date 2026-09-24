#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  printUsage();
  process.exit(1);
}

const inputPath = path.resolve(args.file);
const inputBaseName = path.basename(inputPath, path.extname(inputPath));
const limit = parsePositiveInteger(args.limit);
const concurrency = parsePositiveInteger(args.concurrency) ?? 6;
const timeoutMs = parsePositiveInteger(args.timeoutMs) ?? 10000;
const retries = parseNonNegativeInteger(args.retries) ?? 1;
const skipProduct = args.skipProduct === true;
const skipImage = args.skipImage === true;
const strictImageContentType = args.strictImageContentType !== false;
const outValidPath = path.resolve(args.outValid ?? `samples/product-pool/generated/${inputBaseName}-verified.json`);
const outInvalidPath = path.resolve(args.outInvalid ?? `samples/product-pool/generated/${inputBaseName}-invalid-links.jsonl`);
const outReportPath = path.resolve(args.outReport ?? `samples/product-pool/generated/${inputBaseName}-verify-report.json`);

const payload = JSON.parse(await readFile(inputPath, 'utf8'));
if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
  throw new Error('Input must be a ProductPool import JSON object with items[].');
}

const sourceItems = limit ? payload.items.slice(0, limit) : payload.items;
const checkedAt = new Date().toISOString();
const results = await runPool(sourceItems, concurrency, (item, index) =>
  verifyItem(item, index, {
    retries,
    timeoutMs,
    skipProduct,
    skipImage,
    strictImageContentType,
  }),
);

const validItems = [];
const invalidEntries = [];
const statusCounts = {};
const failureCounts = {};

for (const result of results) {
  for (const check of Object.values(result.checks)) {
    if (!check) continue;
    const statusKey = `${check.kind}:${check.status ?? check.errorCode ?? 'unknown'}`;
    statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;
  }

  if (result.valid) {
    validItems.push(result.item);
  } else {
    for (const reason of result.reasons) failureCounts[reason] = (failureCounts[reason] ?? 0) + 1;
    invalidEntries.push({
      rowIndex: result.rowIndex,
      externalId: result.item?.externalId ?? null,
      platform: result.item?.platform ?? null,
      title: result.item?.title ?? null,
      productUrl: result.item?.productUrl ?? null,
      imageUrl: result.item?.imageUrl ?? null,
      reasons: result.reasons,
      checks: result.checks,
    });
  }
}

const validPayload = {
  batchSource: `${payload.batchSource ?? 'product_pool_import'}_verified`,
  items: validItems,
};
const report = {
  inputPath,
  outValidPath,
  outInvalidPath,
  checkedAt,
  options: {
    itemCount: sourceItems.length,
    concurrency,
    timeoutMs,
    retries,
    skipProduct,
    skipImage,
    strictImageContentType,
  },
  stats: {
    sourceCount: sourceItems.length,
    validCount: validItems.length,
    invalidCount: invalidEntries.length,
    productCheckedCount: skipProduct ? 0 : sourceItems.length,
    imageCheckedCount: skipImage ? 0 : sourceItems.length,
    statusCounts,
    failureCounts,
  },
};

await mkdir(path.dirname(outValidPath), { recursive: true });
await mkdir(path.dirname(outInvalidPath), { recursive: true });
await mkdir(path.dirname(outReportPath), { recursive: true });
await writeFile(outValidPath, `${JSON.stringify(validPayload, null, 2)}\n`, 'utf8');
await writeFile(
  outInvalidPath,
  invalidEntries.length > 0 ? `${invalidEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n` : '',
  'utf8',
);
await writeFile(outReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(report, null, 2));

async function verifyItem(item, rowIndex, options) {
  const checks = {
    product: options.skipProduct
      ? skippedCheck('product')
      : await checkUrl(item?.productUrl, {
          kind: 'product',
          timeoutMs: options.timeoutMs,
          retries: options.retries,
        }),
    image: options.skipImage
      ? skippedCheck('image')
      : await checkUrl(item?.imageUrl, {
          kind: 'image',
          timeoutMs: options.timeoutMs,
          retries: options.retries,
          strictImageContentType: options.strictImageContentType,
        }),
  };

  const reasons = [];
  if (!options.skipProduct && !checks.product.ok) reasons.push('product_url_unreachable');
  if (!options.skipImage && !checks.image.ok) reasons.push('image_url_unreachable');

  return {
    rowIndex,
    item,
    valid: reasons.length === 0,
    reasons,
    checks,
  };
}

async function checkUrl(url, options) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return {
      kind: options.kind,
      ok: false,
      errorCode: 'missing_url',
      errorMessage: 'URL is empty.',
    };
  }

  let lastResult = null;
  const attempts = options.retries + 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastResult = await checkUrlOnce(normalizedUrl, options, attempt);
    if (lastResult.ok) return lastResult;
    if (attempt < attempts) await sleep(250 * attempt);
  }
  return lastResult;
}

async function checkUrlOnce(url, options, attempt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  let response = null;

  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: buildHeaders(options.kind),
    });

    const status = response.status;
    const contentType = response.headers.get('content-type') ?? '';
    const finalUrl = response.url;
    const okStatus = status >= 200 && status < 400;
    const okContentType =
      options.kind !== 'image' ||
      !options.strictImageContentType ||
      contentType.toLowerCase().startsWith('image/');

    return {
      kind: options.kind,
      ok: okStatus && okContentType,
      attempt,
      status,
      contentType,
      finalUrl,
      reason: okStatus ? (okContentType ? null : 'content_type_not_image') : 'bad_status',
    };
  } catch (error) {
    return {
      kind: options.kind,
      ok: false,
      attempt,
      errorCode: error?.name === 'AbortError' ? 'timeout' : 'request_failed',
      errorMessage: error?.message ?? String(error),
    };
  } finally {
    clearTimeout(timeout);
    if (response?.body) {
      try {
        await response.body.cancel();
      } catch {
        // Ignore stream cleanup errors. Link validation result is already known.
      }
    }
  }
}

function buildHeaders(kind) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    Accept:
      kind === 'image'
        ? 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };

  if (kind === 'image') {
    headers.Range = 'bytes=0-2047';
  }

  return headers;
}

async function runPool(items, maxConcurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const workerCount = Math.min(maxConcurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runOne()));
  return results;
}

function skippedCheck(kind) {
  return {
    kind,
    ok: true,
    skipped: true,
  };
}

function normalizeUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInteger(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' || token === '-f') parsed.file = argv[++index];
    else if (token === '--out-valid') parsed.outValid = argv[++index];
    else if (token === '--out-invalid') parsed.outInvalid = argv[++index];
    else if (token === '--out-report') parsed.outReport = argv[++index];
    else if (token === '--limit') parsed.limit = argv[++index];
    else if (token === '--concurrency') parsed.concurrency = argv[++index];
    else if (token === '--timeout-ms') parsed.timeoutMs = argv[++index];
    else if (token === '--retries') parsed.retries = argv[++index];
    else if (token === '--skip-product') parsed.skipProduct = true;
    else if (token === '--skip-image') parsed.skipImage = true;
    else if (token === '--allow-non-image-content-type') parsed.strictImageContentType = false;
    else if (!parsed.file) parsed.file = token;
  }
  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/verify-product-links.mjs --file normalized-product-pool.json
  node scripts/verify-product-links.mjs --file normalized.json --limit 30 --concurrency 4 --timeout-ms 10000

Input:
  ProductPool import JSON: { "batchSource": "...", "items": [...] }

Output:
  - verified ProductPool import JSON
  - invalid rows JSONL
  - verification report JSON

Options:
  --file, -f                     Normalized ProductPool JSON.
  --out-valid                    Output JSON containing only valid items.
  --out-invalid                  Invalid rows JSONL.
  --out-report                   Verification report JSON.
  --limit                        Verify only the first N items.
  --concurrency                  Concurrent network checks. Default: 6.
  --timeout-ms                   Per-request timeout. Default: 10000.
  --retries                      Retry count after first attempt. Default: 1.
  --skip-product                 Do not check productUrl.
  --skip-image                   Do not check imageUrl.
  --allow-non-image-content-type Accept image URLs even if content-type is not image/*.
`);
}
