import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

type JsonRecord = Record<string, unknown>;

const baseUrl = (cliValue('--base-url') ?? 'https://apiserver.zeabur.app').replace(/\/$/, '');
const imagePath = resolve(
  process.cwd(),
  cliValue('--image') ?? '../../user_image_sample.jpg',
);
const outputPath = resolve(
  process.cwd(),
  cliValue('--output') ?? '../../artifacts/qa/cloud-image-semantic-workflow.json',
);
const modes = ['current_ann_then_refine', 'light_tag_ann_fusion'] as const;
const deviceId = randomUUID();
const credentials = {
  email: `mobile-${deviceId}@shopping-assistant.local`,
  password: randomBytes(32).toString('hex'),
};
let accessToken = '';

function cliValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

async function jsonRequest(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });
  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) as JsonRecord : {};
  if (!response.ok || parsed.success !== true) {
    throw new Error(`${method} ${path} failed: HTTP ${response.status} ${raw.slice(0, 500)}`);
  }
  return record(parsed.data);
}

async function authenticate() {
  const data = await jsonRequest('POST', '/api/v1/auth/register', {
    ...credentials,
    displayName: `Image Audit ${deviceId.slice(0, 8)}`,
  });
  accessToken = String(data.accessToken ?? '');
  if (!accessToken) throw new Error('registration did not return accessToken');
}

async function uploadImage() {
  const extension = extname(imagePath).toLowerCase();
  const form = new FormData();
  form.set('variantType', 'compressed_recognition');
  form.set('sourceType', 'camera');
  form.set('isPrimaryRecognitionAsset', 'true');
  form.set(
    'file',
    new Blob([readFileSync(imagePath)], {
      type: extension === '.png' ? 'image/png' : 'image/jpeg',
    }),
    basename(imagePath),
  );
  const response = await fetch(`${baseUrl}/api/v1/assets/images`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await response.text();
  const parsed = raw ? JSON.parse(raw) as JsonRecord : {};
  if (!response.ok || parsed.success !== true) {
    throw new Error(`image upload failed: HTTP ${response.status} ${raw.slice(0, 500)}`);
  }
  const assetId = String(record(parsed.data).assetId ?? '');
  if (!assetId) throw new Error('image upload did not return assetId');
  return assetId;
}

function effectiveFilter(data: JsonRecord) {
  return record(data.effectiveFilter);
}

function assertMode(data: JsonRecord, mode: string) {
  const actual = effectiveFilter(data).searchPipelineMode ??
    record(data.imageSearch).searchPipelineMode ??
    record(data.profileUpdate).searchPipelineMode;
  if (actual !== mode) throw new Error(`mode drift: expected ${mode}, actual ${String(actual)}`);
}

function candidateItems(data: JsonRecord) {
  const direct = record(data.candidates).items;
  const value = Array.isArray(direct) ? direct : data.items;
  return Array.isArray(value) ? value.map(record) : [];
}

function assertImageScoreThreshold(items: JsonRecord[]) {
  for (const item of items) {
    const score = Number(record(item.matchSummary).finalScore);
    if (Number.isFinite(score) && score > 0 && score < 0.55) {
      throw new Error(`candidate final score below 0.55: ${score}`);
    }
  }
}

function assertBrandScope(items: JsonRecord[], expectedBrand: string) {
  for (const item of items) {
    const brand = String(record(item.normalizedAttributes).brand ?? '').toLowerCase();
    const title = String(item.title ?? '').toLowerCase();
    if (brand && !brand.includes(expectedBrand.toLowerCase()) && !brand.includes('阿迪')) {
      throw new Error(`candidate brand escaped ${expectedBrand} scope: ${brand}`);
    }
    if (/(?:nike|耐克)/iu.test(title) && !/(?:adidas|阿迪)/iu.test(title)) {
      throw new Error(`candidate title conflicts with ${expectedBrand} scope: ${title}`);
    }
  }
}

async function runMode(assetId: string, mode: typeof modes[number]) {
  const created = await jsonRequest('POST', '/api/v1/sessions', {
    assetId,
    entrySource: 'android_app',
    categoryHint: 'shoe',
    filters: { searchPipelineMode: mode },
  });
  assertMode(created, mode);
  const sessionId = String(record(created.session).sessionId ?? '');
  if (!sessionId) throw new Error(`${mode}: sessionId missing`);

  const initialCandidates = await jsonRequest('GET', `/api/v1/sessions/${sessionId}/candidates`);
  const initialItems = candidateItems(initialCandidates);
  assertImageScoreThreshold(initialItems);

  const patched = await jsonRequest('PATCH', `/api/v1/sessions/${sessionId}/profile`, {
    brand: 'Nike',
    color: 'black',
    filters: { searchPipelineMode: mode, brandsInclude: ['Nike'] },
  });
  assertMode(patched, mode);
  if (record(patched.productProfile).brand !== 'Nike') {
    throw new Error(`${mode}: PATCH profile brand was not persisted`);
  }

  const cleared = await jsonRequest('POST', `/api/v1/sessions/${sessionId}/turns`, {
    message: '品牌不限',
    filters: { searchPipelineMode: mode },
  });
  assertMode(cleared, mode);
  const clearedSession = await jsonRequest('GET', `/api/v1/sessions/${sessionId}`);
  if (
    strings(effectiveFilter(cleared).brandsInclude).length > 0 ||
    record(clearedSession.productProfile).brand
  ) {
    throw new Error(`${mode}: natural-language brand cancellation did not clear filter and profile`);
  }

  const selected = await jsonRequest('POST', `/api/v1/sessions/${sessionId}/turns`, {
    message: '只看阿迪',
    filters: { searchPipelineMode: mode },
  });
  assertMode(selected, mode);
  if (!strings(effectiveFilter(selected).brandsInclude).includes('Adidas')) {
    throw new Error(`${mode}: explicit natural-language brand filter was not applied`);
  }

  const selectedItems = candidateItems(selected);
  assertImageScoreThreshold(selectedItems);
  assertBrandScope(selectedItems, 'Adidas');
  if (initialItems.length + selectedItems.length === 0) {
    throw new Error(`${mode}: image workflow returned no candidates at any stage`);
  }
  const detailedProfileStatus = String(record(created.imageSearch).detailedProfileStatus ?? 'unknown');
  if (detailedProfileStatus === 'failed' && initialItems.length === 0) {
    throw new Error(`${mode}: tag failure did not fall back to visual candidates`);
  }
  return {
    mode,
    sessionId,
    initialCandidateCount: initialItems.length,
    selectedCandidateCount: selectedItems.length,
    selectedBrands: [
      ...new Set(
        selectedItems
          .map((item) => String(record(item.normalizedAttributes).brand ?? ''))
          .filter(Boolean),
      ),
    ],
    detailedProfileStatus,
    tagFailureFallbackObserved: detailedProfileStatus === 'failed',
    profilePatchAndNaturalLanguageConsistent: true,
  };
}

async function main() {
  await jsonRequest('GET', '/api/v1/health');
  await authenticate();
  const assetId = await uploadImage();
  const results = [];
  for (const mode of modes) results.push(await runMode(assetId, mode));
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    account: { deviceId, isolated: true },
    assetId,
    results,
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Cloud image semantic workflow passed for ${modes.join(', ')}.`);
  console.log(`Report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
