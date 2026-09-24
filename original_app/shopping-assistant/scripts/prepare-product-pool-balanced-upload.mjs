#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

const dataRoot = path.resolve(args.dataRoot ?? path.join('E:/', '\u5b66\u4e60\u8d44\u6599', 'data'));
const baseUrl = args.baseUrl ?? 'https://apiserver.zeabur.app';
const batchSource = args.batchSource ?? `collected_mixed_${dateStamp()}`;
const perPlatformLimit = parseNonNegativeInteger(args.perPlatformLimit, 1000);
const groupSize = parsePositiveInteger(args.groupSize, 1000);
const batchSize = parsePositiveInteger(args.batchSize, 50);
const normalizeMaxItemsPerPlatform = parseNonNegativeInteger(args.normalizeMaxItemsPerPlatform, 0);
const generatedRoot = path.join(repoRoot, 'samples/product-pool/generated');
const workRoot = path.join(generatedRoot, batchSource);
const sourceOutRoot = path.join(workRoot, 'sources');
const outRoot = path.resolve(args.outRoot ?? path.join(workRoot, `mixed-groups-${groupSize}x${batchSize}`));
const existingKeysFile = path.resolve(args.existingKeysFile ?? path.join(workRoot, 'cloud-existing-product-keys.jsonl'));

if (args.clean && existsSync(workRoot)) {
  rmSync(workRoot, { recursive: true, force: true });
}
await mkdir(sourceOutRoot, { recursive: true });

const sourceGroups = [
  {
    platform: 'jd',
    files: resolveExistingFiles([
      joinData('家电.xlsx'),
      joinData('数码.xlsx'),
      joinData('鞋类.xlsx'),
    ]),
  },
  {
    platform: 'suning',
    files: resolveExistingFiles([
      joinData('data', '苏宁易购-商品列表-关键词搜索', '苏宁易购-商品列表-关键词搜索.json'),
      joinData('data', '苏宁易购-商品列表-关键词搜索', '苏宁易购-商品列表-关键词搜索(1).json'),
      joinData('data', '苏宁易购-商品列表-关键词搜索', '苏宁易购-商品列表-关键词搜索(2).json'),
      joinData('data', '苏宁易购-商品列表-关键词搜索', '苏宁易购-商品列表-关键词搜索(3).json'),
      joinData('data', '苏宁易购-商品列表-关键词搜索', '苏宁易购-商品列表-关键词搜索20260602212717.xlsx'),
      joinData('data', '苏宁易购-商品列表-关键词搜索', '苏宁易购-商品列表-关键词搜索20260602212902.xlsx'),
    ]),
  },
  {
    platform: 'taobao',
    files: resolveExistingFiles([
      joinData('data', 'taobao_test.json'),
      joinData('data', '淘宝网-商品列表页采集【网站反爬请查阅注意事项】.json'),
      joinData('data', '淘宝网-商品列表页采集【网站反爬请查阅注意事项】(2).xlsx'),
    ]),
  },
  {
    platform: 'vipshop',
    files: resolveExistingFiles([
      joinData('data', '唯品会-商品列表-关键词搜索.json'),
      joinData('data', '唯品会-商品列表-关键词搜索（全速）.json'),
      joinData('data', '唯品会-商品列表-关键词搜索（全速）(1).json'),
      joinData('data', '唯品会-商品列表-关键词搜索（全速）(2).json'),
    ]),
  },
  {
    platform: 'xianyu',
    files: resolveExistingFiles([
      joinData('data', '闲鱼-搜索关键词列表采集', '闲鱼-搜索关键词列表采集.json'),
    ]),
  },
];

console.log(`Repo root: ${repoRoot}`);
console.log(`Data root: ${dataRoot}`);
console.log(`Batch source: ${batchSource}`);
console.log(`Work root: ${workRoot}`);
console.log(`Mixed groups root: ${outRoot}`);
console.log(`Per-platform upload limit: ${perPlatformLimit > 0 ? perPlatformLimit : 'all'}`);

const normalizedFiles = [];

for (const group of sourceGroups) {
  if (group.files.length === 0) {
    console.warn(`No source files for platform: ${group.platform}`);
    continue;
  }

  const outFull = path.join(sourceOutRoot, `${group.platform}-full.json`);
  const outFirst = path.join(sourceOutRoot, `${group.platform}-first80.json`);
  const outRejected = path.join(sourceOutRoot, `${group.platform}-rejected.jsonl`);
  const outReport = path.join(sourceOutRoot, `${group.platform}-normalize-report.json`);

  console.log('');
  console.log(`Normalizing ${group.platform} from ${group.files.length} file(s)...`);

  const normalizeArgs = [
    'scripts/normalize-collected-products.mjs',
    '--batch-source',
    `${batchSource}_${group.platform}`,
    '--force-platform',
    group.platform,
    '--out-full',
    outFull,
    '--out-first',
    outFirst,
    '--out-rejected',
    outRejected,
    '--out-report',
    outReport,
  ];

  for (const file of group.files) normalizeArgs.push('--file', file);
  if (normalizeMaxItemsPerPlatform > 0) {
    normalizeArgs.push('--max-items', String(normalizeMaxItemsPerPlatform));
  }

  runNode(normalizeArgs);
  normalizedFiles.push(outFull);
}

if (!args.skipCloudKeyExport) {
  console.log('');
  console.log('Exporting cloud product keys to avoid re-uploading existing products...');
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
  console.warn(`Skip cloud key export is set, but existing keys file was not found: ${existingKeysFile}`);
}

console.log('');
console.log('Building balanced mixed-platform groups...');

const combinedOut = path.join(workRoot, `${batchSource}-balanced-full.json`);
const splitArgs = [
  'scripts/split-product-pool-balanced-platforms.mjs',
  '--out-root',
  outRoot,
  '--combined-out',
  combinedOut,
  '--group-size',
  String(groupSize),
  '--batch-size',
  String(batchSize),
  '--batch-source-prefix',
  batchSource,
];

for (const file of normalizedFiles) splitArgs.push('--file', file);
if (perPlatformLimit > 0) splitArgs.push('--per-platform-limit', String(perPlatformLimit));
if (existsSync(existingKeysFile)) splitArgs.push('--exclude-keys-file', existingKeysFile);
if (args.clean) splitArgs.push('--clean');

runNode(splitArgs);

console.log('');
console.log('Done.');
console.log('Mixed groups root:');
console.log(outRoot);
console.log('');
console.log('Use this path as -GroupsRoot when uploading.');

function joinData(...parts) {
  return path.join(dataRoot, ...parts);
}

function resolveExistingFiles(files) {
  const resolved = [];
  for (const file of files) {
    if (!existsSync(file)) {
      console.warn(`Missing source file: ${file}`);
      continue;
    }
    const info = statSync(file);
    if (!info.isFile()) continue;
    if (info.size <= 0) {
      console.warn(`Skip empty file: ${file}`);
      continue;
    }
    resolved.push(file);
  }
  return resolved;
}

function runNode(commandArgs) {
  execFileSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--data-root') parsed.dataRoot = argv[++index];
    else if (token === '--base-url') parsed.baseUrl = argv[++index];
    else if (token === '--batch-source') parsed.batchSource = argv[++index];
    else if (token === '--per-platform-limit') parsed.perPlatformLimit = argv[++index];
    else if (token === '--group-size') parsed.groupSize = argv[++index];
    else if (token === '--batch-size') parsed.batchSize = argv[++index];
    else if (token === '--normalize-max-items-per-platform') parsed.normalizeMaxItemsPerPlatform = argv[++index];
    else if (token === '--out-root') parsed.outRoot = argv[++index];
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

function parseNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function dateStamp() {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}
