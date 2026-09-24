#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

const FIELD_ALIASES = {
  keyword: ['关键词', 'keyword', 'searchKeyword', '搜索词'],
  shopName: ['店铺名称', 'shopName', 'storeName', 'sellerName'],
  shopUrl: ['店铺链接', 'shopUrl', 'storeUrl', 'sellerUrl'],
  geoLocation: ['地理位置', 'geoLocation', 'location', '发货地'],
  title: ['产品名称', '商品名称', 'title', 'productTitle', '商品标题'],
  price: ['产品价格', '商品价格', 'price', 'salePrice'],
  paidCountText: ['付款人数', 'paidCountText', 'salesText', '销量'],
  imageUrl: ['图片地址', '主图', 'imageUrl', 'coverImageUrl', 'picUrl'],
  productUrl: ['商品链接', 'productUrl', 'itemUrl', 'detailUrl', '链接'],
  exportedProductId: ['商品id', '商品ID', 'productId', 'itemId', 'id'],
  pageUrl: ['当前页面网址', 'pageUrl', 'sourcePageUrl'],
  capturedAt: ['当前时间', 'capturedAt', 'crawlTime', '采集时间'],
  pageNo: ['页码', 'pageNo', 'page'],
};

const BRAND_ALIASES = [
  ['Nike', ['nike', '耐克']],
  ['Air Jordan', ['air jordan', 'jordan', '乔丹']],
  ['adidas', ['adidas', '阿迪达斯', '三叶草']],
  ['FILA', ['fila', '斐乐']],
  ['New Balance', ['new balance', 'nb']],
  ['Skechers', ['skechers', '斯凯奇']],
  ['PUMA', ['puma', '彪马']],
  ['ASICS', ['asics', '亚瑟士']],
  ['Onitsuka Tiger', ['onitsuka tiger', '鬼塚虎', '鬼冢虎']],
  ['Mizuno', ['mizuno', '美津浓']],
  ['Converse', ['converse', '匡威']],
  ['Vans', ['vans']],
  ['Reebok', ['reebok', '锐步']],
  ['Under Armour', ['under armour', '安德玛']],
  ['HOKA', ['hoka']],
  ['On', ['on running', '昂跑']],
  ['Saucony', ['saucony', '索康尼']],
  ['Salomon', ['salomon', '萨洛蒙']],
  ['安踏', ['安踏', 'anta']],
  ['李宁', ['李宁']],
  ['特步', ['特步']],
  ['361度', ['361', '361度']],
  ['匹克', ['匹克']],
  ['鸿星尔克', ['鸿星尔克']],
  ['中乔体育', ['中乔']],
  ['回力', ['回力']],
  ['飞跃', ['飞跃']],
  ['百丽', ['百丽', 'belle']],
  ['思加图', ['思加图']],
  ['他她', ['他她']],
  ['百思图', ['百思图']],
  ['天美意', ['天美意']],
  ['达芙妮', ['达芙妮']],
  ['星期六', ['星期六']],
  ['接吻猫', ['接吻猫']],
  ['卓诗尼', ['卓诗尼']],
  ['热风', ['热风']],
  ['Crocs', ['crocs', '卡骆驰']],
  ['Birkenstock', ['birkenstock']],
  ['UGG', ['ugg']],
  ['Clarks', ['clarks']],
  ['ECCO', ['ecco']],
  ['暇步士', ['暇步士']],
  ['Timberland', ['timberland', '添柏岚']],
  ['Dr. Martens', ['dr. martens', 'dr martens', '马丁']],
  ['奥康', ['奥康']],
  ['红蜻蜓', ['红蜻蜓']],
  ['骆驼', ['骆驼', 'camel']],
  ['The North Face', ['the north face', '北面']],
  ['迪卡侬', ['迪卡侬', 'decathlon']],
];

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  printUsage();
  process.exit(1);
}

const inputPath = path.resolve(args.file);
const inputBaseName = sanitizeSlug(path.basename(inputPath, path.extname(inputPath)));
const batchSource = args.batchSource ?? `taobao_tmall_${inputBaseName}_${dateStamp()}`;
const firstLimit = parsePositiveInteger(args.limit) ?? 30;
const includeOriginal = args.includeOriginal === true;
const outFullPath = path.resolve(args.outFull ?? `samples/product-pool/generated/${batchSource}-full.json`);
const outFirstPath = path.resolve(
  args.outFirst ?? `samples/product-pool/generated/${batchSource}-first${firstLimit}.json`,
);
const outRejectedPath = path.resolve(args.outRejected ?? `samples/product-pool/generated/${batchSource}-rejected.jsonl`);
const outReportPath = path.resolve(args.outReport ?? `samples/product-pool/generated/${batchSource}-normalize-report.json`);

const rows = parseInputRows(await readFile(inputPath, 'utf8'));
const result = normalizeRows(rows, {
  batchSource,
  brandHint: cleanString(args.brandHint),
  includeOriginal,
  sourceLabel: cleanString(args.sourceLabel) ?? 'octoparse_taobao_tmall_list_page',
});

const fullPayload = {
  batchSource,
  items: result.items,
};
const firstPayload = {
  batchSource: `${batchSource}_first${firstLimit}`,
  items: result.items.slice(0, firstLimit),
};
const report = {
  inputPath,
  outFullPath,
  outFirstPath,
  outRejectedPath,
  batchSource,
  generatedAt: new Date().toISOString(),
  stats: {
    rawCount: rows.length,
    validCount: result.validCount,
    dedupedCount: result.items.length,
    firstBatchCount: firstPayload.items.length,
    rejectedCount: result.rejections.length,
    duplicateCount: result.duplicateCount,
    droppedCount: result.droppedCount,
    platformCounts: result.platformCounts,
    brandCounts: result.brandCounts,
    missingCounts: result.missingCounts,
    outputBytes: {
      full: estimateJsonBytes(fullPayload),
      first: estimateJsonBytes(firstPayload),
      rejected: Buffer.byteLength(result.rejections.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8'),
    },
  },
};

await mkdir(path.dirname(outFullPath), { recursive: true });
await mkdir(path.dirname(outFirstPath), { recursive: true });
await mkdir(path.dirname(outRejectedPath), { recursive: true });
await mkdir(path.dirname(outReportPath), { recursive: true });
await writeFile(outFullPath, `${JSON.stringify(fullPayload, null, 2)}\n`, 'utf8');
await writeFile(outFirstPath, `${JSON.stringify(firstPayload, null, 2)}\n`, 'utf8');
await writeFile(
  outRejectedPath,
  result.rejections.length > 0 ? `${result.rejections.map((entry) => JSON.stringify(entry)).join('\n')}\n` : '',
  'utf8',
);
await writeFile(outReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(report, null, 2));

function parseInputRows(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('JSON input must be an array.');
    return parsed;
  }

  const rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const value = line.trim();
    if (!value) continue;
    try {
      rows.push(JSON.parse(value));
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
    }
  }
  return rows;
}

function normalizeRows(rows, options) {
  const seen = new Map();
  const items = [];
  const rejections = [];
  const platformCounts = {};
  const brandCounts = {};
  const missingCounts = {
    title: 0,
    price: 0,
    imageUrl: 0,
    productUrl: 0,
    externalId: 0,
  };
  let validCount = 0;
  let duplicateCount = 0;
  let droppedCount = 0;

  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rejections.push({ rowIndex: index, reason: 'row_not_object' });
      droppedCount += 1;
      continue;
    }

    const extracted = extractRow(row);
    const missing = [];
    if (!extracted.title) missing.push('title');
    if (!extracted.price) missing.push('price');
    if (!extracted.imageUrl) missing.push('imageUrl');
    if (!extracted.productUrl) missing.push('productUrl');
    for (const key of missing) missingCounts[key] += 1;

    if (missing.length > 0) {
      rejections.push({
        rowIndex: index,
        reason: 'missing_required_field',
        missing,
        title: extracted.title,
        productUrlHash: extracted.productUrl ? shortHash(extracted.productUrl) : null,
      });
      droppedCount += 1;
      continue;
    }

    validCount += 1;

    const ids = extractIds(extracted.productUrl);
    const rowProductId = cleanString(extracted.exportedProductId);
    const externalId =
      ids.itemId ??
      (isLikelyItemId(rowProductId) ? rowProductId : null) ??
      `octoparse-${shortHash(`${extracted.productUrl}|${extracted.title}|${index}`)}`;
    const skuId = ids.skuId ?? (!isLikelyItemId(rowProductId) ? rowProductId : null);
    if (!externalId) missingCounts.externalId += 1;

    const platform = detectPlatform(extracted.productUrl);
    const productUrl = canonicalProductUrl(platform, externalId, extracted.productUrl);
    const dedupeKey = `${platform}:${externalId}`;
    const previousIndex = seen.get(dedupeKey);
    if (previousIndex !== undefined) {
      duplicateCount += 1;
      rejections.push({
        rowIndex: index,
        reason: 'duplicate_product',
        duplicateOfRowIndex: previousIndex,
        dedupeKey,
        title: extracted.title,
      });
      continue;
    }
    seen.set(dedupeKey, index);

    const brandHint =
      options.brandHint ??
      inferBrand(`${extracted.keyword ?? ''} ${extracted.title} ${extracted.shopName ?? ''}`) ??
      undefined;

    platformCounts[platform] = (platformCounts[platform] ?? 0) + 1;
    if (brandHint) brandCounts[brandHint] = (brandCounts[brandHint] ?? 0) + 1;

    const rawPayload = removeEmpty({
      source: options.sourceLabel,
      batchSource: options.batchSource,
      originalRowIndex: index,
      keyword: extracted.keyword,
      shopName: extracted.shopName,
      geoLocation: extracted.geoLocation,
      paidCountText: extracted.paidCountText,
      itemId: ids.itemId ?? externalId,
      skuId,
      exportedProductId: rowProductId,
      currentPageUrl: shortenSearchPageUrl(extracted.pageUrl),
      capturedAt: extracted.capturedAt,
      pageNo: extracted.pageNo,
      rawProductUrlHash: shortHash(extracted.productUrl),
      rawShopUrlHash: shortHash(extracted.shopUrl ?? ''),
      ...(options.includeOriginal ? { original: row } : {}),
    });

    items.push(
      removeEmpty({
        externalId,
        platform,
        title: extracted.title,
        price: extracted.price,
        currency: 'CNY',
        stockStatus: 'in_stock',
        shopName: extracted.shopName,
        productUrl,
        imageUrl: extracted.imageUrl,
        brandHint,
        rawPayload,
      }),
    );
  }

  return {
    items,
    rejections,
    validCount,
    platformCounts,
    brandCounts,
    missingCounts,
    duplicateCount,
    droppedCount,
  };
}

function extractRow(row) {
  const productUrl = cleanString(firstField(row, FIELD_ALIASES.productUrl));
  const imageUrl = normalizeImageUrl(firstField(row, FIELD_ALIASES.imageUrl));
  return {
    keyword: cleanString(firstField(row, FIELD_ALIASES.keyword)),
    shopName: cleanString(firstField(row, FIELD_ALIASES.shopName)),
    shopUrl: normalizeUrl(firstField(row, FIELD_ALIASES.shopUrl)),
    geoLocation: cleanString(firstField(row, FIELD_ALIASES.geoLocation)),
    title: cleanString(firstField(row, FIELD_ALIASES.title)),
    price: normalizePrice(firstField(row, FIELD_ALIASES.price)),
    paidCountText: cleanString(firstField(row, FIELD_ALIASES.paidCountText)),
    imageUrl,
    productUrl: normalizeUrl(productUrl),
    exportedProductId: cleanString(firstField(row, FIELD_ALIASES.exportedProductId)),
    pageUrl: normalizeUrl(firstField(row, FIELD_ALIASES.pageUrl)),
    capturedAt: cleanString(firstField(row, FIELD_ALIASES.capturedAt)),
    pageNo: cleanString(firstField(row, FIELD_ALIASES.pageNo)),
  };
}

function firstField(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== '') return row[alias];
  }
  return null;
}

function detectPlatform(productUrl) {
  const decoded = decodeURIComponentSafe(productUrl).toLowerCase();
  if (decoded.includes('detail.tmall.com') || decoded.includes('tmall.com')) return 'tmall';
  return 'taobao';
}

function extractIds(productUrl) {
  const ids = { itemId: null, skuId: null };
  const direct = extractParams(productUrl);
  ids.itemId = cleanString(direct.id ?? direct.itemId);
  ids.skuId = cleanString(direct.skuId);

  const nestedA = cleanString(direct.a);
  if (nestedA) {
    const nested = extractParams(nestedA);
    ids.itemId = ids.itemId ?? cleanString(nested.id ?? nested.itemId);
    ids.skuId = ids.skuId ?? cleanString(nested.skuId);
  }

  return ids;
}

function extractParams(value) {
  const params = {};
  const text = String(value ?? '');
  try {
    const normalized = text.startsWith('//') ? `https:${text}` : text;
    const url = new URL(normalized);
    for (const [key, val] of url.searchParams.entries()) params[key] = val;
  } catch {
    for (const match of text.matchAll(/[?&]([^=&#]+)=([^&#]+)/g)) {
      params[decodeURIComponentSafe(match[1])] = decodeURIComponentSafe(match[2]);
    }
  }
  return params;
}

function canonicalProductUrl(platform, externalId, fallbackUrl) {
  if (!externalId || externalId.startsWith('octoparse-')) return fallbackUrl;
  if (platform === 'tmall') return `https://detail.tmall.com/item.htm?id=${externalId}`;
  return `https://item.taobao.com/item.htm?id=${externalId}`;
}

function isLikelyItemId(value) {
  return typeof value === 'string' && /^\d{8,20}$/.test(value.trim());
}

function normalizePrice(value) {
  const text = cleanString(value);
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  return Number(match[0]).toFixed(2);
}

function normalizeImageUrl(value) {
  const text = normalizeUrl(value);
  if (!text) return null;
  return text;
}

function normalizeUrl(value) {
  const text = cleanString(value);
  if (!text) return null;
  if (text.startsWith('//')) return `https:${text}`;
  return text;
}

function shortenSearchPageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const q = url.searchParams.get('q');
    const page = url.searchParams.get('page');
    const short = new URL(`${url.origin}${url.pathname}`);
    if (q) short.searchParams.set('q', q);
    if (page) short.searchParams.set('page', page);
    return short.toString();
  } catch {
    return value.length > 500 ? null : value;
  }
}

function inferBrand(text) {
  const normalized = text.toLowerCase();
  for (const [brand, aliases] of BRAND_ALIASES) {
    if (aliases.some((alias) => normalized.includes(alias.toLowerCase()))) return brand;
  }
  return null;
}

function removeEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  );
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

function dateStamp() {
  const now = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function sanitizeSlug(value) {
  return value
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parsePositiveInteger(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file' || token === '-f') parsed.file = argv[++index];
    else if (token === '--out-full') parsed.outFull = argv[++index];
    else if (token === '--out-first') parsed.outFirst = argv[++index];
    else if (token === '--out-rejected') parsed.outRejected = argv[++index];
    else if (token === '--out-report') parsed.outReport = argv[++index];
    else if (token === '--limit') parsed.limit = argv[++index];
    else if (token === '--batch-source') parsed.batchSource = argv[++index];
    else if (token === '--brand-hint') parsed.brandHint = argv[++index];
    else if (token === '--source-label') parsed.sourceLabel = argv[++index];
    else if (token === '--include-original') parsed.includeOriginal = true;
    else if (!parsed.file) parsed.file = token;
  }
  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/normalize-octoparse-taobao.mjs --file crawler-output.jsonl --batch-source taobao_adidas_20260602
  node scripts/normalize-octoparse-taobao.mjs --file octoparse.json --brand-hint adidas --limit 50

Input:
  - JSON array
  - JSONL, one product row per line

Output:
  - ProductPool import JSON: { batchSource, items }
  - first batch JSON
  - rejected JSONL
  - normalization report JSON

Options:
  --file, -f          Raw crawler JSON/JSONL.
  --out-full         Full normalized ProductPool JSON.
  --out-first        First batch ProductPool JSON.
  --out-rejected     Rejected rows JSONL.
  --out-report       Normalization report JSON.
  --limit            First batch size. Default: 30.
  --batch-source     ProductImportBatch batchSource.
  --brand-hint       Force brandHint. If omitted, infer from keyword/title/shop.
  --source-label     rawPayload.source value. Default: octoparse_taobao_tmall_list_page.
  --include-original Keep original row in rawPayload. Default: false. Avoid this for large batches.
`);
}
