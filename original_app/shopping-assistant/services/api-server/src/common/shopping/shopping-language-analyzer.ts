import {
  ConversationCandidateReference,
  ConversationRejectedOperation,
  ConversationSemanticOperationV2,
  ConversationTurnParseInput,
} from '../../adapters/model/model-adapter.interface';
import {
  normalizeProductCategoryOrNull,
  PRODUCT_CATEGORY_DEFINITIONS,
  ProductCategoryKey,
} from '../catalog/product-categories';
import {
  extractMentionedPlatforms,
  isSecondHandPlatformExclusionMessage,
  PlatformFilterValue,
} from '../platforms/platform-normalization';

export type InitialShoppingRoute = 'search' | 'conversation' | 'clarification';

export interface ShoppingLanguageAnalysis {
  originalText: string;
  normalizedText: string;
  correctedText: string;
  filterPatch: Record<string, unknown>;
  filterRemove: string[];
  profilePatch: Record<string, unknown>;
  profileRemove: string[];
  semanticOperations: ConversationSemanticOperationV2[];
  candidateRefs: ConversationCandidateReference[];
  rejectedOperations: ConversationRejectedOperation[];
  categoryMentions: ProductCategoryKey[];
  route: InitialShoppingRoute;
  clarificationMessage: string | null;
  shouldResetPreviousFilters: boolean;
  shouldRestorePreviousFilter: boolean;
  requiresFullParser: boolean;
}

const BRAND_ALIASES: Array<[string, RegExp]> = [
  ['Nike', /nike|耐克|奈克/iu],
  ['Adidas', /adidas|阿迪达斯|阿迪/iu],
  ['Puma', /puma|彪马/iu],
  ['Anta', /anta|安踏/iu],
  ['Li-Ning', /li[-\s]?ning|lining|李宁/iu],
  ['New Balance', /new\s*balance|新百伦|纽巴伦|\bnb\b/iu],
  ['ASICS', /asics|亚瑟士/iu],
  ['Converse', /converse|匡威/iu],
  ['Vans', /vans|万斯/iu],
  ['HOKA', /hoka|霍卡/iu],
  ['Salomon', /salomon|萨洛蒙/iu],
  ['Apple', /apple|苹果/iu],
  ['Huawei', /huawei|华为/iu],
];

const COLOR_ALIASES: Array<[string, RegExp]> = [
  ['black_white', /黑白|熊猫|black\s*white|white\s*black/iu],
  ['white', /白色|白的|白鞋|米白|奶白|象牙白|off\s*white|ivory|\bwhite\b/iu],
  ['black', /黑色|黑的|黑鞋|\bblack\b/iu],
  ['gray', /灰色|银灰|银色|grey|gray|silver/iu],
  ['blue', /蓝色|藏青|宝蓝|天蓝|blue|navy/iu],
  ['red', /红色|酒红|枣红|\bred\b/iu],
  ['green', /绿色|军绿|墨绿|green/iu],
  ['yellow', /黄色|金黄|\byellow\b|\bgold\b/iu],
  ['brown', /棕色|褐色|咖色|卡其|brown|khaki|tan/iu],
  ['beige', /米色|杏色|奶油色|beige|cream/iu],
  ['pink', /粉色|玫粉|pink/iu],
  ['purple', /紫色|purple|violet/iu],
  ['orange', /橙色|橘色|orange/iu],
];

const DOMAIN_CORRECTIONS: Array<[RegExp, string]> = [
  [/跑斜/gu, '跑鞋'],
  [/耐克谢/gu, '耐克鞋'],
  [/奈克/gu, '耐克'],
  [/手鸡/gu, '手机'],
  [/耳鸡/gu, '耳机'],
  [/京冬/gu, '京东'],
  [/添猫/gu, '天猫'],
  [/淘保/gu, '淘宝'],
  [/得务/gu, '得物'],
  [/拼夕夕/gu, '拼多多'],
  [/抖荫/gu, '抖音'],
  [/鲜鱼/gu, '闲鱼'],
  [/惊东/gu, '京东'],
  [/咸渔/gu, '闲鱼'],
  [/京東/gu, '京东'],
  [/康康/gu, '看看'],
  [/買/gu, '买'],
  [/運動鞋/gu, '运动鞋'],
  [/块钱一下(?=$|[，,。；;!?！？])/gu, '块以下'],
  [/元一下(?=$|[，,。；;!?！？])/gu, '元以下'],
  [/\bwo\s+xiang\s+mai\s+nai\s+ke\s+xie\b/giu, '我想买耐克鞋'],
  [/\bnai\s+ke\b/giu, '耐克'],
  [/\bxian\s+yu\b/giu, '闲鱼'],
];

const NEGATIVE_PATTERN =
  /不要|不看|别看|别要|别来|排除|去掉|剔除|过滤掉|屏蔽|非|除了|without|exclude|avoid|not\s+(?:show|include)|no\s+/iu;
const CANCEL_PATTERN =
  /不限|随便|无所谓|不是必须|不要求|不用|取消|别按|不按|恢复默认/iu;
const PREFERENCE_PATTERN = /优先|最好|尽量|偏向|prefer|preferred/iu;
const HARD_PATTERN = /只看|仅看|必须|一定要|限定|只要|only|required/iu;
const TURN_PATTERN = /不是|不对|改成|应该是|而是|换成|改为|but|instead/iu;

export function normalizeUserShoppingText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[—–]/gu, '-')
    .replace(/[\t\r]+/gu, ' ')
    .replace(/(?<=\d)\s+(?=\d)/gu, '')
    .replace(/ {2,}/gu, ' ')
    .trim();
}

export function correctShoppingDomainText(value: string): string {
  let result = value;
  for (const [pattern, replacement] of DOMAIN_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function analyzeShoppingLanguage(
  message: string,
  input?: Pick<
    ConversationTurnParseInput,
    'effectiveFilter' | 'candidateSummary' | 'productProfile'
  >,
): ShoppingLanguageAnalysis {
  const normalizedText = normalizeUserShoppingText(message);
  const correctedText = correctShoppingDomainText(normalizedText);
  const filterPatch: Record<string, unknown> = {};
  const filterRemove = new Set<string>();
  const profilePatch: Record<string, unknown> = {};
  const profileRemove = new Set<string>();
  const semanticOperations: ConversationSemanticOperationV2[] = [];
  const rejectedOperations: ConversationRejectedOperation[] = [];
  const clauses = splitClauses(correctedText);

  const addOperation = (
    kind: ConversationSemanticOperationV2['kind'],
    field: string,
    value?: unknown,
    values?: unknown[],
    polarity: ConversationSemanticOperationV2['polarity'] = 'positive',
    confidence = 0.94,
  ) => {
    semanticOperations.push({
      kind,
      field,
      ...(value !== undefined ? { value } : {}),
      ...(values ? { values } : {}),
      polarity,
      confidence,
      source: 'deterministic',
    });
  };

  parsePlatforms(
    clauses,
    filterPatch,
    filterRemove,
    semanticOperations,
    rejectedOperations,
  );
  parseBrandsAndColors(
    clauses,
    filterPatch,
    filterRemove,
    profilePatch,
    profileRemove,
    semanticOperations,
  );
  parseBooleansAndShop(
    clauses,
    filterPatch,
    filterRemove,
    semanticOperations,
  );
  parseSort(correctedText, filterPatch, filterRemove, semanticOperations);
  parsePrice(
    correctedText,
    input?.effectiveFilter ?? {},
    filterPatch,
    filterRemove,
    semanticOperations,
    rejectedOperations,
  );
  parseSize(
    correctedText,
    input?.effectiveFilter ?? {},
    filterPatch,
    filterRemove,
    semanticOperations,
    rejectedOperations,
  );

  const categoryAnalysis = parseCategories(correctedText);
  if (categoryAnalysis.selected) {
    filterPatch.categoryScope = categoryAnalysis.selected;
    addOperation('set', 'categoryScope', categoryAnalysis.selected);
  }
  if (categoryAnalysis.ambiguous) {
    rejectedOperations.push({
      field: 'categoryScope',
      code: 'MULTI_CATEGORY_REQUIRES_CLARIFICATION',
      message: '目前一次只能搜索一个商品类目，请先选择一个。',
      value: categoryAnalysis.mentions,
    });
  }

  const candidateRefs = resolveCandidateReferences(
    correctedText,
    input?.candidateSummary ?? [],
    rejectedOperations,
  );
  if (candidateRefs.length > 0) {
    addOperation(
      'reference',
      'candidateRefs',
      undefined,
      candidateRefs.map((item) => item.candidateItemId),
    );
  }

  const shouldRestorePreviousFilter = isRestoreRequest(correctedText);
  const shouldResetPreviousFilters = isResetRequest(correctedText);
  if (shouldRestorePreviousFilter) {
    addOperation('reset', 'filterState', 'previous');
  }
  if (shouldResetPreviousFilters) addOperation('reset', 'filterState');

  const priceMin = numeric(filterPatch.priceMin);
  const priceMax = numeric(filterPatch.priceMax);
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    rejectedOperations.push({
      field: 'priceRange',
      code: 'PRICE_RANGE_CONFLICT',
      message: `最低价 ${priceMin} 不能高于最高价 ${priceMax}。`,
      value: { priceMin, priceMax },
    });
  }

  const explicitSearch = hasExplicitSearchAction(correctedText);
  const negativeSearch = isNegativeSearchRequest(correctedText);
  const productSubject = categoryAnalysis.mentions.length > 0 || hasProductSubject(correctedText);
  const onlyBroadSubject = isBroadOrInsufficientRequest(correctedText);
  const hasStructuredOperation =
    semanticOperations.length > 0 ||
    Object.keys(filterPatch).length > 0 ||
    filterRemove.size > 0;
  let route: InitialShoppingRoute = 'conversation';
  if (negativeSearch) route = 'conversation';
  else if (categoryAnalysis.ambiguous || onlyBroadSubject) route = 'clarification';
  else if (
    (explicitSearch && productSubject) ||
    isModelPriceSearch(correctedText) ||
    (productSubject && Object.keys(filterPatch).length > 1) ||
    (productSubject && /\brtx\s*\d{3,4}\b|\b(?:iphone|mate|macbook)\s*\d*/iu.test(correctedText))
  ) route = 'search';
  else if (explicitSearch || productSubject || hasStructuredOperation) route = 'clarification';

  const clarificationMessage =
    rejectedOperations[0]?.message ??
    (route === 'clarification'
      ? categoryAnalysis.ambiguous
        ? '目前一次只能搜索一个商品类目，你想先看哪一种？'
        : '你想找哪类商品？也可以补充用途、预算或具体型号。'
      : null);

  const hasComplexSyntax =
    NEGATIVE_PATTERN.test(correctedText) ||
    TURN_PATTERN.test(correctedText) ||
    clauses.length > 1 ||
    /或者|或是|都可以|范围|加\s*\d|减\s*\d|大半码|小半码|大一码|小一码/iu.test(
      correctedText,
    );

  return {
    originalText: message,
    normalizedText,
    correctedText,
    filterPatch,
    filterRemove: [...filterRemove],
    profilePatch,
    profileRemove: [...profileRemove],
    semanticOperations,
    candidateRefs,
    rejectedOperations,
    categoryMentions: categoryAnalysis.mentions,
    route,
    clarificationMessage,
    shouldResetPreviousFilters,
    shouldRestorePreviousFilter,
    requiresFullParser: hasComplexSyntax,
  };
}

function parsePlatforms(
  clauses: string[],
  patch: Record<string, unknown>,
  remove: Set<string>,
  operations: ConversationSemanticOperationV2[],
  rejected: ConversationRejectedOperation[],
) {
  const include: PlatformFilterValue[] = [];
  const exclude: PlatformFilterValue[] = [];
  for (const clause of clauses) {
    if (/平台.{0,4}(不限|随便|无所谓)|(?:不限|随便|无所谓).{0,4}平台/iu.test(clause)) {
      remove.add('platformsInclude');
      remove.add('platformsExclude');
      remove.add('platform');
      operations.push(operation('remove', 'platforms', undefined, undefined, 'cancel'));
      continue;
    }
    const platforms = extractMentionedPlatforms(clause);
    const negative = NEGATIVE_PATTERN.test(clause);
    for (const platform of platforms) {
      const target = negative ? exclude : include;
      if (!target.includes(platform)) target.push(platform);
      operations.push({
        kind: negative ? 'exclude' : 'include',
        field: 'platforms',
        values: [platform],
        polarity: negative ? 'negative' : 'positive',
        confidence: 0.98,
        source: 'deterministic',
      });
    }
  }
  const fullText = clauses.join('，');
  if (
    isSecondHandPlatformExclusionMessage(fullText) &&
    /二手|旧货|闲置|转卖|全新|一手|只要.{0,3}新品|仅看.{0,3}新品/iu.test(fullText) &&
    !exclude.includes('xianyu')
  ) {
    exclude.push('xianyu');
    operations.push(operation('exclude', 'platforms', undefined, ['xianyu'], 'negative'));
  }
  const overlap = include.filter((item) => exclude.includes(item));
  if (overlap.length > 0) {
    rejected.push({
      field: 'platforms',
      code: 'PLATFORM_SCOPE_CONFLICT',
      message: `你同时要求包含和排除${overlap.join('、')}，请确认保留哪一种。`,
      value: overlap,
    });
    return;
  }
  if (include.length > 0) patch.platformsInclude = include.filter((item) => !exclude.includes(item));
  if (exclude.length > 0) patch.platformsExclude = exclude;
}

function parseBrandsAndColors(
  clauses: string[],
  patch: Record<string, unknown>,
  remove: Set<string>,
  profilePatch: Record<string, unknown>,
  profileRemove: Set<string>,
  operations: ConversationSemanticOperationV2[],
) {
  const brandsInclude: string[] = [];
  const brandsExclude: string[] = [];
  const colorsInclude: string[] = [];
  const colorsExclude: string[] = [];

  for (const clause of clauses) {
    const cancelBrand = /品牌.{0,4}(不限|随便|无所谓)|不限.{0,4}品牌/iu.test(clause);
    const cancelColor = /颜色.{0,4}(不限|随便|无所谓)|不限.{0,4}颜色/iu.test(clause);
    if (cancelBrand) {
      remove.add('brandsInclude');
      remove.add('brandsExclude');
      remove.add('brand');
      profileRemove.add('brand');
      operations.push(operation('remove', 'brand', undefined, undefined, 'cancel'));
    }
    if (cancelColor) {
      remove.add('colorsInclude');
      remove.add('colorsExclude');
      remove.add('color');
      profileRemove.add('color');
      operations.push(operation('remove', 'color', undefined, undefined, 'cancel'));
    }

    const negative = NEGATIVE_PATTERN.test(clause);
    const preferred = PREFERENCE_PATTERN.test(clause) && !HARD_PATTERN.test(clause);
    const brands = findAliases(clause, BRAND_ALIASES);
    const colors = findAliases(clause, COLOR_ALIASES);
    for (const brand of brands) {
      if (preferred) {
        mergePreference(patch, 'brands', brand);
        operations.push(operation('prefer', 'brands', undefined, [brand]));
      } else {
        (negative ? brandsExclude : brandsInclude).push(brand);
        operations.push(operation(negative ? 'exclude' : 'include', 'brands', undefined, [brand], negative ? 'negative' : 'positive'));
      }
    }
    for (const color of colors) {
      if (preferred) {
        mergePreference(patch, 'colors', color);
        operations.push(operation('prefer', 'colors', undefined, [color]));
      } else {
        (negative ? colorsExclude : colorsInclude).push(color);
        operations.push(operation(negative ? 'exclude' : 'include', 'colors', undefined, [color], negative ? 'negative' : 'positive'));
      }
    }

    if (TURN_PATTERN.test(clause) && brands.length > 0) {
      const lastBrand = brands.at(-1)!;
      profilePatch.brand = lastBrand;
      brandsInclude.splice(0, brandsInclude.length, lastBrand);
    }
    if (TURN_PATTERN.test(clause) && colors.length > 0) {
      const lastColor = colors.at(-1)!;
      profilePatch.color = lastColor;
      colorsInclude.splice(0, colorsInclude.length, lastColor);
    }
  }

  const fullText = clauses.join('，');
  if (TURN_PATTERN.test(fullText)) {
    const allBrands = findAliases(fullText, BRAND_ALIASES);
    const allColors = findAliases(fullText, COLOR_ALIASES);
    if (allBrands.length > 0) {
      const correctedBrand = allBrands.at(-1)!;
      profilePatch.brand = correctedBrand;
      brandsInclude.splice(0, brandsInclude.length, correctedBrand);
      const index = brandsExclude.findIndex((item) => item === correctedBrand);
      if (index >= 0) brandsExclude.splice(index, 1);
    }
    if (allColors.length > 0) {
      const correctedColor = allColors.at(-1)!;
      profilePatch.color = correctedColor;
      colorsInclude.splice(0, colorsInclude.length, correctedColor);
      const index = colorsExclude.findIndex((item) => item === correctedColor);
      if (index >= 0) colorsExclude.splice(index, 1);
    }
  }

  if (brandsInclude.length > 0) patch.brandsInclude = unique(brandsInclude).filter((item) => !brandsExclude.includes(item));
  if (brandsExclude.length > 0) patch.brandsExclude = unique(brandsExclude);
  if (colorsInclude.length > 0) patch.colorsInclude = unique(colorsInclude).filter((item) => !colorsExclude.includes(item));
  if (colorsExclude.length > 0) patch.colorsExclude = unique(colorsExclude);
}

function parseBooleansAndShop(
  clauses: string[],
  patch: Record<string, unknown>,
  remove: Set<string>,
  operations: ConversationSemanticOperationV2[],
) {
  for (const clause of clauses) {
    const preferred = PREFERENCE_PATTERN.test(clause) && !HARD_PATTERN.test(clause);
    const cancel = CANCEL_PATTERN.test(clause) || NEGATIVE_PATTERN.test(clause);
    if (/有货|现货|库存|没货|缺货|in\s*stock|out\s*of\s*stock/iu.test(clause)) {
      const requireStock = /不要.{0,3}(?:没货|缺货)|(?:没货|缺货).{0,3}(?:不要|别来)|只看.{0,3}(?:有货|现货)/iu.test(clause);
      if (requireStock) {
        patch.stockOnly = true;
        operations.push(operation('set', 'stockOnly', true));
      } else if (cancel) {
        remove.add('stockOnly');
        operations.push(operation('remove', 'stockOnly', undefined, undefined, 'cancel'));
      } else {
        patch.stockOnly = true;
        operations.push(operation('set', 'stockOnly', true));
      }
    }
    if (/包邮|免邮|免运费|不要邮费|不收邮费|free\s*shipping/iu.test(clause)) {
      if (preferred) {
        mergePreference(patch, 'freeShipping', true);
        operations.push(operation('prefer', 'freeShipping', true));
      } else if (cancel && !/不要邮费|不收邮费/iu.test(clause)) {
        remove.add('freeShippingOnly');
        operations.push(operation('remove', 'freeShippingOnly', undefined, undefined, 'cancel'));
      } else {
        patch.freeShippingOnly = true;
        operations.push(operation('set', 'freeShippingOnly', true));
      }
    }
    if (/旗舰店|官方店|官方旗舰|自营店|flagship|official/iu.test(clause)) {
      if (preferred) {
        mergePreference(patch, 'shopTypes', 'flagship');
        operations.push(operation('prefer', 'shopType', 'flagship'));
      } else if (cancel) {
        remove.add('shopType');
        operations.push(operation('remove', 'shopType', undefined, undefined, 'cancel'));
      } else {
        patch.shopType = 'flagship';
        operations.push(operation('set', 'shopType', 'flagship'));
      }
    }
  }
}

function parseSort(
  text: string,
  patch: Record<string, unknown>,
  remove: Set<string>,
  operations: ConversationSemanticOperationV2[],
) {
  if (/别按|不要按|不按|取消.{0,4}排序|恢复默认排序/iu.test(text)) {
    remove.add('sortRule');
    operations.push(operation('remove', 'sortRule', undefined, undefined, 'cancel'));
    return;
  }
  if (/销量|新品|最新/iu.test(text)) return;
  const rules: Array<[string, RegExp]> = [
    ['price_desc', /从高到低|高到低|最贵|贵的优先|price\s*desc/iu],
    ['price_asc', /从低到高|低到高|最便宜|低价优先|价格优先|cheapest|price\s*asc/iu],
    ['rating_desc', /好评|评分|评价优先|rating/iu],
    ['delivery_asc', /最快送达|到货最快|发货快|delivery/iu],
    ['relevance_desc', /最相似|匹配度|相关度|relevance|similarity/iu],
  ];
  for (const [rule, pattern] of rules) {
    if (!pattern.test(text)) continue;
    if (NEGATIVE_PATTERN.test(text)) {
      remove.add('sortRule');
      operations.push(operation('remove', 'sortRule', undefined, undefined, 'cancel'));
      return;
    }
    patch.sortRule = rule;
    operations.push(operation('set', 'sortRule', rule));
    return;
  }
}

function parsePrice(
  text: string,
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  remove: Set<string>,
  operations: ConversationSemanticOperationV2[],
  rejected: ConversationRejectedOperation[],
) {
  if (/(?:EU|US|UK|CN)?\s*(?:\d{1,3}(?:\.5)?|[零〇一二两三四五六七八九十百]+)(?:\s*(?:到|至|[-~～])\s*(?:\d{1,3}(?:\.5)?|[零〇一二两三四五六七八九十百]+))?\s*码/iu.test(text) && !/价格|预算|价位|元|块|rmb|¥|\$/iu.test(text)) {
    return;
  }
  if (/价格|预算|价位/iu.test(text) && /不限|随便|无所谓|取消/iu.test(text)) {
    remove.add('priceMin');
    remove.add('priceMax');
    remove.add('priceTarget');
    remove.add('priceTolerance');
    operations.push(operation('remove', 'priceRange', undefined, undefined, 'cancel'));
    return;
  }

  const excludedFloor = /(?:不要|不看|排除|低于)\D{0,5}(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块钱?)?\s*(?:以上|起)/iu.exec(text);
  if (excludedFloor) {
    const value = parseShoppingNumber(excludedFloor[1]);
    if (value !== null) {
      patch.priceMax = formatNumber(value);
      operations.push(operation('set', 'priceMax', value, undefined, 'negative'));
    }
    return;
  }

  const relative = /(?:预算|价格|上限)?.{0,4}(加|增加|提高|涨|减|降低|减少)(?:到)?\s*(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)/iu.exec(text);
  if (relative) {
    const deltaValue = parseShoppingNumber(relative[2]);
    const base = numeric(current.priceMax ?? current.priceTarget);
    if (deltaValue === null || base === null) {
      rejected.push({
        field: 'priceMax',
        code: 'PRICE_DELTA_BASE_REQUIRED',
        message: '请先告诉我当前预算或新的明确预算。',
        value: relative[0],
      });
    } else {
      const direction = /减|降低/u.test(relative[1]) ? -1 : 1;
      const result = base + direction * deltaValue;
      patch.priceMax = formatNumber(result);
      operations.push(operation('delta', 'priceMax', direction * deltaValue));
    }
    return;
  }

  if (/再便宜一点|便宜些|价格低一点/iu.test(text)) {
    const base = numeric(current.priceMax ?? current.priceTarget);
    if (base !== null) {
      const next = Math.max(0, Math.round(base * 0.9 * 100) / 100);
      patch.priceMax = formatNumber(next);
      operations.push(operation('delta', 'priceMax', next - base));
    } else {
      mergePreference(patch, 'priceDirection', 'lower');
      operations.push(operation('prefer', 'priceDirection', 'lower'));
    }
  }

  const conversationalCorrection = /(?:预算|价格|价位)?\s*(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)\s*[,，\s]*(?:嗯|呃|额)?\s*(?:不对|说错了)\s*[,，\s]*(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)/iu.exec(text);
  if (conversationalCorrection) {
    const value = parseShoppingNumber(conversationalCorrection[2]);
    if (value !== null) {
      patch.priceMax = formatNumber(value);
      operations.push(operation('set', 'priceMax', value));
    }
    return;
  }

  const range = /(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块钱?)?\s*(?:到|至|[-~～])\s*(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块钱?)?/iu.exec(text);
  if (range) {
    const min = parseShoppingNumber(range[1]);
    const max = parseShoppingNumber(range[2]);
    if (min !== null && max !== null) {
      patch.priceMin = formatNumber(min);
      patch.priceMax = formatNumber(max);
      operations.push(operation('set', 'priceMin', min));
      operations.push(operation('set', 'priceMax', max));
    }
    return;
  }

  const corrected = /(?:不是|不对).{0,8}?(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+).{0,8}?(?:是|改成|应该是|而是)\s*(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)/iu.exec(text);
  if (corrected) {
    const value = parseShoppingNumber(corrected[2]);
    if (value !== null) {
      patch.priceMax = formatNumber(value);
      operations.push(operation('set', 'priceMax', value));
    }
    return;
  }

  const floor = /(?:不低于|至少|最低|高于|大于|超过|above|over|at\s*least)\D{0,6}(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)/iu.exec(text) ?? /(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块钱?)?\s*(?:以上|起)/iu.exec(text);
  const ceiling = /(?:不超过|别超过|最高|最多|低于|小于|预算|under|below|up\s*to)\D{0,6}(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)/iu.exec(text) ?? /(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块钱?)?\s*(?:以内|以下|封顶)/iu.exec(text);
  if (floor) {
    const value = parseShoppingNumber(floor[1]);
    if (value !== null) {
      patch.priceMin = formatNumber(value);
      operations.push(operation('set', 'priceMin', value));
    }
  }
  if (ceiling) {
    const value = parseShoppingNumber(ceiling[1]);
    if (value !== null) {
      patch.priceMax = formatNumber(value);
      operations.push(operation('set', 'priceMax', value));
    }
  }
  const around = /(\d[\d,.]*\s*k?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块钱?)?\s*(?:左右|上下|附近)/iu.exec(text);
  if (around) {
    const value = parseShoppingNumber(around[1]);
    if (value !== null) {
      patch.priceTarget = formatNumber(value);
      patch.priceTolerance = formatNumber(Math.max(20, Math.round(value * 0.1)));
      operations.push(operation('prefer', 'priceTarget', value));
    }
  }
}

function parseSize(
  text: string,
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  remove: Set<string>,
  operations: ConversationSemanticOperationV2[],
  rejected: ConversationRejectedOperation[],
) {
  if (/尺码|鞋码|码数/iu.test(text) && /不限|随便|无所谓|取消/iu.test(text)) {
    for (const field of ['sizesInclude', 'sizeSystem', 'sizeMin', 'sizeMax', 'size']) remove.add(field);
    operations.push(operation('remove', 'sizes', undefined, undefined, 'cancel'));
    return;
  }
  const relative = /(大|小)(半码|一码)/u.exec(text);
  if (relative) {
    const values = stringArray(current.sizesInclude);
    const scalar = values.length === 1 ? numeric(values[0]) : numeric(current.size);
    if (scalar === null) {
      rejected.push({
        field: 'sizesInclude',
        code: 'SIZE_DELTA_BASE_REQUIRED',
        message: '请先告诉我当前尺码，再说明要大或小多少。',
        value: relative[0],
      });
      return;
    }
    const step = relative[2] === '半码' ? 0.5 : 1;
    const result = scalar + (relative[1] === '小' ? -step : step);
    patch.sizesInclude = [formatNumber(result)];
    patch.sizeSystem = String(current.sizeSystem ?? 'EU');
    operations.push(operation('delta', 'sizesInclude', result - scalar));
    return;
  }

  const range = /(?:(?:EU|欧码)\s*(\d{2}(?:\.5)?)\s*(?:到|至|[-~～])\s*(\d{2}(?:\.5)?)\s*(?:码)?|(\d{2}(?:\.5)?)\s*(?:到|至|[-~～])\s*(\d{2}(?:\.5)?)\s*码)/iu.exec(text);
  if (range) {
    const min = Number(range[1] ?? range[3]);
    const max = Number(range[2] ?? range[4]);
    if (validEuSize(min) && validEuSize(max) && min <= max) {
      patch.sizeSystem = 'EU';
      patch.sizeMin = formatNumber(min);
      patch.sizeMax = formatNumber(max);
      patch.sizesInclude = expandHalfSizes(min, max);
      operations.push(operation('include', 'sizes', undefined, patch.sizesInclude as unknown[]));
    } else {
      rejected.push({ field: 'sizesInclude', code: 'SIZE_RANGE_INVALID', message: '鞋码范围不合理，请确认后再试。', value: range[0] });
    }
    return;
  }

  const chineseSize = /([零〇一二两三四五六七八九十百]+)\s*码/u.exec(text);
  if (chineseSize) {
    const value = parseShoppingNumber(chineseSize[1]);
    if (value !== null && validEuSize(value)) {
      patch.sizeSystem = 'EU';
      patch.sizesInclude = [formatNumber(value)];
      operations.push(operation('include', 'sizes', undefined, [formatNumber(value)]));
    } else {
      rejected.push({ field: 'sizesInclude', code: 'SIZE_VALUE_INVALID', message: '这个鞋码超出合理范围，请确认后再试。', value: chineseSize[1] });
    }
    return;
  }

  const explicit = /\b(EU|US|UK|CN)\s*(\d{1,3}(?:\.5)?)\b|(?:鞋码|尺码|码数|平时穿|穿)\s*(?:是)?\s*(\d{2}(?:\.5)?)\s*码?|\b(\d{2}(?:\.5)?)\s*码(?![\d.])/iu.exec(text) ??
    (/^\d{2}(?:\.5)?$/u.test(text.trim()) && (current.categoryScope === 'shoe')
      ? [text, undefined, undefined, text.trim()]
      : null);
  if (!explicit) return;
  const system = (explicit[1]?.toUpperCase() ?? 'EU') as 'EU' | 'US' | 'UK' | 'CN';
  const value = Number(explicit[2] ?? explicit[3] ?? explicit[4]);
  const valid = system === 'EU' ? validEuSize(value) : value > 0 && value <= (system === 'CN' ? 350 : 20);
  if (!valid) {
    rejected.push({ field: 'sizesInclude', code: 'SIZE_VALUE_INVALID', message: '这个尺码超出合理范围，请确认尺码体系和数值。', value });
    return;
  }
  patch.sizeSystem = system;
  patch.sizesInclude = [formatNumber(value)];
  operations.push(operation('include', 'sizes', undefined, [formatNumber(value)]));
}

function parseCategories(text: string) {
  const mentions: Array<{ category: ProductCategoryKey; index: number; negative: boolean }> = [];
  for (const definition of PRODUCT_CATEGORY_DEFINITIONS) {
    if (definition.key === 'general' || definition.key === 'digital_other') continue;
    for (const alias of definition.aliases) {
      if (alias.length < 2 && !/[\u3400-\u9fff]/u.test(alias)) continue;
      const index = text.toLowerCase().lastIndexOf(alias.toLowerCase());
      if (index < 0) continue;
      const local = text.slice(Math.max(0, index - 3), Math.min(text.length, index + alias.length + 5));
      mentions.push({ category: definition.key, index, negative: NEGATIVE_PATTERN.test(local) });
      break;
    }
  }
  const modelCategories: Array<[ProductCategoryKey, RegExp]> = [
    ['headphones', /airpods|头戴式耳机|蓝牙耳机/iu],
    ['phone', /iphone|mate\s*\d+|手机/iu],
    ['tablet', /ipad|平板/iu],
    ['computer', /macbook|thinkpad|笔记本/iu],
  ];
  for (const [category, pattern] of modelCategories) {
    const match = pattern.exec(text);
    if (!match || mentions.some((item) => item.category === category)) continue;
    mentions.push({ category, index: match.index, negative: NEGATIVE_PATTERN.test(text.slice(Math.max(0, match.index - 3), match.index + match[0].length + 5)) });
  }
  mentions.sort((a, b) => a.index - b.index);
  const positive = mentions.filter((item) => !item.negative).map((item) => item.category);
  const uniquePositive = unique(positive);
  const hasChoiceConnector = /和|以及|或者|或是|都想|都要|and|or/iu.test(text);
  const explicitSwitch = /换|改看|看看|改成|而是|instead/iu.test(text);
  return {
    mentions: unique(mentions.map((item) => item.category)),
    selected: uniquePositive.length > 0 ? uniquePositive.at(-1)! : normalizeProductCategoryOrNull(text),
    ambiguous: uniquePositive.length > 1 && hasChoiceConnector && !explicitSwitch,
  };
}

function resolveCandidateReferences(
  text: string,
  candidates: ConversationTurnParseInput['candidateSummary'],
  rejected: ConversationRejectedOperation[],
): ConversationCandidateReference[] {
  const indexes: number[] = [];
  if (/这批都不喜欢|换一批|全部换掉|这批都不要/iu.test(text)) {
    indexes.push(...candidates.map((_, index) => index));
  } else if (/前两个|前两款|前二/iu.test(text)) indexes.push(0, 1);
  else {
    const ordinalMap: Array<[number, RegExp]> = [
      [0, /第一个|第一款|第1个|第1款|这个|当前这个/iu],
      [1, /第二个|第二款|第2个|第2款/iu],
      [2, /第三个|第三款|第3个|第3款/iu],
      [3, /第四个|第四款|第4个|第4款/iu],
    ];
    for (const [index, pattern] of ordinalMap) if (pattern.test(text)) indexes.push(index);
  }
  if (indexes.length === 0) return [];
  const refs: ConversationCandidateReference[] = [];
  for (const index of unique(indexes)) {
    const candidate = candidates[index];
    if (!candidate) {
      rejected.push({ field: 'candidateRefs', code: 'CANDIDATE_REFERENCE_OUT_OF_RANGE', message: `当前结果中没有第 ${index + 1} 项。`, value: index + 1 });
      continue;
    }
    refs.push({
      candidateItemId: candidate.candidateItemId,
      productId: candidate.productId ?? null,
      ordinal: index + 1,
      title: candidate.title,
    });
  }
  return refs;
}

function hasExplicitSearchAction(text: string) {
  return /想买|要买|准备买|帮我找|找一下|找个|找双|搜索|搜一下|看看|看一下|有没有|换(?:成|看|手机|电脑|鞋|耳机|相机)|来一个|来一双|想整个|哪里便宜|比价|购买|buy|find|search|\bneed\b/iu.test(text);
}

function isNegativeSearchRequest(text: string) {
  return /不买了|不想买|不要推荐|别给我推荐|只是问问|不是要买|don't\s+want|do\s+not\s+want|stop\s+search/iu.test(text);
}

function isBroadOrInsufficientRequest(text: string) {
  return /^(推荐一下|推荐|买啥都行|随便买点|鞋|手机|电脑|耳机|相机|商品|产品)[。.!！?？]*$/iu.test(text);
}

function isModelPriceSearch(text: string) {
  return /(?:airpods|iphone|ipad|mate\s*\d+|pro\s*\d*).{0,12}(哪里便宜|价格|多少钱|比价)/iu.test(text);
}

function hasProductSubject(text: string) {
  return /商品|产品|数码|电子产品|airpods|iphone|ipad|nike|耐克|adidas|阿迪|puma|彪马|\brtx\s*\d{3,4}\b/iu.test(text);
}

function isResetRequest(text: string) {
  if (/重新\s*排序|重排|按.*排序/iu.test(text)) return false;
  return /重新开始|重新来|重置|清空全部|从头|看所有平台|start\s*over|\breset\b|clear\s*all/iu.test(text);
}

function isRestoreRequest(text: string) {
  return /撤销(?:刚才|上次|上一轮)?(?:的)?筛选|改回上一个条件|恢复上一次条件|undo(?:\s+last)?/iu.test(text);
}

function splitClauses(text: string) {
  return text
    .split(/[，,。；;!?！？\u{1F300}-\u{1FAFF}]|(?:\s+(?:但是|不过|然后|but|then)\s+)/iu)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findAliases(text: string, aliases: Array<[string, RegExp]>) {
  return aliases.filter(([, pattern]) => pattern.test(text)).map(([value]) => value);
}

function operation(
  kind: ConversationSemanticOperationV2['kind'],
  field: string,
  value?: unknown,
  values?: unknown[],
  polarity: ConversationSemanticOperationV2['polarity'] = 'positive',
): ConversationSemanticOperationV2 {
  return { kind, field, ...(value !== undefined ? { value } : {}), ...(values ? { values } : {}), polarity, confidence: 0.94, source: 'deterministic' };
}

function mergePreference(patch: Record<string, unknown>, field: string, value: unknown) {
  const preferences = typeof patch.preferences === 'object' && patch.preferences !== null && !Array.isArray(patch.preferences)
    ? (patch.preferences as Record<string, unknown>)
    : {};
  if (field === 'brands' || field === 'colors' || field === 'platforms' || field === 'shopTypes') {
    preferences[field] = unique([...stringArray(preferences[field]), String(value)]);
  } else {
    preferences[field] = value;
  }
  patch.preferences = preferences;
}

function parseShoppingNumber(raw: string): number | null {
  const normalized = raw.trim().toLowerCase().replace(/,/gu, '').replace(/\s+/gu, '');
  const k = normalized.endsWith('k');
  const numericRaw = k ? normalized.slice(0, -1) : normalized;
  if (/^\d+(?:\.\d+)?$/u.test(numericRaw)) {
    const value = Number(numericRaw) * (k ? 1000 : 1);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  return parseChineseNumber(numericRaw);
}

function parseChineseNumber(raw: string): number | null {
  const text = raw.replace(/两/gu, '二').replace(/〇/gu, '零');
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if ([...text].every((char) => char in digits)) return Number([...text].map((char) => digits[char]).join(''));
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of text) {
    if (char in digits) {
      number = digits[char];
      continue;
    }
    const unit = char === '十' ? 10 : char === '百' ? 100 : char === '千' ? 1000 : char === '万' ? 10000 : 0;
    if (!unit) return null;
    if (unit === 10000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }
  const result = total + section + number;
  return result >= 0 ? result : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function validEuSize(value: number) {
  return Number.isFinite(value) && value >= 20 && value <= 60 && Number.isInteger(value * 2);
}

function expandHalfSizes(min: number, max: number) {
  const result: string[] = [];
  for (let value = min; value <= max + 0.001; value += 0.5) result.push(formatNumber(value));
  return result;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
