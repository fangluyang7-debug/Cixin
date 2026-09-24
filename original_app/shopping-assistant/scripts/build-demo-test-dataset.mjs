#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const NAMES = {
  outputDir: '\u6d4b\u8bd5\u96c6',
  testXlsx: '\u6d4b\u8bd5\u96c6.xlsx',
  digitalXlsx: '\u6570\u7801.xlsx',
  applianceXlsx: '\u5bb6\u7535.xlsx',
  shoesXlsx: '\u978b\u7c7b.xlsx',
  taobao: '\u6dd8\u5b9d',
  vipshop: '\u552f\u54c1\u4f1a',
  suning: '\u82cf\u5b81',
  xianyu: '\u95f2\u9c7c',
};

const FIELD = {
  keyword: '\u5173\u952e\u8bcd',
  taobaoTitle: '\u4ea7\u54c1\u540d\u79f0',
  taobaoPrice: '\u4ea7\u54c1\u4ef7\u683c',
  taobaoImage: '\u56fe\u7247\u5730\u5740',
  taobaoUrl: '\u5546\u54c1\u94fe\u63a5',
  taobaoId: '\u5546\u54c1id',
  shopName: '\u5e97\u94fa\u540d\u79f0',
  shopUrl: '\u5e97\u94fa\u94fe\u63a5',
  location: '\u5730\u7406\u4f4d\u7f6e',
  paidCount: '\u4ed8\u6b3e\u4eba\u6570',
  pageUrl: '\u5f53\u524d\u9875\u9762\u7f51\u5740',
  capturedAt: '\u5f53\u524d\u65f6\u95f4',
  pageNo: '\u9875\u7801',
  title: '\u6807\u9898',
  product: '\u5546\u54c1',
  price: '\u4ef7\u683c',
  currentPrice: '\u73b0\u4ef7',
  discountPrice: '\u6298\u540e\u4ef7',
  originalPrice: '\u539f\u4ef7',
  detailUrl: '\u8be6\u60c5\u94fe\u63a5',
  detailPageUrl: '\u8be6\u60c5\u9875\u94fe\u63a5',
  productImage: '\u5546\u54c1\u56fe\u7247',
  listImage: '\u5217\u8868\u9875\u56fe\u7247\u94fe\u63a5',
  image: '\u4e3b\u56fe',
  reviewCount: '\u8bc4\u4ef7\u6570',
  selfOperated: '\u662f\u5426\u81ea\u8425',
  tags: '\u6807\u7b7e',
  pageAddress: '\u9875\u9762\u7f51\u5740',
  currentPageNo: '\u5f53\u524d\u9875\u7801',
};

const MATCH_TERMS = [
  'nike',
  'adidas',
  'puma',
  'new balance',
  'nb',
  'lining',
  'li-ning',
  'anta',
  'xtep',
  'apple',
  'iphone',
  'watch',
  'airpods',
  'huawei',
  'pura',
  'mate',
  'lenovo',
  'thinkpad',
  'xiaomi',
  'honor',
  'oppo',
  'vivo',
  'jbl',
  'sony',
  'bose',
  '\u8010\u514b',
  '\u963f\u8fea\u8fbe\u65af',
  '\u5f6a\u9a6c',
  '\u65b0\u767e\u4f26',
  '\u674e\u5b81',
  '\u5b89\u8e0f',
  '\u7279\u6b65',
  '\u82f9\u679c',
  '\u534e\u4e3a',
  '\u8363\u8000',
  '\u8054\u60f3',
  '\u5c0f\u65b0',
  '\u62ef\u6551\u8005',
  '\u5c0f\u7c73',
  '\u624b\u673a',
  '\u8033\u673a',
  '\u624b\u8868',
  '\u7535\u8111',
  '\u7b14\u8bb0\u672c',
  '\u8dd1\u6b65\u978b',
  '\u8fd0\u52a8\u978b',
  '\u5973\u978b',
  '\u7537\u978b',
];

const NORMALIZED_MATCH_TERMS = MATCH_TERMS.map(normalizeMatchText).filter(Boolean);

const MODEL_TERMS = [
  'dunk',
  'air force',
  'af1',
  'pegasus',
  'vomero',
  'court vision',
  'jordan',
  'superstar',
  'samba',
  'gazelle',
  'spezial',
  'campus',
  'forum',
  'stan smith',
  'duramo',
  'ultraboost',
  'adizero',
  'temperrun',
  'climacool',
  'yeezy',
  'smash',
  'softride',
  'triple',
  'radiatext',
  'skyrocket',
  'aviator',
  'voltiac',
  'axis',
  'x-cell',
  'carina',
  'palermo',
  'caven',
  'rebound',
  'suede',
  'rs-x',
  'arishi',
  'fresh foam',
  'mt10',
  'wl574',
  'wl574rcf',
  'mr530',
  'ml860',
  'm1906',
  '1906',
  '2002r',
  '574',
  '530',
  '860',
  '327',
  '350',
];

const NORMALIZED_MODEL_TERMS = MODEL_TERMS.map(normalizeMatchText).filter(Boolean);

const GENERIC_MATCH_TOKENS = new Set(
  [
    ...MATCH_TERMS,
    'official',
    'flagship',
    'fashion',
    'running',
    'sport',
    'sports',
    'shoe',
    'shoes',
    'sneaker',
    'sneakers',
    'men',
    'women',
    'kids',
    '\u5b98\u65b9',
    '\u65d7\u8230',
    '\u6b63\u54c1',
    '\u7537\u5973',
    '\u7537\u6b3e',
    '\u5973\u6b3e',
    '\u7537\u978b',
    '\u5973\u978b',
    '\u8dd1\u6b65\u978b',
    '\u8fd0\u52a8\u978b',
    '\u4f11\u95f2\u978b',
    '\u677f\u978b',
    '\u8001\u7239\u978b',
    '\u60c5\u4fa3',
    '\u590f\u5b63',
    '\u65b0\u6b3e',
    '\u900f\u6c14',
    '\u7f13\u9707',
    '\u8f7b\u4fbf',
    '\u8010\u78e8',
    '\u4f4e\u5e2e',
    '\u7f51\u9762',
  ].map(normalizeMatchText),
);

const BRAND_ALIASES = [
  ['Nike', ['nike', '\u8010\u514b']],
  ['adidas', ['adidas', '\u963f\u8fea\u8fbe\u65af']],
  ['PUMA', ['puma', '\u5f6a\u9a6c']],
  ['New Balance', ['new balance', '\u65b0\u767e\u4f26', 'nb']],
  ['Apple', ['apple', '\u82f9\u679c', 'iphone', 'airpods']],
  ['Huawei', ['huawei', '\u534e\u4e3a', 'pura', 'mate']],
  ['Lenovo', ['lenovo', '\u8054\u60f3', '\u5c0f\u65b0', '\u62ef\u6551\u8005']],
  ['Xiaomi', ['xiaomi', '\u5c0f\u7c73']],
  ['Honor', ['honor', '\u8363\u8000']],
  ['OPPO', ['oppo']],
  ['vivo', ['vivo']],
  ['JBL', ['jbl']],
  ['Sony', ['sony', '\u7d22\u5c3c']],
  ['Bose', ['bose']],
].map(([brand, aliases]) => [brand, aliases.map(normalizeMatchText).filter(Boolean)]);

const args = parseArgs(process.argv.slice(2));
const ANCHOR_MATCH_PLATFORMS = ['jd', 'vipshop', 'suning', 'xianyu'];
const dataRoot = path.resolve(args.dataRoot ?? path.join(REPO_ROOT, '..', 'data'));
const outputRoot = path.resolve(args.outRoot ?? path.join(dataRoot, NAMES.outputDir));
const batchSource = args.batchSource ?? `demo_test_dataset_${dateStamp()}`;
const targetAnchorCount = parsePositiveInteger(args.targetAnchors, 30);
const minAnchorPlatforms = parsePositiveInteger(args.minAnchorPlatforms, 2);
const matchesPerPlatform = parsePositiveInteger(args.matchesPerPlatform, 2);
const testXlsxLimitPerKeyword = parseNonNegativeInteger(args.testXlsxLimitPerKeyword, 0);
const suningDigitalMatchesPerKeyword = parseNonNegativeInteger(
  args.suningDigitalMatchesPerKeyword,
  5,
);

await mkdir(outputRoot, { recursive: true });

const sourceFiles = await discoverSourceFiles(dataRoot);
if (sourceFiles.length === 0) {
  throw new Error(`No supported source files found under ${dataRoot}`);
}
logStep(`Discovered ${sourceFiles.length} source files`);

const sourceSummary = [];
const allItems = [];
const taobaoKeywords = new Set();
const testKeywords = new Set();

for (const source of sourceFiles.filter((entry) => entry.platform === 'taobao')) {
  logStep(`Loading Taobao source ${path.basename(source.path)}`);
  const { items } = await loadAndNormalizeSource(source, () => true);
  for (const item of items) {
    allItems.push(item);
    if (item.keyword) taobaoKeywords.add(item.keyword);
  }
}

for (const source of sourceFiles.filter((entry) => entry.kind === 'test_xlsx')) {
  logStep(`Loading existing test workbook ${path.basename(source.path)}`);
  const { items } = await loadAndNormalizeSource(source, () => true);
  for (const item of items) {
    allItems.push(item);
    if (item.keyword) testKeywords.add(item.keyword);
  }
}

const taobaoModelIndex = buildTaobaoModelIndex(allItems.filter((item) => item.platform === 'taobao'));
const testCompanionTerms = new Set(
  [...testKeywords].flatMap((keyword) => [
    ...tokenArray(keyword),
    ...modelTokens(keyword),
    ...knownTerms(keyword).map(normalizeMatchText),
  ]),
);

for (const source of sourceFiles.filter(
  (entry) => entry.platform !== 'taobao' && entry.kind !== 'test_xlsx',
)) {
  logStep(`Scanning candidate source ${path.basename(source.path)}`);
  const { items } = await loadAndNormalizeSource(source, (row) =>
    shouldKeepCandidateRow(row, source, taobaoKeywords, testCompanionTerms, taobaoModelIndex),
  );
  allItems.push(...items);
}

const byPlatform = groupBy(allItems, (item) => item.platform);
logStep('Selecting Taobao anchors with lazy similarity coverage');
const anchorCoverage = new Map();
const coverageCalculator = createAnchorCoverageCalculator(byPlatform, anchorCoverage);
const anchors = selectTaobaoAnchors(byPlatform.get('taobao') ?? [], anchorCoverage, {
  targetAnchorCount,
  minAnchorPlatforms,
  coverageCalculator,
});
const anchorGroups = buildAnchorGroups(anchors, byPlatform, matchesPerPlatform);
logStep(`Selected ${anchors.length} Taobao anchors`);
const anchorItems = anchorGroups.flatMap((group) => group.items);
const anchorOnlyInternalItems = dedupeItems(anchorItems);
const anchorOnlyItems = anchorOnlyInternalItems.map(toImportItem);
const existingTestItems = selectExistingTestItems(byPlatform.get('jd') ?? [], testXlsxLimitPerKeyword);
const explicitTestCompanionItems = selectExplicitTestCompanionItems(allItems);
const inferredTestCompanionItems = selectSuningDigitalCompanions(
  existingTestItems,
  byPlatform.get('suning') ?? [],
  suningDigitalMatchesPerKeyword,
);
const testCompanionItems = dedupeItems([...explicitTestCompanionItems, ...inferredTestCompanionItems]);

const finalInternalItems = dedupeItems([
  ...anchorItems,
  ...existingTestItems,
  ...testCompanionItems,
]);
const finalItems = finalInternalItems.map(toImportItem);

const payload = {
  batchSource,
  items: finalItems,
};
const platformPayloads = Object.fromEntries(
  [...groupBy(finalItems, (item) => item.platform).entries()].map(([platform, items]) => [
    platform,
    { batchSource: `${batchSource}_${platform}`, items },
  ]),
);

const platformDir = path.join(outputRoot, 'by-platform');
await mkdir(platformDir, { recursive: true });
await writeJson(path.join(outputRoot, 'demo-product-pool-full.json'), payload);
await writeJson(path.join(outputRoot, 'taobao-anchor-product-pool.json'), {
  batchSource: `${batchSource}_taobao_anchor_only`,
  items: anchorOnlyItems,
});
for (const [platform, platformPayload] of Object.entries(platformPayloads).sort()) {
  await writeJson(path.join(platformDir, `demo-product-pool-${platform}.json`), platformPayload);
}

const anchorGroupsForOutput = anchorGroups.map((group) => ({
  anchorIndex: group.anchorIndex,
  keyword: group.keyword,
  anchorTitle: group.anchorTitle,
  anchorPlatform: 'taobao',
  similarityCoverage: group.similarityCoverage,
  selectedCounts: countByObject(group.items, (item) => item.platform),
  items: group.items.map((item) => ({
    platform: item.platform,
    title: item.title,
    price: item.price,
    shopName: item.shopName ?? null,
    productUrl: item.productUrl,
    sourceFile: item._meta.sourceFile,
    sourceKind: item._meta.sourceKind,
    matchReason: item._meta.matchReason ?? null,
    sharedModelTerms: item._meta.sharedModelTerms ?? [],
  })),
}));
await writeJson(path.join(outputRoot, 'taobao-anchor-groups.json'), {
  batchSource,
  targetAnchorCount,
  selectedAnchorCount: anchors.length,
  groups: anchorGroupsForOutput,
});

const report = buildReport({
  batchSource,
  dataRoot,
  outputRoot,
  sourceSummary,
  allItems,
  finalInternalItems,
  finalItems,
  anchorOnlyItems,
  anchors,
  anchorGroups,
  existingTestItems,
  explicitTestCompanionItems,
  inferredTestCompanionItems,
  testCompanionItems,
  anchorCoverage,
});
await writeJson(path.join(outputRoot, 'testset-build-report.json'), report);
await writeFile(
  path.join(outputRoot, `${NAMES.outputDir}\u5546\u54c1\u6e05\u5355.txt`),
  `\ufeff${buildTxt(report, anchorGroups)}`,
  'utf8',
);

console.log(
  JSON.stringify(
    {
      outputRoot,
      batchSource,
      selectedAnchorCount: anchors.length,
      finalItemCount: finalItems.length,
      platformCounts: countByObject(finalItems, (item) => item.platform),
      files: [
        path.join(outputRoot, 'demo-product-pool-full.json'),
        path.join(outputRoot, 'taobao-anchor-product-pool.json'),
        path.join(outputRoot, 'taobao-anchor-groups.json'),
        path.join(outputRoot, 'testset-build-report.json'),
        path.join(outputRoot, `${NAMES.outputDir}\u5546\u54c1\u6e05\u5355.txt`),
      ],
    },
    null,
    2,
  ),
);

function logStep(message) {
  if (args.quiet) return;
  console.error(`[build-demo-test-dataset] ${new Date().toISOString()} ${message}`);
}

async function loadAndNormalizeSource(source, shouldKeepRow) {
  const rows = await readRows(source.path);
  let acceptedCount = 0;
  let rejectedCount = 0;
  let skippedCount = 0;
  const items = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (!shouldKeepRow(row)) {
      skippedCount += 1;
      continue;
    }
    const normalized = normalizeRow(row, {
      platform: source.platform,
      sourceKind: source.kind,
      sourceFile: path.basename(source.path),
      rowIndex,
    });
    if (!normalized) {
      rejectedCount += 1;
      continue;
    }
    acceptedCount += 1;
    items.push(normalized);
  }
  sourceSummary.push({
    sourceFile: path.basename(source.path),
    platform: source.platform,
    sourceKind: source.kind,
    rawCount: rows.length,
    acceptedCount,
    rejectedCount,
    skippedPrefilterCount: skippedCount,
  });
  return { items, rows };
}

function shouldKeepCandidateRow(row, source, taobaoKeywordSet, testTerms, taobaoModelIndex) {
  const keyword = extractRowKeyword(row);
  if (keyword && taobaoKeywordSet.has(keyword)) return true;
  if (matchesTaobaoModelIndex(row, taobaoModelIndex)) return true;
  if (source.platform !== 'suning') return false;
  const text = normalizeMatchText(`${keyword ?? ''} ${extractRowTitle(row) ?? ''}`);
  if (!text) return false;
  let score = 0;
  for (const term of testTerms) {
    if (term && text.includes(term)) score += term.length >= 4 ? 3 : 2;
  }
  return score >= 5;
}

function buildTaobaoModelIndex(taobaoItems) {
  const byBrand = new Map();
  for (const item of taobaoItems) {
    const brand = brandKey(item.brandHint ?? inferBrand(`${item.keyword ?? ''} ${item.title}`));
    if (!brand) continue;
    const terms = productModelTerms(`${item.keyword ?? ''} ${item.title}`);
    if (terms.length === 0) continue;
    if (!byBrand.has(brand)) byBrand.set(brand, new Set());
    const bucket = byBrand.get(brand);
    for (const term of terms) bucket.add(term);
  }
  return byBrand;
}

function matchesTaobaoModelIndex(row, taobaoModelIndex) {
  const text = `${extractRowKeyword(row) ?? ''} ${extractRowTitle(row) ?? ''}`;
  const brand = brandKey(inferBrand(text));
  if (!brand || !taobaoModelIndex.has(brand)) return false;
  const candidateTerms = productModelTerms(text);
  if (candidateTerms.length === 0) return false;
  const taobaoTerms = taobaoModelIndex.get(brand);
  return candidateTerms.some((term) => taobaoTerms.has(term));
}

async function discoverSourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(root, entry.name);
    const source = classifySource(fullPath);
    if (source) files.push(source);
  }
  return files.sort((left, right) =>
    `${left.platform}:${left.path}`.localeCompare(`${right.platform}:${right.path}`, 'zh-Hans-CN'),
  );
}

function classifySource(filePath) {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();
  const ext = path.extname(base).toLowerCase();
  if (!['.json', '.jsonl', '.xlsx', '.xls', '.csv'].includes(ext)) return null;

  if (base.includes('\u6d4b\u8bd5\u5bf9\u5e94\u96c6')) {
    if (base.includes(NAMES.taobao)) {
      return { path: filePath, platform: 'taobao', kind: 'test_companion_xlsx' };
    }
    if (base.includes(NAMES.vipshop)) {
      return { path: filePath, platform: 'vipshop', kind: 'test_companion_xlsx' };
    }
    if (base.includes(NAMES.suning)) {
      return { path: filePath, platform: 'suning', kind: 'test_companion_xlsx' };
    }
  }

  if (lower === 'taobao_test.json' || base.includes(NAMES.taobao)) {
    return { path: filePath, platform: 'taobao', kind: 'taobao_json' };
  }
  if (base.includes(NAMES.vipshop)) {
    return { path: filePath, platform: 'vipshop', kind: 'vipshop_json' };
  }
  if (base.includes(NAMES.suning)) {
    return { path: filePath, platform: 'suning', kind: 'suning_json' };
  }
  if (base.includes(NAMES.xianyu)) {
    return { path: filePath, platform: 'xianyu', kind: 'xianyu_json' };
  }
  if (
    base === NAMES.digitalXlsx ||
    base === NAMES.applianceXlsx ||
    base === NAMES.shoesXlsx ||
    base === NAMES.testXlsx
  ) {
    return {
      path: filePath,
      platform: 'jd',
      kind: base === NAMES.testXlsx ? 'test_xlsx' : 'jd_xlsx',
    };
  }
  return null;
}

async function readRows(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.json' || ext === '.jsonl') {
    const text = await readFile(inputPath, 'utf8');
    return parseJsonRows(text);
  }
  return readTabularRows(inputPath);
}

function parseJsonRows(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      for (const key of ['items', 'products', 'data', 'list', 'rows']) {
        if (Array.isArray(parsed[key])) return parsed[key];
      }
    }
    return [];
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readTabularRows(inputPath) {
  const python = await resolvePythonCommand();
  const helperPath = path.join(SCRIPT_DIR, 'read-tabular-product-data.py');
  const { stdout } = await execFileAsync(python, [helperPath, inputPath], {
    cwd: REPO_ROOT,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 1024 * 1024 * 1024,
    windowsHide: true,
  });
  const rows = JSON.parse(stdout);
  if (!Array.isArray(rows)) {
    throw new Error(`Tabular helper returned a non-array payload for ${inputPath}`);
  }
  return rows;
}

async function resolvePythonCommand() {
  if (args.python) return path.resolve(args.python);
  if (process.env.PRODUCT_DATA_PYTHON) return process.env.PRODUCT_DATA_PYTHON;
  const home = process.env.USERPROFILE ?? process.env.HOME;
  const bundled = home
    ? path.join(
        home,
        '.cache',
        'codex-runtimes',
        'codex-primary-runtime',
        'dependencies',
        'python',
        'python.exe',
      )
    : null;
  return bundled ?? 'python';
}

function normalizeRow(row, context) {
  if (!row || typeof row !== 'object') return null;

  const keyword = cleanString(firstField(row, [FIELD.keyword, 'keyword', 'column1']));
  const title = normalizeTitle(
    firstField(row, [
      FIELD.taobaoTitle,
      FIELD.title,
      FIELD.product,
      'title',
      'name',
      'productTitle',
      'column2',
    ]),
  );
  const price = normalizePrice(selectPrice(row, context.platform));
  const imageUrl = normalizeUrl(
    firstField(row, [
      FIELD.taobaoImage,
      FIELD.productImage,
      FIELD.listImage,
      FIELD.image,
      'imageUrl',
      'coverImageUrl',
      'picUrl',
      'imgUrl',
      'column4',
    ]),
  );
  const rawProductUrl = normalizeUrl(
    firstField(row, [
      FIELD.taobaoUrl,
      FIELD.detailUrl,
      FIELD.detailPageUrl,
      '\u5546\u54c1\u94fe\u63a5',
      'productUrl',
      'itemUrl',
      'detailUrl',
      'url',
    ]),
  );
  const shopName = normalizeTitle(
    firstField(row, [FIELD.shopName, FIELD.selfOperated, '\u5e97\u94fa', 'shopName', 'storeName', 'column5']),
  );

  if (!title || !price || !imageUrl) return null;

  const productUrl =
    rawProductUrl ??
    synthesizeProductUrl({
      platform: context.platform,
      title,
      imageUrl,
      shopName,
    });
  if (!productUrl) return null;

  const ids = extractExternalIds(context.platform, productUrl);
  const exportedId = cleanString(firstField(row, [FIELD.taobaoId, 'id', 'itemId', 'skuId', 'productId']));
  const externalId =
    ids.externalId ??
    (isUsefulExternalId(exportedId) ? exportedId : null) ??
    `hash-${shortHash(`${context.platform}|${productUrl}|${imageUrl}|${title}|${price}`)}`;
  const categoryHint = inferCategory(`${keyword ?? ''} ${title}`);
  const brandHint = inferBrand(`${keyword ?? ''} ${title} ${shopName ?? ''}`);
  const product = {
    externalId,
    platform: context.platform,
    title,
    price,
    currency: 'CNY',
    stockStatus: 'in_stock',
    shopName: shopName ?? undefined,
    shopType: normalizeShopType(shopName, context.platform),
    productUrl: canonicalProductUrl(context.platform, externalId, productUrl),
    imageUrl,
    brandHint: brandHint ?? undefined,
    categoryHint,
    rawPayload: removeEmpty({
      source: 'demo_test_dataset_builder',
      sourceKind: context.sourceKind,
      sourceFile: context.sourceFile,
      originalRowIndex: context.rowIndex,
      keyword,
      sourceKeyword: keyword,
      location: cleanString(firstField(row, [FIELD.location])),
      salesText: cleanString(firstField(row, [FIELD.paidCount, FIELD.reviewCount, 'column7'])),
      pageUrl: normalizeUrl(firstField(row, [FIELD.pageUrl, FIELD.pageAddress])),
      pageNo: cleanString(firstField(row, [FIELD.pageNo, FIELD.currentPageNo])),
      capturedAt: cleanString(firstField(row, [FIELD.capturedAt])),
      attributes: removeEmpty({
        category: categoryHint,
        brand: brandHint,
        keywordTokens: tokenArray(keyword ?? ''),
        titleTokens: tokenArray(title),
        jdAttributes: context.platform === 'jd' ? cleanString(row.column6) : null,
        jdServiceTags: context.platform === 'jd' ? cleanString(row.column8) : null,
        jdDeliveryTag: context.platform === 'jd' ? cleanString(row.column9) : null,
        tags: cleanString(firstField(row, [FIELD.tags])),
      }),
    }),
  };

  return {
    ...removeEmpty(product),
    keyword: keyword ?? null,
    _meta: {
      sourceKind: context.sourceKind,
      sourceFile: context.sourceFile,
      rowIndex: context.rowIndex,
      categoryHint,
      matchTokens: tokenArray(`${keyword ?? ''} ${title}`),
      modelTokens: modelTokens(`${keyword ?? ''} ${title}`),
    },
  };
}

function extractRowKeyword(row) {
  return cleanString(firstField(row, [FIELD.keyword, 'keyword', 'column1']));
}

function extractRowTitle(row) {
  return normalizeTitle(
    firstField(row, [
      FIELD.taobaoTitle,
      FIELD.title,
      FIELD.product,
      'title',
      'name',
      'productTitle',
      'column2',
    ]),
  );
}

function selectPrice(row, platform) {
  if (platform === 'vipshop') {
    const candidates = [FIELD.discountPrice, FIELD.currentPrice, FIELD.price, FIELD.originalPrice]
      .map((field) => normalizePrice(row[field]))
      .filter(Boolean)
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    if (candidates.length > 0) return String(Math.min(...candidates));
  }
  return firstField(row, [
    FIELD.taobaoPrice,
    FIELD.price,
    FIELD.discountPrice,
    FIELD.currentPrice,
    FIELD.originalPrice,
    'price',
    'salePrice',
    'column3',
  ]);
}

function buildAnchorSimilarityCoverage(byPlatformInput) {
  const coverage = new Map();
  const calculator = createAnchorCoverageCalculator(byPlatformInput, coverage);
  const taobaoItems = byPlatformInput.get('taobao') ?? [];
  for (const anchor of taobaoItems) calculator(anchor);
  return coverage;
}

function createAnchorCoverageCalculator(byPlatformInput, coverage = new Map()) {
  const indexes = buildPlatformCandidateIndexes(byPlatformInput);
  return (anchor) => {
    const key = anchorCoverageKey(anchor);
    if (coverage.has(key)) return coverage.get(key);
    const counts = {};
    let matchedPlatformCount = 0;
    for (const platform of ANCHOR_MATCH_PLATFORMS) {
      const matches = rankedHighSimilarityMatches(anchor, candidateSetForAnchor(anchor, indexes.get(platform)));
      counts[platform] = matches.length;
      if (matches.length > 0) matchedPlatformCount += 1;
    }
    const info = { matchedPlatformCount, counts };
    coverage.set(key, info);
    return info;
  };
}

function selectTaobaoAnchors(taobaoItems, coverage, options) {
  const deduped = dedupeBy(
    taobaoItems.filter(hasUsefulAnchorSignal).sort((left, right) => anchorSignalScore(right) - anchorSignalScore(left)),
    anchorDedupeKey,
  );
  const grouped = groupBy(deduped, (item) => item.keyword ?? '');
  const keywords = [...grouped.keys()]
    .filter(Boolean)
    .sort((left, right) => (grouped.get(right)?.length ?? 0) - (grouped.get(left)?.length ?? 0));

  const selected = [];
  while (selected.length < options.targetAnchorCount && keywords.length > 0) {
    let moved = false;
    for (const keyword of keywords) {
      if (selected.length >= options.targetAnchorCount) break;
      const bucket = grouped.get(keyword) ?? [];
      while (bucket.length > 0) {
        const next = bucket.shift();
        const info = options.coverageCalculator
          ? options.coverageCalculator(next)
          : coverage.get(anchorCoverageKey(next));
        if (info && info.matchedPlatformCount >= options.minAnchorPlatforms) {
          selected.push(next);
          moved = true;
          break;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return selected;
}

function hasUsefulAnchorSignal(item) {
  if (!brandKey(item.brandHint ?? inferBrand(`${item.keyword ?? ''} ${item.title}`))) return false;
  return productModelTerms(`${item.keyword ?? ''} ${item.title}`).length > 0;
}

function anchorSignalScore(item) {
  const text = `${item.keyword ?? ''} ${item.title}`;
  const categoryScore = item._meta.categoryHint && item._meta.categoryHint !== 'general' ? 10 : 0;
  return categoryScore + productModelTerms(text).length * 5 + specificTokens(text).length;
}

function anchorDedupeKey(item) {
  if (item.platform === 'taobao' && item.externalId) return `${item.platform}:${item.externalId}`;
  return `${item.platform}:${normalizeMatchText(`${item.productUrl ?? ''}|${item.imageUrl ?? ''}|${item.title}`)}`;
}

function buildAnchorGroups(anchors, byPlatformInput, perPlatformLimit) {
  const cursors = new Map();
  const indexes = buildPlatformCandidateIndexes(byPlatformInput);
  return anchors.map((anchor, index) => {
    const items = [
      {
        ...anchor,
        _meta: {
          ...anchor._meta,
          matchReason: 'taobao_anchor',
        },
      },
    ];
    const coverage = {};
    for (const platform of ANCHOR_MATCH_PLATFORMS) {
      const candidates = candidateSetForAnchor(anchor, indexes.get(platform));
      const allMatches = rankedHighSimilarityMatches(anchor, candidates);
      const matches = bestMatchesForAnchor(
        anchor,
        candidates,
        perPlatformLimit,
        cursors,
        platform,
      );
      coverage[platform] = {
        highSimilarityCount: allMatches.length,
        selectedCount: matches.length,
      };
      items.push(...matches);
    }
    return {
      anchorIndex: index + 1,
      keyword: anchor.keyword,
      anchorTitle: anchor.title,
      similarityCoverage: coverage,
      items: dedupeItems(items),
    };
  });
}

function buildPlatformCandidateIndexes(byPlatformInput) {
  const indexes = new Map();
  for (const platform of ANCHOR_MATCH_PLATFORMS) {
    const byKeyword = new Map();
    const byBrandModel = new Map();
    for (const item of byPlatformInput.get(platform) ?? []) {
      if (item.keyword) appendMapItem(byKeyword, item.keyword, item);
      const brand = brandKey(item.brandHint ?? inferBrand(`${item.keyword ?? ''} ${item.title}`));
      if (!brand) continue;
      for (const term of productModelTerms(`${item.keyword ?? ''} ${item.title}`)) {
        appendMapItem(byBrandModel, `${brand}:${term}`, item);
      }
    }
    indexes.set(platform, { byKeyword, byBrandModel });
  }
  return indexes;
}

function candidateSetForAnchor(anchor, index) {
  if (!index) return [];
  const candidates = new Map();
  if (anchor.keyword) {
    for (const item of index.byKeyword.get(anchor.keyword) ?? []) candidates.set(itemKey(item), item);
  }
  const brand = brandKey(anchor.brandHint ?? inferBrand(`${anchor.keyword ?? ''} ${anchor.title}`));
  if (brand) {
    for (const term of productModelTerms(`${anchor.keyword ?? ''} ${anchor.title}`)) {
      for (const item of index.byBrandModel.get(`${brand}:${term}`) ?? []) candidates.set(itemKey(item), item);
    }
  }
  return [...candidates.values()];
}

function appendMapItem(map, key, item) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(item);
}

function bestMatchesForAnchor(anchor, candidates, limit, cursors, platform) {
  if (limit <= 0) return [];
  const scored = rankedHighSimilarityMatches(anchor, candidates);
  const deduped = dedupeBy(scored, (entry) => itemKey(entry.item));
  const selected = takeRotating(deduped, limit, cursors, `${platform}:${anchor.keyword ?? ''}`);
  return selected
    .map((entry) => ({
      ...entry.item,
      _meta: {
        ...entry.item._meta,
        matchReason: entry.exactKeyword
          ? `high_similarity_exact_keyword_score_${entry.score}`
          : `high_similarity_model_score_${entry.score}`,
        sharedModelTerms: entry.sharedModelTerms,
      },
    }));
}

function rankedHighSimilarityMatches(anchor, candidates) {
  return candidates
    .map((candidate) => {
      const score = scoreAnchorMatch(anchor, candidate);
      const sharedModelTerms = sharedProductModelTerms(anchor, candidate);
      return {
        item: candidate,
        score,
        sharedModelTerms,
        exactKeyword: anchor.keyword && candidate.keyword === anchor.keyword,
      };
    })
    .filter((entry) => isHighSimilarityMatch(anchor, entry.item, entry.score, entry.sharedModelTerms))
    .sort((left, right) => {
      const byModel = right.sharedModelTerms.length - left.sharedModelTerms.length;
      if (byModel !== 0) return byModel;
      return right.score - left.score;
    });
}

function bestCoverageForKeyword(items, coverage) {
  return items
    .map((item) => coverage.get(anchorCoverageKey(item)))
    .filter(Boolean)
    .sort((left, right) => right.matchedPlatformCount - left.matchedPlatformCount)[0];
}

function takeRotating(items, limit, cursors, key) {
  if (items.length === 0) return [];
  const count = Math.min(limit, items.length);
  const start = cursors.get(key) ?? 0;
  const selected = [];
  for (let offset = 0; offset < count; offset += 1) {
    selected.push(items[(start + offset) % items.length]);
  }
  cursors.set(key, (start + count) % items.length);
  return selected;
}

function scoreAnchorMatch(anchor, candidate) {
  if (hasBrandConflict(anchor, candidate)) return -1;
  if (hasCategoryConflict(anchor, candidate)) return -1;

  let score = 0;
  if (brandKey(anchor.brandHint) && brandKey(anchor.brandHint) === brandKey(candidate.brandHint)) score += 30;
  if (anchor.keyword && candidate.keyword === anchor.keyword) score += 12;
  if (anchor._meta.categoryHint && anchor._meta.categoryHint === candidate._meta.categoryHint) score += 4;

  const anchorTokens = new Set(anchor._meta.matchTokens);
  for (const token of candidate._meta.matchTokens) {
    if (anchorTokens.has(token)) score += token.length >= 4 ? 3 : 1;
  }

  for (const token of sharedProductModelTerms(anchor, candidate)) {
    score += token.length >= 4 ? 20 : 12;
  }

  const anchorTerms = knownTerms(`${anchor.keyword ?? ''} ${anchor.title}`);
  const candidateText = normalizeMatchText(`${candidate.keyword ?? ''} ${candidate.title}`);
  for (const term of anchorTerms) {
    if (candidateText.includes(normalizeMatchText(term))) score += 3;
  }

  return score;
}

function isHighSimilarityMatch(anchor, candidate, score, sharedModelTerms) {
  if (score < 0 || hasBrandConflict(anchor, candidate) || hasCategoryConflict(anchor, candidate)) return false;
  if (sharedModelTerms.length > 0 && score >= 45) return true;

  const anchorSpecific = new Set(specificTokens(`${anchor.keyword ?? ''} ${anchor.title}`));
  const candidateSpecific = new Set(specificTokens(`${candidate.keyword ?? ''} ${candidate.title}`));
  const overlap = [...anchorSpecific].filter((token) => candidateSpecific.has(token));
  if (overlap.length >= 2 && score >= 55) return true;
  return false;
}

function sharedProductModelTerms(anchor, candidate) {
  const left = new Set(productModelTerms(`${anchor.keyword ?? ''} ${anchor.title}`));
  const right = new Set(productModelTerms(`${candidate.keyword ?? ''} ${candidate.title}`));
  return [...left].filter((term) => right.has(term));
}

function hasBrandConflict(anchor, candidate) {
  const left = brandKey(anchor.brandHint);
  const right = brandKey(candidate.brandHint);
  return Boolean(left && right && left !== right);
}

function hasCategoryConflict(anchor, candidate) {
  const left = anchor._meta.categoryHint;
  const right = candidate._meta.categoryHint;
  if (!left || !right || left === 'general' || right === 'general') return false;
  return left !== right;
}

function anchorCoverageKey(item) {
  return itemKey(item);
}

function selectExistingTestItems(jdItems, limitPerKeyword) {
  const testItems = jdItems.filter((item) => item._meta.sourceKind === 'test_xlsx');
  if (!limitPerKeyword) {
    return testItems.map((item) => ({
      ...item,
      _meta: { ...item._meta, matchReason: 'existing_test_xlsx' },
    }));
  }

  const selected = [];
  const grouped = groupBy(testItems, (item) => item.keyword ?? '');
  for (const items of grouped.values()) {
    selected.push(
      ...items.slice(0, limitPerKeyword).map((item) => ({
        ...item,
        _meta: { ...item._meta, matchReason: 'existing_test_xlsx' },
      })),
    );
  }
  return selected;
}

function selectExplicitTestCompanionItems(items) {
  return items
    .filter((item) => item._meta.sourceKind === 'test_companion_xlsx')
    .map((item) => ({
      ...item,
      _meta: {
        ...item._meta,
        matchReason: `explicit_test_companion_${item.platform}`,
      },
    }));
}

function selectSuningDigitalCompanions(testItems, suningItems, limitPerKeyword) {
  if (limitPerKeyword <= 0) return [];
  const selected = [];
  const testKeywords = [...new Set(testItems.map((item) => item.keyword).filter(Boolean))];
  for (const keyword of testKeywords) {
    const terms = new Set([...knownTerms(keyword), ...tokenArray(keyword), ...modelTokens(keyword)]);
    const scored = suningItems
      .map((item) => {
        const text = normalizeMatchText(`${item.keyword ?? ''} ${item.title}`);
        let score = 0;
        for (const term of terms) {
          const normalized = normalizeMatchText(term);
          if (normalized && text.includes(normalized)) score += normalized.length >= 4 ? 3 : 2;
        }
        if (isDigitalCategory(item._meta.categoryHint)) score += 2;
        return { item, score };
      })
      .filter((entry) => entry.score >= 5)
      .sort((left, right) => right.score - left.score);

    selected.push(
      ...dedupeBy(scored, (entry) => itemKey(entry.item))
        .slice(0, limitPerKeyword)
        .map((entry) => ({
          ...entry.item,
          _meta: {
            ...entry.item._meta,
            matchReason: `test_xlsx_suning_companion_${normalizeMatchText(keyword)}_score_${entry.score}`,
          },
        })),
    );
  }
  return dedupeItems(selected);
}

function buildReport(input) {
  const taobaoCoverageRows = [...input.anchorCoverage.entries()]
    .map(([anchorKey, info]) => ({
      anchorKey,
      matchedPlatformCount: info.matchedPlatformCount,
      counts: info.counts,
    }))
    .sort((left, right) => {
      const byCoverage = right.matchedPlatformCount - left.matchedPlatformCount;
      if (byCoverage !== 0) return byCoverage;
      return left.anchorKey.localeCompare(right.anchorKey, 'zh-Hans-CN');
    });

  const finalTestItems = input.finalInternalItems.filter((item) => item._meta.sourceKind === 'test_xlsx');
  const selectedTestKeywordCounts = countBy(finalTestItems, (item) => item.keyword ?? '');
  const finalExplicitCompanionItems = input.finalInternalItems.filter(
    (item) => item._meta.sourceKind === 'test_companion_xlsx',
  );
  return {
    generatedAt: new Date().toISOString(),
    batchSource: input.batchSource,
    dataRoot: input.dataRoot,
    outputRoot: input.outputRoot,
    note: [
      'This script only prepares local test-set artifacts. It does not upload products and does not change backend environment variables.',
      'Future upload intent recorded by the user: process images at 480p and use hybrid embeddings.',
      `Taobao anchors are included only when at least ${minAnchorPlatforms} of these platforms have high-similarity model matches: ${ANCHOR_MATCH_PLATFORMS.join(', ')}.`,
      'Anchor companion items require matching brand/category plus repeated model or strong product-line terms; generic keyword-only matches are not counted.',
    ],
    intendedUploadSettings: {
      imageTargetSize: 480,
      embeddingMode: 'hybrid',
      appliedToEnvironment: false,
    },
    sourceSummary: input.sourceSummary,
    sourceItemCounts: countByObject(input.allItems, (item) => `${item.platform}:${item._meta.sourceKind}`),
    selected: {
      finalItemCount: input.finalItems.length,
      finalPlatformCounts: countByObject(input.finalItems, (item) => item.platform),
      finalCategoryCounts: countByObject(input.finalInternalItems, (item) => item._meta.categoryHint),
      taobaoAnchorCount: input.anchors.length,
      anchorPlatformCounts: countByObject(
        input.anchorGroups.flatMap((group) => group.items),
        (item) => item.platform,
      ),
      anchorOnlyItemCount: input.anchorOnlyItems.length,
      anchorOnlyPlatformCounts: countByObject(input.anchorOnlyItems, (item) => item.platform),
      existingTestXlsxAcceptedItemCount: input.existingTestItems.length,
      existingTestXlsxFinalItemCount: finalTestItems.length,
      existingTestXlsxKeywordCounts: Object.fromEntries(
        [...selectedTestKeywordCounts.entries()].sort((left, right) =>
          left[0].localeCompare(right[0], 'zh-Hans-CN'),
        ),
      ),
      explicitTestCompanionAcceptedItemCount: input.explicitTestCompanionItems.length,
      explicitTestCompanionFinalItemCount: finalExplicitCompanionItems.length,
      explicitTestCompanionPlatformCounts: countByObject(finalExplicitCompanionItems, (item) => item.platform),
      explicitTestCompanionSourceCounts: countByObject(finalExplicitCompanionItems, (item) => item._meta.sourceFile),
      inferredSuningDigitalCompanionCount: input.inferredTestCompanionItems.length,
      testCompanionItemCount: input.testCompanionItems.length,
    },
    taobaoAnchorSimilarityCoverage: taobaoCoverageRows,
    files: {
      fullPayload: path.join(input.outputRoot, 'demo-product-pool-full.json'),
      anchorOnlyPayload: path.join(input.outputRoot, 'taobao-anchor-product-pool.json'),
      byPlatformDir: path.join(input.outputRoot, 'by-platform'),
      anchorGroups: path.join(input.outputRoot, 'taobao-anchor-groups.json'),
      report: path.join(input.outputRoot, 'testset-build-report.json'),
      productListTxt: path.join(input.outputRoot, `${NAMES.outputDir}\u5546\u54c1\u6e05\u5355.txt`),
    },
  };
}

function buildTxt(report, anchorGroups) {
  const lines = [];
  lines.push('\u6d4b\u8bd5\u96c6\u5546\u54c1\u6e05\u5355');
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push('');
  lines.push('\u4e00\u3001\u6570\u636e\u96c6\u6982\u89c8');
  lines.push(`- Batch source: ${report.batchSource}`);
  lines.push(`- Final product-pool items: ${report.selected.finalItemCount}`);
  lines.push(`- Platform counts: ${formatObject(report.selected.finalPlatformCounts)}`);
  lines.push(`- Category counts: ${formatObject(report.selected.finalCategoryCounts)}`);
  lines.push(`- Taobao anchor groups: ${report.selected.taobaoAnchorCount}`);
  lines.push(
    `- Existing rows accepted from ${NAMES.testXlsx}: ${report.selected.existingTestXlsxAcceptedItemCount}`,
  );
  lines.push(
    `- Existing rows kept after product dedupe: ${report.selected.existingTestXlsxFinalItemCount}`,
  );
  lines.push(
    `- Explicit rows from Taobao/Vipshop/Suning test companion workbooks: ${report.selected.explicitTestCompanionFinalItemCount}`,
  );
  lines.push(
    `- Explicit test companion platform counts: ${formatObject(report.selected.explicitTestCompanionPlatformCounts)}`,
  );
  lines.push(
    `- Inferred extra Suning digital companions: ${report.selected.inferredSuningDigitalCompanionCount}`,
  );
  lines.push('');
  lines.push('\u4e8c\u3001\u73b0\u6709\u6d4b\u8bd5\u96c6.xlsx\u5546\u54c1\u7ec4');
  for (const [keyword, count] of Object.entries(report.selected.existingTestXlsxKeywordCounts)) {
    lines.push(`- ${keyword}: ${count}`);
  }
  lines.push('');
  lines.push('\u4e09\u3001\u6d4b\u8bd5\u5bf9\u5e94\u96c6\u8de8\u5e73\u53f0\u8865\u5145');
  for (const [sourceFile, count] of Object.entries(report.selected.explicitTestCompanionSourceCounts)) {
    lines.push(`- ${sourceFile}: ${count}`);
  }
  lines.push('');
  lines.push('\u56db\u3001\u4ece\u6dd8\u5b9d\u6570\u636e\u96c6\u7b5b\u9009\u7684\u8de8\u5e73\u53f0\u951a\u70b9\u5546\u54c1');
  for (const group of anchorGroups) {
    const counts = countBy(group.items, (item) => item.platform);
    lines.push(`${group.anchorIndex}. ${group.keyword} | ${group.anchorTitle}`);
    lines.push(`   Platforms: ${formatObject(counts)}`);
    lines.push(`   Similarity coverage: ${formatAnchorCoverage(group.similarityCoverage)}`);
  }
  lines.push('');
  lines.push('\u4e94\u3001\u8bf4\u660e');
  lines.push(
    `- Taobao anchors require high-similarity model coverage in at least ${minAnchorPlatforms} of jd/vipshop/suning/xianyu. Generic keyword-only matches are not counted.`,
  );
  lines.push(
    '- Files in this folder are local preparation artifacts only; no upload was run and no backend environment variable was changed.',
  );
  lines.push('- Future upload intent: 480p image processing plus hybrid embeddings.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function toImportItem(item) {
  const {
    keyword,
    _meta,
    ...payload
  } = item;
  const rawPayload = removeEmpty({
    ...(payload.rawPayload ?? {}),
    testDataset: removeEmpty({
      keyword,
      sourceKind: _meta.sourceKind,
      sourceFile: _meta.sourceFile,
      rowIndex: _meta.rowIndex,
      matchReason: _meta.matchReason,
      sharedModelTerms: _meta.sharedModelTerms,
    }),
  });
  return removeEmpty({
    ...payload,
    rawPayload,
  });
}

function firstField(row, aliases) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizeTitle(value) {
  const text = cleanString(value);
  if (!text) return null;
  return text.replace(/\s+/g, ' ').trim();
}

function normalizePrice(value) {
  const text = cleanString(value);
  if (!text) return null;
  const normalized = text
    .replace(/[,\s]/g, '')
    .replace(/\u00a5|rmb|RMB|\u5143|\u5230\u624b\u4ef7/g, '')
    .replace(/\.(?=\s|$)/g, '');
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
}

function normalizeUrl(value) {
  const text = cleanString(value);
  if (!text) return null;
  if (text.startsWith('//')) return `https:${text}`;
  if (/^https?:\/\//i.test(text)) return text;
  return null;
}

function synthesizeProductUrl({ platform, title, imageUrl, shopName }) {
  const hash = shortHash(`${platform}|${title}|${imageUrl}|${shopName ?? ''}`);
  if (platform === 'jd') return `https://item.jd.com/local-${hash}.html`;
  if (platform === 'taobao') return `https://item.taobao.com/item.htm?id=local-${hash}`;
  if (platform === 'vipshop') return `https://detail.vip.com/local-${hash}.html`;
  if (platform === 'suning') return `https://product.suning.com/local/${hash}.html`;
  if (platform === 'xianyu') return `https://www.goofish.com/item?id=local-${hash}`;
  return `https://local.product/${platform}/${hash}`;
}

function extractExternalIds(platform, productUrl) {
  try {
    const url = new URL(productUrl);
    if (platform === 'taobao' || platform === 'tmall') {
      return { externalId: url.searchParams.get('id') ?? url.searchParams.get('item_id') };
    }
    if (platform === 'xianyu') {
      return { externalId: url.searchParams.get('id') ?? null };
    }
    if (platform === 'jd') {
      const match = url.pathname.match(/\/(?:local-)?([A-Za-z0-9_-]+)\.html/i);
      return { externalId: match?.[1] ?? null };
    }
    if (platform === 'vipshop') {
      const match = url.pathname.match(/detail-\d+-([A-Za-z0-9_-]+)\.html/i);
      return { externalId: match?.[1] ?? null };
    }
    if (platform === 'suning') {
      const parts = url.pathname.split('/').filter(Boolean);
      const last = parts.at(-1)?.replace(/\.html$/i, '');
      return { externalId: last ?? null };
    }
  } catch {
    return {};
  }
  return {};
}

function canonicalProductUrl(platform, externalId, productUrl) {
  if (!externalId || externalId.startsWith('hash-')) return productUrl;
  if (platform === 'jd' && /^[0-9]+$/.test(externalId)) return `https://item.jd.com/${externalId}.html`;
  if ((platform === 'taobao' || platform === 'tmall') && /^[0-9]+$/.test(externalId)) {
    return `https://item.taobao.com/item.htm?id=${externalId}`;
  }
  if (platform === 'xianyu' && /^[0-9]+$/.test(externalId)) {
    return `https://www.goofish.com/item?id=${externalId}`;
  }
  return productUrl;
}

function isUsefulExternalId(value) {
  if (!value) return false;
  return !['0', '-', 'null', 'undefined'].includes(String(value).trim().toLowerCase());
}

function normalizeShopType(shopName, platform) {
  const text = normalizeMatchText(shopName ?? '');
  if (!text) return undefined;
  if (platform === 'jd' && text.includes('\u4eac\u4e1c\u81ea\u8425')) return 'self_operated';
  if (text.includes('\u81ea\u8425')) return 'self_operated';
  if (text.includes('\u65d7\u8230')) return 'flagship';
  if (text.includes('\u5b98\u65b9')) return 'official';
  return undefined;
}

function inferCategory(text) {
  const normalized = normalizeMatchText(text);
  if (containsAny(normalized, ['\u8dd1\u6b65\u978b', '\u8fd0\u52a8\u978b', '\u5973\u978b', '\u7537\u978b', '\u5b66\u751f\u978b', '\u978b', 'shoe', 'sneaker'])) return 'shoe';
  if (containsAny(normalized, ['iphone', '\u624b\u673a', 'smartphone', 'pura', 'mate'])) return 'phone';
  if (containsAny(normalized, ['watch', '\u624b\u8868'])) return 'watch';
  if (containsAny(normalized, ['\u7b14\u8bb0\u672c', '\u7535\u8111', '\u53f0\u5f0f\u673a', 'thinkpad', 'macbook', 'laptop', 'notebook'])) return 'computer';
  if (containsAny(normalized, ['\u5e73\u677f', 'ipad', 'pad', 'tablet'])) return 'tablet';
  if (containsAny(normalized, ['\u8033\u673a', '\u97f3\u7bb1', 'airpods', 'earbuds', 'headphone', 'speaker', 'jbl', 'bose'])) return 'audio';
  if (containsAny(normalized, ['\u76f8\u673a', '\u955c\u5934', 'camera', 'nikon', 'canon', 'sony', 'gopro'])) return 'camera';
  if (containsAny(normalized, ['\u7a7a\u8c03', '\u51b0\u7bb1', '\u6d17\u8863\u673a', '\u70ed\u6c34\u5668', '\u7535\u996d\u7172', '\u5bb6\u7535'])) return 'home_appliance';
  return 'general';
}

function inferBrand(text) {
  const normalized = normalizeMatchText(text);
  for (const [brand, terms] of BRAND_ALIASES) {
    if (terms.some((term) => normalized.includes(term))) return brand;
  }
  return null;
}

function brandKey(value) {
  const brand = inferBrand(value ?? '') ?? value;
  const normalized = normalizeMatchText(brand ?? '');
  if (!normalized) return null;
  if (normalized.includes('nike') || normalized.includes('\u8010\u514b')) return 'nike';
  if (normalized.includes('adidas') || normalized.includes('\u963f\u8fea')) return 'adidas';
  if (normalized.includes('puma') || normalized.includes('\u5f6a\u9a6c')) return 'puma';
  if (
    normalized.includes('new balance') ||
    normalized === 'nb' ||
    normalized.includes('\u65b0\u767e\u4f26')
  ) {
    return 'new_balance';
  }
  return normalized.replace(/\s+/g, '_');
}

function isDigitalCategory(category) {
  return ['phone', 'watch', 'computer', 'tablet', 'audio', 'camera'].includes(category);
}

function containsAny(text, terms) {
  return terms.some((term) => text.includes(normalizeMatchText(term)));
}

function normalizeMatchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function tokenArray(text) {
  const normalized = normalizeMatchText(text);
  if (!normalized) return [];
  const pieces = normalized.split(/\s+/).filter(Boolean);
  const tokens = new Set();
  for (const piece of pieces) {
    if (piece.length >= 2) tokens.add(piece);
    for (const normalizedTerm of NORMALIZED_MATCH_TERMS) {
      if (normalizedTerm && piece.includes(normalizedTerm)) tokens.add(normalizedTerm);
    }
  }
  for (const term of knownTerms(text)) tokens.add(normalizeMatchText(term));
  for (const token of modelTokens(text)) tokens.add(token);
  return [...tokens].filter((token) => token && token.length >= 2);
}

function modelTokens(text) {
  const normalized = normalizeMatchText(text);
  const tokens = new Set();
  for (const match of normalized.matchAll(/[a-z]+[a-z0-9-]*\d+[a-z0-9-]*/g)) tokens.add(match[0]);
  for (const match of normalized.matchAll(/\d+[a-z]+[a-z0-9-]*/g)) tokens.add(match[0]);
  for (const match of normalized.matchAll(/\b\d{2,6}\b/g)) tokens.add(match[0]);
  return [...tokens].filter(isUsefulModelToken);
}

function knownTerms(text) {
  const normalized = normalizeMatchText(text);
  return NORMALIZED_MATCH_TERMS.filter((term) => normalized.includes(term));
}

function productModelTerms(text) {
  const normalized = normalizeMatchText(text);
  const terms = new Set(modelTokens(text));
  for (const normalizedTerm of NORMALIZED_MODEL_TERMS) {
    if (normalizedTerm && normalized.includes(normalizedTerm)) terms.add(normalizedTerm);
  }
  return [...terms].filter((term) => term && !GENERIC_MATCH_TOKENS.has(term));
}

function specificTokens(text) {
  return tokenArray(text)
    .filter((token) => token.length >= 3)
    .filter((token) => !GENERIC_MATCH_TOKENS.has(token))
    .filter((token) => !/^\d{2}$/.test(token));
}

function isUsefulModelToken(token) {
  if (!token) return false;
  if (['2023', '2024', '2025', '2026', '618'].includes(token)) return false;
  if (/^\d{2}$/.test(token)) {
    const numeric = Number(token);
    if (numeric >= 20 && numeric <= 49) return false;
  }
  return token.length >= 3;
}

function dedupeItems(items) {
  return dedupeBy(items, itemKey);
}

function itemKey(item) {
  return `${item.platform}:${item.externalId ?? shortHash(`${item.title}|${item.imageUrl ?? ''}`)}`;
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function groupBy(items, keyFn) {
  const result = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(item);
  }
  return result;
}

function countBy(items, keyFn) {
  const result = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

function countByObject(items, keyFn) {
  return Object.fromEntries(
    [...countBy(items, keyFn).entries()].sort((left, right) =>
      String(left[0]).localeCompare(String(right[0]), 'zh-Hans-CN'),
    ),
  );
}

function formatObject(value) {
  if (value instanceof Map) value = Object.fromEntries(value);
  return Object.entries(value)
    .sort((left, right) => left[0].localeCompare(right[0], 'zh-Hans-CN'))
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');
}

function formatAnchorCoverage(coverage) {
  return ANCHOR_MATCH_PLATFORMS.map((platform) => {
    const count = coverage[platform]?.highSimilarityCount ?? 0;
    return `${platform}=${count}`;
  }).join(', ');
}

function removeEmpty(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === undefined || inner === null || inner === '') continue;
    if (typeof inner === 'object' && !Array.isArray(inner)) {
      const cleaned = removeEmpty(inner);
      if (cleaned && Object.keys(cleaned).length > 0) result[key] = cleaned;
      continue;
    }
    result[key] = inner;
  }
  return result;
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function dateStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}
