#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const FIELD_ALIASES = {
  keyword: [
    '\u5173\u952e\u8bcd',
    'keyword',
    'searchKeyword',
    '\u641c\u7d22\u8bcd',
  ],
  title: [
    '\u4ea7\u54c1\u540d\u79f0',
    '\u5546\u54c1\u540d\u79f0',
    '\u5546\u54c1',
    '\u6807\u9898',
    '\u5546\u54c1\u6807\u9898',
    'title',
    'productTitle',
    'name',
  ],
  price: [
    '\u4ea7\u54c1\u4ef7\u683c',
    '\u5546\u54c1\u4ef7\u683c',
    '\u73b0\u4ef7',
    '\u4ef7\u683c',
    '\u6298\u540e\u4ef7',
    '\u5238\u540e\u4ef7',
    '\u539f\u4ef7',
    'price',
    'salePrice',
  ],
  productUrl: [
    '\u5546\u54c1\u94fe\u63a5',
    '\u8be6\u60c5\u94fe\u63a5',
    '\u8be6\u60c5\u9875\u94fe\u63a5',
    '\u94fe\u63a5',
    'productUrl',
    'itemUrl',
    'detailUrl',
    'url',
  ],
  imageUrl: [
    '\u56fe\u7247\u5730\u5740',
    '\u5546\u54c1\u56fe\u7247',
    '\u5217\u8868\u9875\u56fe\u7247\u94fe\u63a5',
    '\u4e3b\u56fe',
    'imageUrl',
    'coverImageUrl',
    'picUrl',
    'imgUrl',
  ],
  shopName: [
    '\u5e97\u94fa\u540d\u79f0',
    '\u5e97\u94fa',
    '\u662f\u5426\u81ea\u8425',
    'shopName',
    'storeName',
    'sellerName',
  ],
  shopUrl: [
    '\u5e97\u94fa\u94fe\u63a5',
    'shopUrl',
    'storeUrl',
    'sellerUrl',
  ],
  externalId: [
    '\u5546\u54c1id',
    '\u5546\u54c1ID',
    '\u5546\u54c1\u7f16\u53f7',
    'productId',
    'itemId',
    'id',
    'skuId',
  ],
  pageUrl: [
    '\u5f53\u524d\u9875\u9762\u7f51\u5740',
    '\u9875\u9762\u7f51\u5740',
    'pageUrl',
    'sourcePageUrl',
  ],
  capturedAt: [
    '\u5f53\u524d\u65f6\u95f4',
    '\u91c7\u96c6\u65f6\u95f4',
    'capturedAt',
    'crawlTime',
  ],
  pageNo: [
    '\u9875\u7801',
    '\u5f53\u524d\u9875\u7801',
    'pageNo',
    'page',
  ],
  salesText: [
    '\u4ed8\u6b3e\u4eba\u6570',
    '\u9500\u91cf',
    '\u8bc4\u4ef7\u6570',
    '\u60f3\u8981\u4eba\u6570',
    'paidCountText',
    'salesText',
  ],
  location: [
    '\u5730\u7406\u4f4d\u7f6e',
    '\u53d1\u8d27\u5730',
    '\u5356\u5bb6IP\u5730\u5740',
    'geoLocation',
    'location',
  ],
};

const BRAND_ALIASES = [
  ['Nike', ['nike', '\u8010\u514b']],
  ['Air Jordan', ['air jordan', 'jordan', '\u4e54\u4e39']],
  ['adidas', ['adidas', '\u963f\u8fea\u8fbe\u65af', '\u4e09\u53f6\u8349']],
  ['PUMA', ['puma', '\u5f6a\u9a6c']],
  ['FILA', ['fila', '\u6590\u4e50']],
  ['New Balance', ['new balance', 'nb']],
  ['Skechers', ['skechers', '\u65af\u51ef\u5947']],
  ['ASICS', ['asics', '\u4e9a\u745f\u58eb']],
  ['Converse', ['converse', '\u5321\u5a01']],
  ['Vans', ['vans']],
  ['Reebok', ['reebok', '\u9510\u6b65']],
  ['Under Armour', ['under armour', '\u5b89\u5fb7\u739b']],
  ['HOKA', ['hoka']],
  ['On', ['on running', '\u6602\u8dd1']],
  ['Saucony', ['saucony', '\u7d22\u5eb7\u5c3c']],
  ['Salomon', ['salomon', '\u8428\u6d1b\u8499']],
  ['ANTA', ['anta', '\u5b89\u8e0f']],
  ['Li-Ning', ['li-ning', 'lining', '\u674e\u5b81']],
  ['Xtep', ['xtep', '\u7279\u6b65']],
  ['361 Degrees', ['361', '361\u5ea6']],
  ['PEAK', ['peak', '\u5339\u514b']],
  ['ERKE', ['erke', '\u9e3f\u661f\u5c14\u514b']],
  ['Warrior', ['warrior', '\u56de\u529b']],
  ['Feiyue', ['feiyue', '\u98de\u8dc3']],
  ['Jack Jones', ['jack jones']],
  ['Calvin Klein', ['calvin klein', 'ck jeans']],
  ['Baleno', ['baleno', '\u73ed\u5c3c\u8def']],
  ['Dickies', ['dickies']],
  ['JBL', ['jbl']],
  ['Yili', ['yili', '\u4f0a\u5229']],
];

const args = parseArgs(process.argv.slice(2));
const batchSource = args.batchSource ?? `local_collected_products_${dateStamp()}`;
const firstLimit = parsePositiveInteger(args.limit) ?? 80;
const maxItems = parsePositiveInteger(args.maxItems);
const inputPaths = await resolveInputPaths(args);

if (inputPaths.length === 0) {
  throw new Error('No JSON, JSONL, CSV, XLS, or XLSX input files found.');
}

const outFullPath = path.resolve(
  args.outFull ?? `samples/product-pool/generated/${batchSource}-full.json`,
);
const outFirstPath = path.resolve(
  args.outFirst ?? `samples/product-pool/generated/${batchSource}-first${firstLimit}.json`,
);
const outRejectedPath = path.resolve(
  args.outRejected ?? `samples/product-pool/generated/${batchSource}-rejected.jsonl`,
);
const outReportPath = path.resolve(
  args.outReport ?? `samples/product-pool/generated/${batchSource}-normalize-report.json`,
);

const selectedPlatforms = parseCsvSet(args.platform);
const seen = new Map();
const items = [];
const rejections = [];
const stats = {
  inputFiles: inputPaths.length,
  rawCount: 0,
  validCount: 0,
  dedupedCount: 0,
  duplicateCount: 0,
  droppedCount: 0,
  platformCounts: {},
  categoryCounts: {},
  sourceFileCounts: {},
  missingCounts: {
    title: 0,
    price: 0,
    productUrl: 0,
    imageUrl: 0,
  },
};

inputFiles:
for (const inputPath of inputPaths) {
  const rows = await readInputRows(inputPath);
  const sourceFile = path.basename(inputPath);
  stats.sourceFileCounts[sourceFile] = {
    rawCount: rows.length,
    acceptedCount: 0,
    rejectedCount: 0,
  };
  stats.rawCount += rows.length;

  for (const [rowIndex, row] of rows.entries()) {
    const normalized = normalizeRow(row, {
      inputPath,
      sourceFile,
      rowIndex,
      batchSource,
      includeOriginal: args.includeOriginal === true,
      sourceTags: args.sourceTags !== false,
    });

    if (!normalized.item) {
      reject(sourceFile, rowIndex, normalized.reason, normalized.detail);
      continue;
    }

    if (selectedPlatforms && !selectedPlatforms.has(normalized.item.platform)) {
      reject(sourceFile, rowIndex, 'platform_filtered', {
        platform: normalized.item.platform,
      });
      continue;
    }

    if (args.onlyShoes && normalized.category !== 'shoe') {
      reject(sourceFile, rowIndex, 'category_filtered', {
        category: normalized.category,
        title: normalized.item.title,
      });
      continue;
    }

    stats.validCount += 1;
    const dedupeKey = `${normalized.item.platform}:${normalized.item.externalId}`;
    const previous = seen.get(dedupeKey);
    if (previous) {
      stats.duplicateCount += 1;
      reject(sourceFile, rowIndex, 'duplicate_product', {
        dedupeKey,
        duplicateOf: previous,
        title: normalized.item.title,
      });
      continue;
    }

    seen.set(dedupeKey, { sourceFile, rowIndex });
    items.push(normalized.item);
    stats.sourceFileCounts[sourceFile].acceptedCount += 1;
    increment(stats.platformCounts, normalized.item.platform);
    increment(stats.categoryCounts, normalized.category);

    if (maxItems && items.length >= maxItems) {
      break inputFiles;
    }
  }
}

stats.dedupedCount = items.length;
stats.droppedCount = rejections.length - stats.duplicateCount;

const fullPayload = {
  batchSource,
  items,
};
const firstPayload = {
  batchSource: `${batchSource}_first${Math.min(firstLimit, items.length)}`,
  items: items.slice(0, firstLimit),
};
const report = {
  batchSource,
  generatedAt: new Date().toISOString(),
  inputPaths,
  outFullPath,
  outFirstPath,
  outRejectedPath,
  outReportPath,
  options: {
    onlyShoes: args.onlyShoes === true,
    platform: args.platform ?? null,
    firstLimit,
    maxItems: maxItems ?? null,
    sourceTags: args.sourceTags !== false,
    includeOriginal: args.includeOriginal === true,
    dryRun: args.dryRun === true,
  },
  stats: {
    ...stats,
    firstBatchCount: firstPayload.items.length,
    outputBytes: {
      full: estimateJsonBytes(fullPayload),
      first: estimateJsonBytes(firstPayload),
      rejected: Buffer.byteLength(
        rejections.map((entry) => JSON.stringify(entry)).join('\n'),
        'utf8',
      ),
    },
  },
};

if (args.dryRun !== true) {
  await mkdir(path.dirname(outFullPath), { recursive: true });
  await mkdir(path.dirname(outFirstPath), { recursive: true });
  await mkdir(path.dirname(outRejectedPath), { recursive: true });
  await mkdir(path.dirname(outReportPath), { recursive: true });
  await writeFile(outFullPath, `${JSON.stringify(fullPayload, null, 2)}\n`, 'utf8');
  await writeFile(outFirstPath, `${JSON.stringify(firstPayload, null, 2)}\n`, 'utf8');
  await writeFile(
    outRejectedPath,
    rejections.length > 0
      ? `${rejections.map((entry) => JSON.stringify(entry)).join('\n')}\n`
      : '',
    'utf8',
  );
  await writeFile(outReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(report, null, 2));

function normalizeRow(row, options) {
  if (!isRecord(row)) {
    return { item: null, reason: 'row_not_object' };
  }

  const detectedPlatform = detectPlatform({
    fileName: options.sourceFile,
    productUrl: cleanString(firstField(row, FIELD_ALIASES.productUrl)),
    pageUrl: cleanString(firstField(row, FIELD_ALIASES.pageUrl)),
  });
  const platform = normalizeForcedPlatform(args.forcePlatform) ?? detectedPlatform;
  const keyword =
    cleanString(firstField(row, FIELD_ALIASES.keyword)) ??
    (platform === 'jd' ? cleanString(row.column1) : null);
  const rawTitle =
    cleanString(firstField(row, FIELD_ALIASES.title)) ??
    (platform === 'jd' ? cleanString(row.column2) : null);
  const title = normalizeTitle(rawTitle);
  const rawProductUrl = normalizeUrl(firstField(row, FIELD_ALIASES.productUrl));
  const rawImageUrl =
    normalizeUrl(firstField(row, FIELD_ALIASES.imageUrl)) ??
    (platform === 'jd' ? normalizeUrl(row.column4) : null);
  const rawShopName =
    normalizeTitle(firstField(row, FIELD_ALIASES.shopName)) ??
    (platform === 'jd' ? normalizeTitle(row.column5) : null);
  const productUrl =
    rawProductUrl ??
    synthesizeProductUrl({
      platform,
      title,
      imageUrl: rawImageUrl,
      shopName: rawShopName,
    });
  const price =
    normalizePrice(selectPrice(row, platform)) ??
    (platform === 'jd' ? normalizePrice(row.column3) : null);
  const imageUrl = rawImageUrl;
  const shopName = rawShopName;
  const shopUrl = normalizeUrl(firstField(row, FIELD_ALIASES.shopUrl));
  const pageUrl = normalizeUrl(firstField(row, FIELD_ALIASES.pageUrl));
  const capturedAt = cleanString(firstField(row, FIELD_ALIASES.capturedAt));
  const pageNo = cleanString(firstField(row, FIELD_ALIASES.pageNo));
  const salesText =
    cleanString(firstField(row, FIELD_ALIASES.salesText)) ??
    (platform === 'jd' ? cleanString(row.column7) : null);
  const location = cleanString(firstField(row, FIELD_ALIASES.location));
  const exportedProductId = cleanString(firstField(row, FIELD_ALIASES.externalId));

  const missing = [];
  if (!title) missing.push('title');
  if (!price) missing.push('price');
  if (!productUrl) missing.push('productUrl');
  if (!imageUrl) missing.push('imageUrl');
  for (const key of missing) stats.missingCounts[key] += 1;
  if (missing.length > 0) {
    return {
      item: null,
      reason: 'missing_required_field',
      detail: {
        missing,
        title,
        productUrlHash: productUrl ? shortHash(productUrl) : null,
      },
    };
  }

  const ids = extractExternalIds(platform, productUrl);
  const externalId =
    ids.externalId ??
    (isUsefulExternalId(exportedProductId) ? exportedProductId : null) ??
    `hash-${shortHash(`${platform}|${productUrl}|${imageUrl}|${title}|${price}`)}`;
  const category = inferCategory(title);
  const brandHint = inferBrand(`${title} ${shopName ?? ''}`) ?? undefined;
  const canonicalUrl = canonicalProductUrl(platform, externalId, productUrl);

  const rawPayload = removeEmpty({
    source: 'local_collected_product_data',
    batchSource: options.batchSource,
    sourceFile: options.sourceFile,
    originalRowIndex: options.rowIndex,
    keyword,
    shopName,
    shopUrlHash: shopUrl ? shortHash(shopUrl) : null,
    geoLocation: location,
    salesText,
    pageUrl,
    capturedAt,
    pageNo,
    exportedProductId,
    itemId: ids.externalId ?? null,
    skuId: ids.skuId ?? null,
    rawProductUrlHash: shortHash(productUrl),
    rawImageUrlHash: shortHash(imageUrl),
    attributes:
      options.sourceTags === true
        ? removeEmpty({
            category,
            brand: brandHint,
            modelLine: inferModelLine(title, brandHint),
            shoeType: category === 'shoe' ? inferShoeType(title) : null,
            jdAttributes: platform === 'jd' ? cleanString(row.column6) : null,
            jdServiceTags: platform === 'jd' ? cleanString(row.column8) : null,
            jdPromotionTag: platform === 'jd' ? cleanString(row.column9) : null,
          })
        : null,
    ...(options.includeOriginal ? { original: row } : {}),
  });

  return {
    item: removeEmpty({
      externalId,
      platform,
      title,
      price,
      currency: 'CNY',
      stockStatus: 'in_stock',
      shopName,
      shopType: normalizeShopType(shopName, platform),
      productUrl: canonicalUrl,
      imageUrl,
      brandHint,
      categoryHint: category,
      rawPayload,
    }),
    category,
  };
}

function reject(sourceFile, rowIndex, reason, detail = {}) {
  stats.sourceFileCounts[sourceFile].rejectedCount += 1;
  rejections.push({
    sourceFile,
    rowIndex,
    reason,
    ...detail,
  });
}

async function resolveInputPaths(parsedArgs) {
  const explicitFiles = parsedArgs.files ?? [];
  if (explicitFiles.length > 0) {
    return explicitFiles.map((file) => path.resolve(file));
  }

  const dir = path.resolve(parsedArgs.dir ?? '../data');
  const entries = await readdir(dir);
  const paths = [];
  for (const entry of entries.sort()) {
    const fullPath = path.join(dir, entry);
    const info = await stat(fullPath);
    if (!info.isFile()) continue;
    if (/\.(json|jsonl|csv|xlsx|xls)$/i.test(entry)) paths.push(fullPath);
  }
  return paths;
}

async function readInputRows(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.json' || ext === '.jsonl') {
    const text = await readFile(inputPath, 'utf8');
    return parseInputRows(text);
  }
  if (ext === '.csv' || ext === '.xlsx' || ext === '.xls') {
    return readTabularRows(inputPath);
  }
  throw new Error(`Unsupported input file type: ${inputPath}`);
}

async function readTabularRows(inputPath) {
  const python = await resolvePythonCommand();
  const helperPath = path.join(SCRIPT_DIR, 'read-tabular-product-data.py');

  try {
    const { stdout } = await execFileAsync(python, [helperPath, inputPath], {
      cwd: path.resolve(SCRIPT_DIR, '..'),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 1024 * 1024 * 1024,
      windowsHide: true,
    });
    const rows = JSON.parse(stdout);
    if (!Array.isArray(rows)) {
      throw new Error('tabular helper returned a non-array payload');
    }
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read tabular file ${inputPath}: ${message}`);
  }
}

async function resolvePythonCommand() {
  const explicit = cleanString(args.python) ?? cleanString(process.env.PRODUCT_DATA_PYTHON);
  if (explicit) return explicit;

  const homeDir = process.env.USERPROFILE ?? process.env.HOME;
  const candidates = [
    homeDir
      ? path.join(
          homeDir,
          '.cache',
          'codex-runtimes',
          'codex-primary-runtime',
          'dependencies',
          'python',
          'python.exe',
        )
      : null,
    path.resolve('services/image-worker/.venv/Scripts/python.exe'),
    'python',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'python') return candidate;
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // Try the next known Python location.
    }
  }

  return 'python';
}

function parseInputRows(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed)) {
      for (const key of ['items', 'products', 'data', 'list', 'rows']) {
        if (Array.isArray(parsed[key])) return parsed[key];
      }
    }
    throw new Error('JSON input must be an array or contain items/products/data/list/rows.');
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function firstField(row, aliases) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function selectPrice(row, platform) {
  if (platform !== 'vipshop') return firstField(row, FIELD_ALIASES.price);

  const values = [
    row['\u6298\u540e\u4ef7'],
    row['\u73b0\u4ef7'],
    row['\u4ef7\u683c'],
    row['\u539f\u4ef7'],
  ]
    .map((value) => normalizePrice(value))
    .filter(Boolean)
    .map(Number);

  if (values.length > 0) return String(Math.min(...values));
  return firstField(row, FIELD_ALIASES.price);
}

function detectPlatform({ fileName, productUrl, pageUrl }) {
  const text = `${fileName} ${productUrl ?? ''} ${pageUrl ?? ''}`.toLowerCase();
  if (text.includes('jd.com') || text.includes('360buyimg') || text.includes('\u4eac\u4e1c')) {
    return 'jd';
  }
  if (text.includes('suning') || text.includes('\u82cf\u5b81')) return 'suning';
  if (text.includes('vip.com') || text.includes('vipshop') || text.includes('\u552f\u54c1')) {
    return 'vipshop';
  }
  if (text.includes('goofish') || text.includes('xianyu') || text.includes('\u95f2\u9c7c')) {
    return 'xianyu';
  }
  if (text.includes('tmall.com')) return 'tmall';
  if (text.includes('taobao') || text.includes('simba.taobao')) return 'taobao';
  return 'manual';
}

function normalizeForcedPlatform(value) {
  const platform = cleanString(value)?.toLowerCase();
  if (!platform) return null;
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
  if (!supported.has(platform)) {
    throw new Error(`Unsupported forced platform: ${value}`);
  }
  return platform;
}

function synthesizeProductUrl({ platform, title, imageUrl, shopName }) {
  if (platform !== 'jd') return null;
  if (!title || !imageUrl) return null;
  return `https://item.jd.com/local-${shortHash(`${title}|${imageUrl}|${shopName ?? ''}`)}.html`;
}

function extractExternalIds(platform, productUrl) {
  const params = extractParams(productUrl);
  const paramId = cleanString(params.id ?? params.itemId);
  const skuId = cleanString(params.skuId);
  if (paramId) return { externalId: paramId, skuId };

  if (platform === 'suning') {
    const match = productUrl.match(/product\.suning\.com\/([^/]+)\/(\d+)\.html/i);
    if (match) return { externalId: match[2], skuId: null };
  }

  if (platform === 'vipshop') {
    const match = productUrl.match(/detail-(\d+)-(\d+)\.html/i);
    if (match) return { externalId: match[2], skuId: null };
  }

  if (platform === 'xianyu') {
    const id = cleanString(params.id);
    if (id) return { externalId: id, skuId: null };
  }

  return { externalId: null, skuId };
}

function extractParams(value) {
  const params = {};
  try {
    const normalized = value.startsWith('//') ? `https:${value}` : value;
    const url = new URL(normalized);
    for (const [key, val] of url.searchParams.entries()) params[key] = val;
  } catch {
    for (const match of String(value ?? '').matchAll(/[?&]([^=&#]+)=([^&#]+)/g)) {
      params[decodeURIComponentSafe(match[1])] = decodeURIComponentSafe(match[2]);
    }
  }
  return params;
}

function canonicalProductUrl(platform, externalId, fallbackUrl) {
  if (/^\d{8,20}$/.test(externalId)) {
    if (platform === 'tmall') return `https://detail.tmall.com/item.htm?id=${externalId}`;
    if (platform === 'taobao') return `https://item.taobao.com/item.htm?id=${externalId}`;
  }
  return fallbackUrl;
}

function normalizeTitle(value) {
  const text = cleanString(value);
  if (!text) return null;
  return text.replace(/\s+/g, ' ').trim();
}

function normalizePrice(value) {
  const text = cleanString(value);
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  return Number(match[0]).toFixed(2);
}

function normalizeUrl(value) {
  const text = cleanString(value);
  if (!text) return null;
  if (text.startsWith('//')) return `https:${text}`;
  return text;
}

function normalizeShopType(shopName, platform) {
  const text = `${shopName ?? ''}`.toLowerCase();
  if (platform === 'suning' && (text.includes('\u81ea\u8425') || text.includes('suning'))) {
    return 'official';
  }
  if (text.includes('\u5b98\u65b9') || text.includes('\u65d7\u8230')) return 'official';
  if (platform === 'xianyu') return 'individual';
  return undefined;
}

function inferBrand(text) {
  const normalized = text.toLowerCase();
  for (const [brand, aliases] of BRAND_ALIASES) {
    if (aliases.some((alias) => normalized.includes(alias.toLowerCase()))) return brand;
  }
  return null;
}

function inferCategory(text) {
  const normalized = text.toLowerCase();
  if (/[\u978b\u9774]/u.test(normalized) || /\b(shoe|shoes|sneaker|sneakers|boot|boots|sandal|sandals|slipper|slippers)\b/.test(normalized)) {
    return 'shoe';
  }
  if (/[\u8863\u88e4\u88d9\u889c\u5e3d]/u.test(normalized) || /\b(t-shirt|shirt|jacket|coat|jeans|pants|shorts|dress|hoodie)\b/.test(normalized)) {
    return 'apparel';
  }
  if (/[\u725b\u5976\u5976\u7c89\u98df\u54c1]/u.test(normalized)) return 'food';
  if (/[\u76f8\u673a\u5355\u53cd\u5fae\u5355]/u.test(normalized) || /\b(camera|dslr|mirrorless)\b/.test(normalized)) return 'camera';
  if (/[\u8033\u673a\u8033\u9ea6\u5934\u6234]/u.test(normalized) || /\b(headphones?|earphones?|earbuds?|headset)\b/.test(normalized)) return 'headphones';
  if (/(?:\u667a\u80fd)?\u624b\u8868|\u7535\u5b50\u8868|apple\s*watch|iwatch|\b(smartwatch|smart\s*watch|watch)\b/u.test(normalized)) return 'smartwatch';
  if (/\u624b\u673a|iphone|android|huawei|xiaomi|\b(smartphone|mobile\s*phone|cellphone|phone)\b/u.test(normalized)) return 'phone';
  if (/ipad|\u5e73\u677f(?:\u7535\u8111)?|\b(tablet|pad)\b/u.test(normalized)) return 'tablet';
  if (/\u952e\u76d8|\b(mechanical\s*keyboard|keyboard)\b/u.test(normalized)) return 'keyboard';
  if (/\u9f20\u6807|\b(wireless\s*mouse|computer\s*mouse|mouse)\b/u.test(normalized)) return 'mouse';
  if (/\u7b14\u8bb0\u672c(?:\u7535\u8111)?|\u7535\u8111|\u53f0\u5f0f\u673a|\b(laptop|notebook|desktop|computer|pc)\b/u.test(normalized)) return 'computer';
  if (/[\u51b0\u7bb1\u6d17\u8863\u673a\u7a7a\u8c03\u7535\u89c6\u70ed\u6c34\u5668\u5438\u5c18\u5668]|\u5bb6\u7535|\u7535\u5668|\b(fridge|refrigerator|washer|washing\s*machine|air\s*conditioner|tv|television|microwave|appliance)\b/u.test(normalized)) return 'home_appliance';
  if (/[\u97f3\u7bb1\u6570\u7801\u7535\u5b50]/u.test(normalized) || /\b(jbl|speaker|electronics?|digital)\b/.test(normalized)) {
    return 'digital_other';
  }
  return 'general';
}

function inferShoeType(title) {
  const text = title.toLowerCase();
  if (text.includes('\u8dd1')) return 'running';
  if (text.includes('\u677f\u978b')) return 'skate';
  if (text.includes('\u7bee\u7403')) return 'basketball';
  if (text.includes('\u4f11\u95f2')) return 'casual';
  if (text.includes('\u51c9\u978b')) return 'sandal';
  if (text.includes('\u62d6\u978b')) return 'slipper';
  if (text.includes('\u9774')) return 'boot';
  return undefined;
}

function inferModelLine(title, brand) {
  if (!brand) return undefined;
  const text = title.replace(new RegExp(escapeRegExp(brand), 'ig'), '').trim();
  return text.length > 0 ? text.slice(0, 80) : undefined;
}

function isUsefulExternalId(value) {
  return Boolean(value && /^[A-Za-z0-9_-]{6,80}$/.test(value));
}

function removeEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null || entry === '') return false;
      if (isRecord(entry) && Object.keys(entry).length === 0) return false;
      return true;
    }),
  );
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function estimateJsonBytes(payload) {
  return Buffer.byteLength(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, 16);
}

function cleanString(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dateStamp() {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function parsePositiveInteger(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseCsvSet(value) {
  if (!value) return null;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? new Set(items) : null;
}

function parseArgs(argv) {
  const parsed = { files: [], sourceTags: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' || token === '-f') parsed.files.push(argv[++index]);
    else if (token === '--dir') parsed.dir = argv[++index];
    else if (token === '--out-full') parsed.outFull = argv[++index];
    else if (token === '--out-first') parsed.outFirst = argv[++index];
    else if (token === '--out-rejected') parsed.outRejected = argv[++index];
    else if (token === '--out-report') parsed.outReport = argv[++index];
    else if (token === '--batch-source') parsed.batchSource = argv[++index];
    else if (token === '--limit') parsed.limit = argv[++index];
    else if (token === '--platform') parsed.platform = argv[++index];
    else if (token === '--force-platform') parsed.forcePlatform = argv[++index];
    else if (token === '--python') parsed.python = argv[++index];
    else if (token === '--max-items') parsed.maxItems = argv[++index];
    else if (token === '--only-shoes') parsed.onlyShoes = true;
    else if (token === '--include-original') parsed.includeOriginal = true;
    else if (token === '--no-source-tags') parsed.sourceTags = false;
    else if (token === '--dry-run') parsed.dryRun = true;
    else if (!parsed.dir) parsed.dir = token;
  }
  if (parsed.files.length === 0) delete parsed.files;
  return parsed;
}
