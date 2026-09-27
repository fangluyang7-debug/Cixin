import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = path.join(root, 'artifacts/cloud-upload');
const rawDir = path.join(root, 'apps/harmony/entry/src/main/resources/rawfile');
const hash = value => createHash('sha256').update(value).digest('hex');

export async function loadSeedCatalog() {
  const source = await readFile(path.join(root, 'apps/harmony/entry/src/main/ets/services/DataInitService.ets'), 'utf8');
  const ast = ts.createSourceFile('DataInitService.ts', source, ts.ScriptTarget.Latest, true);
  let names;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'RAW_PRODUCT_FILES' &&
        node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      names = node.initializer.elements.map(element => {
        if (!ts.isStringLiteral(element)) throw new Error('Seed manifest must use string literals');
        return element.text;
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!names?.length) throw new Error('RAW_PRODUCT_FILES not found');
  const items = [];
  const files = [];
  for (const name of names) {
    if (path.basename(name) !== name) throw new Error('Invalid seed filename');
    const content = await readFile(path.join(rawDir, name), 'utf8');
    const payload = JSON.parse(content);
    if (!Array.isArray(payload.items)) throw new Error(`Missing items: ${name}`);
    files.push({ name, count: payload.items.length, sha256: hash(content) });
    for (const item of payload.items) {
      if (!item.title || !item.productUrl || !item.platform || !item.externalId ||
          !Number.isFinite(Number(item.price)) || !(item.imageUrl || item.imageDataBase64 || item.localImagePath)) {
        throw new Error(`Invalid product in ${name}`);
      }
      items.push(item);
    }
  }
  if (items.length !== 2700) throw new Error(`Expected 2700 source records, found ${items.length}`);
  // Reuse the server's identity rules so duplicate source rows do not pay for repeated inference.
  const referenceSource = await readFile(path.join(root,
    'services/api-server/src/modules/product-pool/application/platform-product-reference.ts'), 'utf8');
  const compiled = ts.transpileModule(referenceSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { parsePlatformProductReference } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  const unique = new Map();
  const duplicates = [];
  items.forEach((item, index) => {
    const externalId = parsePlatformProductReference(item.platform, item.productUrl).productId ?? item.externalId;
    const key = `${item.platform}:${externalId}`;
    if (unique.has(key)) duplicates.push({ key, replacedIndex: unique.get(key).index, retainedIndex: index });
    unique.set(key, { item: { ...item, externalId }, index });
  });
  return { files, sourceCount: items.length, duplicates,
    items: [...unique.values()].map(value => value.item),
    digest: hash(JSON.stringify(files) + referenceSource + 'upload-v1-batch25-image480-quality88') };
}

export function assertImportReadiness(readiness) {
  const missing = ['database', 'cos', 'vision', 'embedding'].filter(key => !readiness?.checks?.[key]?.available);
  if (readiness?.modelMode !== 'required') missing.push('CLOUD_MODEL_MODE=required');
  // An empty catalog is expected before the first import.
  if (missing.length) throw new Error(`Cloud import dependencies unavailable: ${missing.join(', ')}`);
}

export function assertBatch(batch, count) {
  if (batch.status !== 'completed' || batch.failedCount !== 0 || batch.succeededCount !== count ||
      batch.productCount !== count || batch.searchableProductCount !== count ||
      batch.productsWithEmbeddingCount !== count || batch.embeddingCount < count * 2) {
    throw new Error('Batch incomplete: inspect cloud batch quality before retrying; no automatic re-import');
  }
}

async function loadEnv() {
  const content = await readFile(path.join(root, '.env'), 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

async function saveJson(filename, value) {
  await writeFile(filename + '.tmp', JSON.stringify(value, null, 2) + '\n');
  await rename(filename + '.tmp', filename);
}

export async function imageItem(item) {
  let buffer;
  if (item.imageDataBase64) buffer = Buffer.from(item.imageDataBase64, 'base64');
  else if (item.localImagePath) buffer = await readFile(path.resolve(rawDir, item.localImagePath));
  else if (item.imageUrl?.startsWith('data:')) {
    const match = item.imageUrl.match(/^data:image\/[^;]+;base64,(.+)$/s);
    if (!match) throw new Error('Invalid data image');
    buffer = Buffer.from(match[1], 'base64');
  } else {
    const response = await fetch(item.imageUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Product image download HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  const jpeg = await sharp(buffer).rotate().resize(480, 480, { fit: 'contain', background: '#f5f5f5' })
    .flatten({ background: '#f5f5f5' }).jpeg({ quality: 88 }).toBuffer();
  const { localImagePath: _local, ...rest } = item;
  return { ...rest, imageDataBase64: jpeg.toString('base64'), imageContentType: 'image/jpeg' };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const output = dependencies.outputDirectory ?? defaultOutput;
  const { values } = parseArgs({ args: argv, options: {
    prepare: { type: 'boolean', default: false },
    'check-only': { type: 'boolean', default: false },
  } });
  await loadEnv();
  const catalog = await (dependencies.loadCatalog ?? loadSeedCatalog)();
  await mkdir(output, { recursive: true });
  const chunks = [];
  for (let i = 0; i < catalog.items.length; i += 25) {
    chunks.push({ batchSource: `harmony2700-${catalog.digest.slice(0, 12)}-${String(chunks.length + 1).padStart(4, '0')}`,
      items: catalog.items.slice(i, i + 25) });
  }
  await saveJson(path.join(output, 'manifest.json'), {
    source: 'HarmonyOS RAW_PRODUCT_FILES', sourceCount: catalog.sourceCount,
    total: catalog.items.length, duplicates: catalog.duplicates, digest: catalog.digest,
    files: catalog.files, batches: chunks.map(c => ({ batchSource: c.batchSource, count: c.items.length })),
  });
  for (const chunk of chunks) await saveJson(path.join(output, chunk.batchSource + '.json'), chunk);
  console.log(`Prepared ${catalog.sourceCount} source rows -> ${catalog.items.length} unique products from ${catalog.files.length} files in ${chunks.length} batches.`);
  if (values.prepare) return;

  const base = new URL(process.env.API_BASE_URL || 'https://cixin.zeabur.app');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('API_BASE_URL must be an HTTPS origin');
  }
  const token = process.env.MAINTENANCE_API_TOKEN?.trim();
  if (!token || /^(replace|your)[-_ ]/i.test(token)) throw new Error('Fill MAINTENANCE_API_TOKEN in .env with the current Zeabur service token');
  async function request(route, body, allowNotReady = false) {
    const response = await fetch(base.origin + route, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', 'x-maintenance-token': token },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error(`Cloud API returned non-JSON HTTP ${response.status}`); }
    if (allowNotReady && response.status === 503) return payload.error?.details;
    if (!response.ok || payload.success === false) throw new Error(`Cloud API HTTP ${response.status}; route ${route.split('?')[0]}`);
    return payload.data;
  }
  await request('/api/v1/product-pool/batches?limit=1');
  let readiness;
  let lastReadiness;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastReadiness = await request('/api/v1/health/readiness', undefined, true);
    try {
      assertImportReadiness(lastReadiness);
      readiness = lastReadiness;
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.warn(`Cloud readiness attempt ${attempt}/3 was not ready; retrying in 5 seconds.`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  console.log(`Cloud authentication, database, COS and import models ready: ${base.origin}`);
  if (values['check-only']) return;

  const lockPath = path.join(output, 'upload.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Upload lock exists; verify no uploader is running before removing artifacts/cloud-upload/upload.lock'); });
  const journalPath = path.join(output, 'progress.json');
  try {
    let journal = { origin: base.origin, digest: catalog.digest, batches: {} };
    try { journal = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (journal.origin !== base.origin || journal.digest !== catalog.digest) throw new Error('Upload journal belongs to another server or catalog');
    for (const chunk of chunks) {
      let record = journal.batches[chunk.batchSource];
      if (record?.complete) continue;
      if (record && !record.batchId) throw new Error(`Uncertain prior submission: inspect batchSource ${chunk.batchSource} on server before resubmitting`);
      if (!record) {
        const items = [];
        for (const item of chunk.items) items.push(await imageItem(item));
        const payload = { batchSource: chunk.batchSource, items };
        if (Buffer.byteLength(JSON.stringify(payload)) > 9 * 1024 * 1024) throw new Error('Batch exceeds 9 MiB request budget');
        record = journal.batches[chunk.batchSource] = { submitting: true };
        await saveJson(journalPath, journal);
        const result = await request('/api/v1/product-pool/import', payload);
        if (!result?.batchId) throw new Error('Missing batchId; inspect server before resubmitting');
        record.batchId = result.batchId;
        await saveJson(journalPath, journal);
      }
      let completed = false;
      for (let poll = 0; poll < 360; poll++) {
        const batch = await request(`/api/v1/product-pool/batches/${encodeURIComponent(record.batchId)}`);
        if (['completed', 'completed_with_errors', 'failed'].includes(batch.status)) {
          record.summary = { status: batch.status, succeededCount: batch.succeededCount, failedCount: batch.failedCount,
            productCount: batch.productCount, searchableProductCount: batch.searchableProductCount,
            productsWithEmbeddingCount: batch.productsWithEmbeddingCount, embeddingCount: batch.embeddingCount };
          await saveJson(journalPath, journal);
          assertBatch(batch, chunk.items.length);
          record.complete = true;
          await saveJson(journalPath, journal);
          console.log(`${chunk.batchSource}: ${chunk.items.length} products verified with embeddings`);
          completed = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      if (!completed) throw new Error(`Batch ${record.batchId} still pending; rerun to resume polling without re-import`);
    }
    console.log(`All ${catalog.sourceCount} source rows (${catalog.items.length} unique products) processed. Checking cloud catalog readiness.`);
    const readiness = await request('/api/v1/health/readiness', undefined, true);
    await saveJson(path.join(output, 'cloud-result.json'), { checkedAt: new Date().toISOString(),
      readiness, stats: await request('/api/v1/product-pool/stats') });
    if (!readiness?.available) throw new Error('Import batches completed, but full shopping readiness still fails; see cloud-result.json');
    console.log('Cloud shopping dependencies ready.');
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
