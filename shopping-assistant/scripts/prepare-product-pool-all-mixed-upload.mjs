#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const dataRoot = path.resolve(args.dataRoot ?? path.join('E:/', '学习资料', 'data'));
const baseUrl = args.baseUrl ?? 'http://localhost:3000';
const batchSource = args.batchSource ?? `collected_mixed_unuploaded_${dateStamp()}`;
const groupSize = parsePositiveInteger(args.groupSize, 1000);
const batchSize = parsePositiveInteger(args.batchSize, 50);
const demoCount = parsePositiveInteger(args.demoCount, 1000);
const generatedRoot = path.join(repoRoot, 'samples/product-pool/generated');
const workRoot = path.resolve(args.workRoot ?? path.join(generatedRoot, batchSource));
const sourceOutRoot = path.join(workRoot, 'sources');
const groupsRoot = path.resolve(args.groupsRoot ?? path.join(workRoot, `ordinary-groups-${groupSize}x${batchSize}`));
const demoRoot = path.resolve(args.demoRoot ?? path.join(workRoot, `demo-${demoCount}-groups-${groupSize}x${batchSize}`));
const existingKeysFile = path.resolve(args.existingKeysFile ?? path.join(workRoot, 'cloud-existing-product-keys.jsonl'));
const combinedOut = path.join(workRoot, `${batchSource}-ordinary-full.json`);
const demoCombinedOut = path.join(workRoot, `${batchSource}-demo${demoCount}.json`);
const prepareReportPath = path.join(workRoot, 'prepare-report.json');

if (args.clean && existsSync(workRoot)) {
  rmSync(workRoot, { recursive: true, force: true });
}
await mkdir(sourceOutRoot, { recursive: true });

console.log(`Repo root: ${repoRoot}`);
console.log(`Data root: ${dataRoot}`);
console.log(`Batch source: ${batchSource}`);
console.log(`Work root: ${workRoot}`);
console.log(`Ordinary groups root: ${groupsRoot}`);
console.log(`Demo groups root: ${demoRoot}`);
console.log(`Group size: ${groupSize}`);
console.log(`Batch size: ${batchSize}`);
console.log(`Demo count: ${demoCount}`);

const discovered = await discoverSourceFiles(dataRoot);
const sourceGroups = groupFilesByPlatform(discovered);
const normalizedFiles = [];
const sourceSummary = {};

for (const platform of ['jd', 'suning', 'taobao', 'vipshop', 'xianyu']) {
  const files = sourceGroups.get(platform) ?? [];
  sourceSummary[platform] = files.map((file) => file.path);
  if (files.length === 0) {
    console.warn(`No source files for platform: ${platform}`);
    continue;
  }

  const outFull = path.join(sourceOutRoot, `${platform}-full.json`);
  const outFirst = path.join(sourceOutRoot, `${platform}-first80.json`);
  const outRejected = path.join(sourceOutRoot, `${platform}-rejected.jsonl`);
  const outReport = path.join(sourceOutRoot, `${platform}-normalize-report.json`);

  console.log('');
  console.log(`Normalizing ${platform}: ${files.length} file(s)`);

  const normalizeArgs = [
    'scripts/normalize-collected-products.mjs',
    '--batch-source',
    `${batchSource}_${platform}`,
    '--force-platform',
    platform,
    '--out-full',
    outFull,
    '--out-first',
    outFirst,
    '--out-rejected',
    outRejected,
    '--out-report',
    outReport,
  ];
  for (const file of files) normalizeArgs.push('--file', file.path);

  runNode(normalizeArgs);
  normalizedFiles.push(outFull);
}

if (normalizedFiles.length === 0) {
  throw new Error(`No normalizable product files were found under ${dataRoot}.`);
}

if (!args.skipCloudKeyExport) {
  console.log('');
  console.log('Exporting cloud product keys, so already uploaded products are excluded...');
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
} else if (!existsSync(existingKeysFile)) {
  console.warn(`--skip-cloud-key-export was set but key file does not exist: ${existingKeysFile}`);
}

console.log('');
console.log('Building ordinary mixed-platform groups from all unuploaded data...');
const splitArgs = [
  'scripts/split-product-pool-balanced-platforms.mjs',
  '--out-root',
  groupsRoot,
  '--combined-out',
  combinedOut,
  '--group-size',
  String(groupSize),
  '--batch-size',
  String(batchSize),
  '--batch-source-prefix',
  batchSource,
  '--clean',
];
for (const file of normalizedFiles) splitArgs.push('--file', file);
if (existsSync(existingKeysFile)) splitArgs.push('--exclude-keys-file', existingKeysFile);
runNode(splitArgs);

const ordinaryPayload = JSON.parse(await readFile(combinedOut, 'utf8'));
const demoItems = selectBalancedDemoItems(ordinaryPayload.items, demoCount);
const demoKeys = new Set(demoItems.map(itemKey));
const ordinaryRemainingItems = ordinaryPayload.items.filter((item) => !demoKeys.has(itemKey(item)));
const ordinaryRemainingOut = path.join(workRoot, `${batchSource}-ordinary-minus-demo${demoItems.length}.json`);
await writeJson(demoCombinedOut, {
  batchSource: `${batchSource}_demo${demoItems.length}`,
  items: demoItems,
});
await writeJson(ordinaryRemainingOut, {
  batchSource: `${batchSource}_ordinary_minus_demo${demoItems.length}`,
  items: ordinaryRemainingItems,
});

console.log('');
console.log(
  `Rebuilding ordinary groups after reserving demo set: ${ordinaryRemainingItems.length} item(s)...`,
);
runNode([
  'scripts/split-product-pool-balanced-platforms.mjs',
  '--file',
  ordinaryRemainingOut,
  '--out-root',
  groupsRoot,
  '--combined-out',
  path.join(workRoot, `${batchSource}-ordinary-minus-demo${demoItems.length}-combined.json`),
  '--group-size',
  String(groupSize),
  '--batch-size',
  String(batchSize),
  '--batch-source-prefix',
  `${batchSource}_ordinary`,
  '--clean',
]);

console.log('');
console.log(`Building demo set: ${demoItems.length} item(s)...`);
runNode([
  'scripts/split-product-pool-balanced-platforms.mjs',
  '--file',
  demoCombinedOut,
  '--out-root',
  demoRoot,
  '--combined-out',
  path.join(workRoot, `${batchSource}-demo${demoItems.length}-combined.json`),
  '--group-size',
  String(groupSize),
  '--batch-size',
  String(batchSize),
  '--batch-source-prefix',
  `${batchSource}_demo${demoItems.length}`,
  '--clean',
]);

const ordinaryManifest = JSON.parse(await readFile(path.join(groupsRoot, 'manifest.json'), 'utf8'));
const demoManifest = JSON.parse(await readFile(path.join(demoRoot, 'manifest.json'), 'utf8'));
const report = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  dataRoot,
  batchSource,
  workRoot,
  groupsRoot,
  demoRoot,
  existingKeysFile: existsSync(existingKeysFile) ? existingKeysFile : null,
  sourceSummary,
  ordinary: summarizeManifest(ordinaryManifest),
  demo: {
    ...summarizeManifest(demoManifest),
    categoryCounts: countBy(demoItems, categoryOf),
    platformCategoryCounts: countBy(demoItems, (item) => `${platformOf(item)}:${categoryOf(item)}`),
  },
  upload: {
    imageTargetSize: 320,
    imageJpegQuality: 88,
    expectEmbeddingsPerProduct: 1,
    note: 'Use upload-product-pool-groups.ps1 with -ImageTargetSize 320. Cloud should keep PRODUCT_EMBEDDING_KINDS=visual for image-only embeddings.',
  },
};
await writeJson(prepareReportPath, report);

console.log('');
console.log(
  JSON.stringify(
    {
      ordinaryGroupsRoot: groupsRoot,
      ordinaryGroupCount: ordinaryManifest.groupCount,
      ordinaryItemCount: ordinaryManifest.writtenCount,
      demoRoot,
      demoGroupCount: demoManifest.groupCount,
      demoItemCount: demoManifest.writtenCount,
      prepareReportPath,
      ordinaryPlatformCounts: ordinaryManifest.platformCounts,
      demoPlatformCounts: demoManifest.platformCounts,
      demoCategoryCounts: report.demo.categoryCounts,
    },
    null,
    2,
  ),
);

async function discoverSourceFiles(root) {
  const files = [];
  await walk(root);
  return files.sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN'));

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.json', '.jsonl', '.xlsx', '.xls', '.csv'].includes(ext)) continue;
      if (shouldSkipFile(fullPath)) continue;
      const info = statSync(fullPath);
      if (info.size <= 0) continue;
      const platform = classifyPlatform(fullPath);
      if (!platform) continue;
      files.push({ path: fullPath, platform, size: info.size });
    }
  }
}

function shouldSkipFile(filePath) {
  const text = normalizeText(filePath);
  return (
    text.includes('八爪鱼rpa运行日志') ||
    text.includes('rpa运行日志') ||
    text.includes('lost_and_found') ||
    text.includes('normalize-report') ||
    text.includes('rejected') ||
    text.includes('cloud-existing-product-keys')
  );
}

function classifyPlatform(filePath) {
  const base = path.basename(filePath);
  const text = normalizeText(filePath);
  if (['家电.xlsx', '数码.xlsx', '鞋类.xlsx'].includes(base)) return 'jd';
  if (text.includes('jd') || text.includes('京东')) return 'jd';
  if (text.includes('suning') || text.includes('苏宁')) return 'suning';
  if (text.includes('taobao') || text.includes('淘宝') || text.includes('tmall') || text.includes('天猫')) return 'taobao';
  if (text.includes('vipshop') || text.includes('唯品')) return 'vipshop';
  if (text.includes('xianyu') || text.includes('闲鱼') || text.includes('goofish')) return 'xianyu';
  return null;
}

function groupFilesByPlatform(files) {
  const groups = new Map();
  for (const file of files) {
    if (!groups.has(file.platform)) groups.set(file.platform, []);
    groups.get(file.platform).push(file);
  }
  return groups;
}

function selectBalancedDemoItems(items, targetCount) {
  const byPlatform = groupBy(items, platformOf);
  const platformSlots = allocateEvenSlots([...byPlatform.entries()], targetCount);
  const selected = [];

  for (const [platform, slots] of platformSlots) {
    const platformItems = byPlatform.get(platform) ?? [];
    const byCategory = groupBy(platformItems, categoryOf);
    const categorySlots = allocateEvenSlots([...byCategory.entries()], slots);
    const platformSelected = [];
    for (const [category, count] of categorySlots) {
      platformSelected.push(...(byCategory.get(category) ?? []).slice(0, count));
    }
    selected.push(...interleave(platformSelected, (item) => `${platformOf(item)}:${categoryOf(item)}`));
  }

  return interleave(selected.slice(0, targetCount), platformOf);
}

function allocateEvenSlots(entries, total) {
  const active = entries
    .map(([key, rows]) => ({ key, remaining: rows.length }))
    .filter((entry) => entry.remaining > 0);
  const allocation = new Map();
  let remainingSlots = Math.min(total, active.reduce((sum, entry) => sum + entry.remaining, 0));
  while (remainingSlots > 0 && active.some((entry) => entry.remaining > 0)) {
    const available = active.filter((entry) => entry.remaining > 0);
    const passSlots = Math.max(1, Math.floor(remainingSlots / available.length));
    let assignedThisPass = 0;
    for (const entry of available) {
      if (remainingSlots <= 0) break;
      const count = Math.min(entry.remaining, passSlots, remainingSlots);
      allocation.set(entry.key, (allocation.get(entry.key) ?? 0) + count);
      entry.remaining -= count;
      remainingSlots -= count;
      assignedThisPass += count;
    }
    if (assignedThisPass === 0) break;
  }
  return allocation;
}

function interleave(items, keyFn) {
  const queues = groupBy(items, keyFn);
  const keys = [...queues.keys()].sort();
  const result = [];
  while (result.length < items.length) {
    let moved = false;
    for (const key of keys) {
      const next = queues.get(key)?.shift();
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function summarizeManifest(manifest) {
  return {
    outputRoot: manifest.outputRoot,
    writtenCount: manifest.writtenCount,
    groupCount: manifest.groupCount,
    batchCount: manifest.batchCount,
    platformCounts: manifest.platformCounts,
    excludedCloudExistingCount: manifest.excludedCloudExistingCount,
    duplicateCount: manifest.duplicateCount,
  };
}

function platformOf(item) {
  return String(item?.platform ?? 'manual').toLowerCase();
}

function categoryOf(item) {
  return String(item?.categoryHint ?? item?.rawPayload?.attributes?.category ?? 'unknown').toLowerCase();
}

function itemKey(item) {
  return `${platformOf(item)}:${String(item?.externalId ?? '').trim()}`;
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

function normalizeText(value) {
  return String(value ?? '').toLowerCase().replaceAll('\\', '/');
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
    else if (token === '--demo-root') parsed.demoRoot = argv[++index];
    else if (token === '--group-size') parsed.groupSize = argv[++index];
    else if (token === '--batch-size') parsed.batchSize = argv[++index];
    else if (token === '--demo-count') parsed.demoCount = argv[++index];
    else if (token === '--existing-keys-file') parsed.existingKeysFile = argv[++index];
    else if (token === '--skip-cloud-key-export') parsed.skipCloudKeyExport = true;
    else if (token === '--clean') parsed.clean = true;
  }
  return parsed;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function dateStamp() {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}
