#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  printUsage();
  process.exit(1);
}

loadDotEnv(path.resolve(args.envFile ?? '.env'));

const inputPath = path.resolve(args.file);
const baseUrl = trimTrailingSlash(args.baseUrl ?? process.env.API_BASE_URL ?? 'http://localhost:3000');
const rawPayload = JSON.parse(await readFile(inputPath, 'utf8'));
const normalizedPayload = normalizePayload(rawPayload);

if (args.standardizeImages) {
  await standardizePayloadImages(normalizedPayload);
}

if (args.out) {
  const outPath = path.resolve(args.out);
  await writeFile(outPath, `${JSON.stringify(normalizedPayload, null, 2)}\n`, 'utf8');
  console.log(`Wrote normalized import payload: ${outPath}`);
}

console.log(
  JSON.stringify(
    {
      file: inputPath,
      baseUrl,
      batchSource: normalizedPayload.batchSource,
      itemCount: normalizedPayload.items.length,
      imageStandardization: args.standardizeImages
        ? {
            targetSize: numberArg(args.imageTargetSize, 320),
            jpegQuality: numberArg(args.imageJpegQuality, 88),
          }
        : null,
      mode: args.dryRun ? 'dry-run' : 'post',
    },
    null,
    2,
  ),
);

if (args.dryRun) {
  process.exit(0);
}

const importResponse = await postJson(`${baseUrl}/api/v1/product-pool/import`, normalizedPayload);
console.log(JSON.stringify(importResponse, null, 2));

if (args.wait) {
  const batchId = importResponse?.data?.batchId;
  if (!batchId) {
    throw new Error('Import response did not include data.batchId.');
  }
  try {
    const batch = await waitForImportBatch(batchId);
    assertBatchExpectations(batch);
    console.log(JSON.stringify({ productImportBatch: batch }, null, 2));
  } catch (error) {
    if (args.continueOnWaitTimeout && isWaitTimeoutError(error)) {
      console.warn(
        JSON.stringify({
          status: 'wait_timeout_continue',
          batchId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } else if (args.warnOnExpectationFailure && isBatchExpectationError(error)) {
      console.warn(
        JSON.stringify({
          status: 'batch_expectation_warning',
          batchId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } else {
      throw error;
    }
  }
}

try {
  const statsResponse = await getJson(`${baseUrl}/api/v1/product-pool/stats`);
  console.log(JSON.stringify({ productPoolStats: statsResponse.data ?? statsResponse }, null, 2));
} catch (error) {
  console.warn(`Import succeeded, but stats check failed: ${error.message}`);
}

function normalizePayload(payload) {
  if (!isRecord(payload)) {
    throw new Error('Import JSON must be an object.');
  }

  if (Array.isArray(payload.items)) {
    return {
      batchSource: nonEmptyString(payload.batchSource) ?? 'product_pool_import',
      items: payload.items,
    };
  }

  if (Array.isArray(payload.products)) {
    return {
      batchSource:
        nonEmptyString(payload.batchSource) ??
        nonEmptyString(payload.schemaVersion) ??
        'product_pool_v2_import',
      items: payload.products.map((product, index) => normalizeProductPoolV2Product(product, index, payload)),
    };
  }

  throw new Error('Import JSON must contain either items[] or products[].');
}

function normalizeProductPoolV2Product(product, index, payload) {
  const source = asRecord(product.source);
  const listing = asRecord(product.listing);
  const shop = asRecord(product.shop);
  const media = asRecord(product.media);
  const attributes = asRecord(product.attributes);
  const imageRef = nonEmptyString(media.mainImageUrl) ?? nonEmptyString(listing.mainImageUrl);
  const dataImage = imageRef ? parseDataUrl(imageRef) : null;
  const externalId =
    nonEmptyString(source.externalId) ??
    nonEmptyString(source.productId) ??
    `product-${index + 1}`;

  const productUrl =
    nonEmptyString(source.productUrl) ??
    nonEmptyString(source.searchUrl);
  if (!productUrl) {
    throw new Error(`Product ${externalId} is missing an authorized product URL.`);
  }

  const item = {
    externalId,
    platform: normalizePlatform(source.platform),
    title: nonEmptyString(listing.title) ?? nonEmptyString(attributes.modelLine) ?? externalId,
    price: nonEmptyString(listing.mainPrice) ?? '0',
    currency: 'CNY',
    stockStatus: normalizeStockStatus(nonEmptyString(listing.stockStatus)),
    shopName: nonEmptyString(shop.name),
    shopType: nonEmptyString(shop.type),
    productUrl,
    brandHint: nonEmptyString(attributes.brand),
    rawPayload: {
      schemaVersion: payload.schemaVersion ?? null,
      capturedAt: payload.capturedAt ?? null,
      source,
      listing,
      shop,
      fulfillment: asRecord(product.fulfillment),
      media,
      skuOptions: asRecord(product.skuOptions),
      skuMatrix: asRecord(product.skuMatrix),
      attributes,
      raw: asRecord(product.raw),
    },
  };

  if (dataImage) {
    item.imageDataBase64 = dataImage.base64;
    item.imageContentType = dataImage.contentType;
  } else if (imageRef) {
    item.imageUrl = imageRef;
  }

  return item;
}

async function standardizePayloadImages(payload) {
  const targetSize = numberArg(args.imageTargetSize, 320);
  const jpegQuality = numberArg(args.imageJpegQuality, 88);
  const concurrency = numberArg(args.imageStandardizeConcurrency, 4);
  let standardizedCount = 0;
  let skippedCount = 0;

  await mapLimit(payload.items, concurrency, async (item, index) => {
    const imageContent = await readItemImageContent(item);
    if (!imageContent) {
      skippedCount += 1;
      throw new Error(`Image standardization failed: item ${index} has no readable image.`);
    }

    const buffer = await standardizeImageBuffer(imageContent.buffer, targetSize, jpegQuality);
    item.imageDataBase64 = buffer.toString('base64');
    item.imageContentType = 'image/jpeg';
    standardizedCount += 1;
  });

  console.log(
    JSON.stringify({
      imageStandardization: {
        targetSize,
        jpegQuality,
        concurrency,
        standardizedCount,
        skippedCount,
      },
    }),
  );
}

async function readItemImageContent(item) {
  if (item.imageDataBase64) {
    return { buffer: Buffer.from(item.imageDataBase64, 'base64') };
  }
  if (item.imageUrl) {
    return { buffer: await fetchImageBuffer(item.imageUrl) };
  }
  return null;
}

async function fetchImageBuffer(url) {
  const timeoutMs = numberArg(args.imageFetchTimeoutMs, 30000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(
      `Image fetch failed: ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function standardizeImageBuffer(buffer, targetSize, jpegQuality) {
  const background = { r: 245, g: 245, b: 245, alpha: 1 };
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: targetSize,
      height: targetSize,
      fit: 'contain',
      background,
    })
    .flatten({ background })
    .jpeg({ quality: jpegQuality })
    .toBuffer();
}

async function mapLimit(items, limit, mapper) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function postJson(url, body) {
  const headers = { 'Content-Type': 'application/json' };
  const maintenanceToken = args.maintenanceToken ?? process.env.MAINTENANCE_API_TOKEN;
  if (maintenanceToken) headers['x-maintenance-token'] = maintenanceToken;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return readJsonResponse(response);
}

async function getJson(url) {
  const headers = {};
  const maintenanceToken = args.maintenanceToken ?? process.env.MAINTENANCE_API_TOKEN;
  if (maintenanceToken) headers['x-maintenance-token'] = maintenanceToken;
  const response = await fetch(url, { headers });
  return readJsonResponse(response);
}

async function waitForImportBatch(batchId) {
  const maxAttempts = numberArg(args.waitAttempts, 180);
  const intervalMs = numberArg(args.waitIntervalMs, 5000);
  const maxTransientPollErrors = numberArg(args.waitTransientErrors, 30);
  const terminalStatuses = new Set(['completed', 'completed_with_errors', 'failed']);
  let transientPollErrors = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await getJson(`${baseUrl}/api/v1/product-pool/batches/${encodeURIComponent(batchId)}`);
    } catch (error) {
      if (isTransientPollError(error) && transientPollErrors < maxTransientPollErrors) {
        transientPollErrors += 1;
        console.warn(
          JSON.stringify({
            attempt,
            batchId,
            status: 'poll_retry',
            transientPollErrors,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }
      if (isTransientPollError(error)) {
        const waitError = new Error(
          `Stopped polling import batch ${batchId} after ${transientPollErrors} transient poll error(s): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        waitError.code = 'IMPORT_BATCH_WAIT_TIMEOUT';
        waitError.cause = error;
        throw waitError;
      }
      throw error;
    }

    const batch = response.data ?? response;
    console.log(
      JSON.stringify({
        attempt,
        batchId,
        status: batch.status,
        succeededCount: batch.succeededCount,
        failedCount: batch.failedCount,
        productCount: batch.productCount,
        productsWithEmbeddingCount: batch.productsWithEmbeddingCount,
        embeddingCount: batch.embeddingCount,
      }),
    );
    if (terminalStatuses.has(batch.status)) return batch;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const error = new Error(`Timed out waiting for import batch ${batchId}.`);
  error.code = 'IMPORT_BATCH_WAIT_TIMEOUT';
  throw error;
}

async function readJsonResponse(response) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      const error = new Error(`HTTP ${response.status}: non-JSON response: ${truncateText(text, 200)}`);
      error.status = response.status;
      error.responseText = text;
      error.cause = parseError;
      throw error;
    }
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${text}`);
    error.status = response.status;
    error.responseText = text;
    throw error;
  }
  if (data?.success === false) {
    throw new Error(JSON.stringify(data.error ?? data));
  }
  return data;
}

function isTransientPollError(error) {
  const status = error?.status;
  if (status === 502 || status === 503 || status === 504 || status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Bad Gateway|Service Unavailable|Gateway Timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
}

function isWaitTimeoutError(error) {
  return error?.code === 'IMPORT_BATCH_WAIT_TIMEOUT';
}

function isBatchExpectationError(error) {
  return error?.code === 'IMPORT_BATCH_EXPECTATION_FAILED';
}

function truncateText(value, maxLength) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' || token === '-f') parsed.file = argv[++index];
    else if (token === '--base-url') parsed.baseUrl = argv[++index];
    else if (token === '--out') parsed.out = argv[++index];
    else if (token === '--env-file') parsed.envFile = argv[++index];
    else if (token === '--maintenance-token') parsed.maintenanceToken = argv[++index];
    else if (token === '--wait') parsed.wait = true;
    else if (token === '--wait-attempts') parsed.waitAttempts = argv[++index];
    else if (token === '--wait-interval-ms') parsed.waitIntervalMs = argv[++index];
    else if (token === '--wait-transient-errors') parsed.waitTransientErrors = argv[++index];
    else if (token === '--expect-embeddings-per-product') parsed.expectEmbeddingsPerProduct = argv[++index];
    else if (token === '--continue-on-wait-timeout') parsed.continueOnWaitTimeout = true;
    else if (token === '--warn-on-expectation-failure') parsed.warnOnExpectationFailure = true;
    else if (token === '--standardize-images') parsed.standardizeImages = true;
    else if (token === '--no-standardize-images') parsed.standardizeImages = false;
    else if (token === '--image-target-size') parsed.imageTargetSize = argv[++index];
    else if (token === '--image-jpeg-quality') parsed.imageJpegQuality = argv[++index];
    else if (token === '--image-standardize-concurrency') parsed.imageStandardizeConcurrency = argv[++index];
    else if (token === '--image-fetch-timeout-ms') parsed.imageFetchTimeoutMs = argv[++index];
    else if (token === '--fail-on-import-errors') parsed.failOnImportErrors = true;
    else if (token === '--dry-run') parsed.dryRun = true;
    else if (!parsed.file) parsed.file = token;
  }
  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/import-product-pool.mjs --file samples/product-pool/generated/taobao_real_shoes_20260604-first80-verified.json
  node scripts/import-product-pool.mjs --file input.json --base-url http://localhost:3000 --out normalized.json
  node scripts/import-product-pool.mjs --file input.json --base-url <configured-api-url> --env-file .env
  node scripts/import-product-pool.mjs --file input.json --base-url <configured-api-url> --env-file .env --wait
  node scripts/import-product-pool.mjs --file input.json --base-url <configured-api-url> --env-file .env --wait --fail-on-import-errors --expect-embeddings-per-product 2
  node scripts/import-product-pool.mjs --file input.json --base-url <configured-api-url> --env-file .env --wait --continue-on-wait-timeout --warn-on-expectation-failure
  node scripts/import-product-pool.mjs --file input.json --base-url <configured-api-url> --env-file .env --standardize-images --image-target-size 320
`);
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

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizePlatform(value) {
  const platform = nonEmptyString(value)?.toLowerCase();
  const supported = new Set([
    'taobao',
    'tmall',
    'jd',
    'dewu',
    'pdd',
    'douyin',
    'suning',
    'vipshop',
    'xianyu',
    'manual',
  ]);
  return platform && supported.has(platform) ? platform : 'manual';
}

function normalizeStockStatus(value) {
  if (value === 'in_stock' || value === 'out_of_stock') return value;
  return 'unknown';
}

function parseDataUrl(value) {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1] ?? 'image/jpeg',
    base64: match[2] ?? '',
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value) {
  return isRecord(value) ? value : {};
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function assertBatchExpectations(batch) {
  const failedCount = numberField(batch.failedCount);
  if (args.failOnImportErrors && failedCount > 0) {
    throw new Error(`Import batch ${batch.batchId ?? batch.id ?? ''} finished with ${failedCount} failed item(s).`);
  }

  const expectedEmbeddingsPerProduct = numberArg(args.expectEmbeddingsPerProduct, 0);
  if (expectedEmbeddingsPerProduct <= 0) return;

  const productCount = numberField(batch.productCount);
  const embeddingCount = numberField(batch.embeddingCount);
  const expectedEmbeddingCount = productCount * expectedEmbeddingsPerProduct;
  if (embeddingCount < expectedEmbeddingCount) {
    const error = new Error(
      `Import batch ${batch.batchId ?? batch.id ?? ''} produced ${embeddingCount} embedding(s) for ${productCount} product(s); expected at least ${expectedEmbeddingCount}.`,
    );
    error.code = 'IMPORT_BATCH_EXPECTATION_FAILED';
    throw error;
  }

  console.log(
    JSON.stringify({
      embeddingExpectation: {
        productCount,
        expectedEmbeddingsPerProduct,
        expectedEmbeddingCount,
        actualEmbeddingCount: embeddingCount,
        ok: true,
      },
    }),
  );
}

function numberField(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
