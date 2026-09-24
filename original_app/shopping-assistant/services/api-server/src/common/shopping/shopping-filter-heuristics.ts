import { extractPlatformFilterPatch } from "../platforms/platform-normalization";

export function extractShoppingFilterPatch(message: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const priceMax = extractPriceMax(message);
  if (priceMax) patch.priceMax = priceMax;
  const priceMin = extractPriceMin(message);
  if (priceMin) patch.priceMin = priceMin;
  if (extractStockOnly(message)) patch.stockOnly = true;
  if (extractFreeShippingOnly(message)) patch.freeShippingOnly = true;
  const sortRule = extractSortRule(message);
  if (sortRule) patch.sortRule = sortRule;
  if (extractFlagshipShop(message)) patch.shopType = "flagship";
  Object.assign(patch, extractPlatformFilterPatch(message));

  const brand = extractBrand(message);
  if (brand) patch.brand = brand;
  const color = extractColor(message);
  if (color) patch.color = color;
  const size = extractShoeSize(message);
  if (size) patch.size = size;

  return patch;
}

export function extractPriceMax(message: string) {
  if (
    /([0-9]{2,5}|[零〇一二两三四五六七八九十百千万]{1,8})\s*(?:元|块|rmb|RMB|¥)?\s*(?:以上|起|起步)/iu.test(
      message,
    )
  ) {
    return null;
  }

  const explicitCurrency = matchPrice(
    message,
    /(?:预算|价格|价位|不超过|别超过|不要超过|低于|小于|少于|控制在|最多|最高|封顶|以内|以下|内|under|below|less\s+than|up\s+to|max(?:imum)?|budget)?\s*([0-9]{2,5}|[零〇一二两三四五六七八九十百千万]{1,8})\s*(?:元|块|rmb|RMB|¥)/iu,
  );
  if (explicitCurrency) return explicitCurrency;

  const explicitBudget = matchPrice(
    message,
    /(?:预算|价格|价位|不超过|别超过|不要超过|低于|小于|少于|控制在|最多|最高|封顶|under|below|less\s+than|up\s+to|max(?:imum)?|budget)\D{0,8}([0-9]{2,5}|[零〇一二两三四五六七八九十百千万]{1,8})/iu,
  );
  if (explicitBudget) return explicitBudget;

  const rangeLimit = matchPrice(
    message,
    /([0-9]{2,5}|[零〇一二两三四五六七八九十百千万]{1,8})\s*(?:以内|以下|内|之内|封顶)/u,
  );
  if (rangeLimit) return rangeLimit;

  return null;
}

export function extractPriceMin(message: string) {
  const explicitFloor = matchPrice(
    message,
    /(?:不低于|高于|大于|超过|至少|最低|以上|above|over|more\s+than|at\s+least)\D{0,8}([0-9]{2,5}|[零〇一二两三四五六七八九十百千万]{1,8})/iu,
  );
  if (explicitFloor) return explicitFloor;

  const rangeFloor = matchPrice(
    message,
    /([0-9]{2,5}|[零〇一二两三四五六七八九十百千万]{1,8})\s*(?:以上|起|起步)/u,
  );
  if (rangeFloor) return rangeFloor;

  return null;
}

export function extractStockOnly(message: string) {
  return /有货|现货|可拍|库存|能买|能下单|不要.{0,8}(无货|没货|缺货|售罄)|不看.{0,8}(无货|没货|缺货|售罄)|排除.{0,8}(无货|没货|缺货|售罄)|in\s*stock|available/i.test(
    message,
  );
}

export function extractFreeShippingOnly(message: string) {
  return /包邮|免邮|不收邮费|不要邮费|别要邮费|免运费|包运费|free\s*shipping/i.test(
    message,
  );
}

export function extractFlagshipShop(message: string) {
  return /旗舰店|官方店|官方旗舰|品牌官方|自营店|京东自营|official|flagship/i.test(
    message,
  );
}

export function extractSortRule(message: string) {
  if (/匹配|匹配度|相似|相似度|最像|相关度|relevance|similarity/i.test(message)) {
    return "relevance_desc";
  }
  if (/从高到低|高到低|最贵|贵的优先|高价优先|price\s*desc/i.test(message)) {
    return "price_desc";
  }
  if (/便宜|低价|最便宜|最低价|价格优先|从低到高|低到高|省钱|cheapest|cheap|price\s*asc/i.test(message)) {
    return "price_asc";
  }
  if (/好评|评分|评价|口碑|review|rating/i.test(message)) {
    return "rating_desc";
  }
  if (/送达|到货|最快|快递快|发货快|delivery|arrive|fastest/i.test(message)) {
    return "delivery_asc";
  }
  return null;
}

export function extractBrand(message: string) {
  const aliases: Array<[string, RegExp]> = [
    ["Nike", /nike|耐克|奈克/i],
    ["Adidas", /adidas|阿迪|阿迪达斯/i],
    ["Puma", /puma|彪马/i],
    ["Anta", /anta|安踏/i],
    ["Li-Ning", /li[-\s]?ning|lining|李宁/i],
    ["New Balance", /new\s*balance|\bnb\b|新百伦|纽巴伦/i],
    ["ASICS", /asics|亚瑟士/i],
    ["Converse", /converse|匡威/i],
    ["Vans", /vans|万斯/i],
    ["HOKA", /hoka|霍卡/i],
    ["Salomon", /salomon|萨洛蒙/i],
    ["On", /\bon\b|昂跑/i],
  ];
  return (
    aliases.find(
      ([, pattern]) => pattern.test(message) && !isExclusionNear(message, pattern),
    )?.[0] ?? null
  );
}

export function extractColor(message: string) {
  const aliases: Array<[string, RegExp]> = [
    ["black_white", /黑白|熊猫|black\s*white|white\s*black/i],
    ["white", /白色|白的|白鞋|小白鞋|米白|奶白|象牙白|乳白|off\s*white|ivory|white/i],
    ["black", /黑色|黑的|黑鞋|black/i],
    ["gray", /灰色|灰的|银色|银灰|grey|gray|silver/i],
    ["blue", /蓝色|蓝的|藏青|宝蓝|天蓝|blue|navy/i],
    ["red", /红色|红的|酒红|枣红|red/i],
    ["green", /绿色|绿的|军绿|墨绿|green/i],
    ["yellow", /黄色|黄的|金色|金黄|yellow|gold/i],
    ["brown", /棕色|棕的|褐色|咖色|卡其|brown|khaki|tan/i],
    ["beige", /米色|杏色|奶油色|beige|cream/i],
    ["pink", /粉色|粉的|玫粉|pink/i],
    ["purple", /紫色|紫的|purple|violet/i],
    ["orange", /橙色|橘色|orange/i],
    ["multi", /彩色|多色|拼色|撞色|multicolou?r|multi[-_\s]?color/i],
  ];
  for (const [color, pattern] of aliases) {
    if (pattern.test(message) && !isExclusionNear(message, pattern)) return color;
  }
  return null;
}

export function extractShoeSize(message: string) {
  const numeric =
    /(?:鞋码|码数|穿|穿着|平时穿|尺码|欧码|size|wear)\s*(?:欧码|EU|is|:|是)?\s*(\d{2}(?:\.5)?)/i.exec(
      message,
    )?.[1] ?? null;
  if (numeric) return numeric;

  const chinese =
    /(?:鞋码|码数|穿|穿着|平时穿|尺码|欧码)\s*(?:是)?\s*([一二三四五六七八九十]{2,4})(?:码)?/u.exec(
      message,
    )?.[1] ?? null;
  const parsed = chinese ? parseChineseInteger(chinese) : null;
  return parsed && parsed >= 20 && parsed <= 60 ? String(parsed) : null;
}

function matchPrice(message: string, pattern: RegExp) {
  const value = pattern.exec(message)?.[1] ?? null;
  if (!value) return null;
  const parsed = parsePriceNumber(value);
  return parsed && parsed >= 10 ? String(parsed) : null;
}

function parsePriceNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  return parseChineseInteger(value);
}

function parseChineseInteger(value: string) {
  const normalized = value.replace(/两/g, "二").replace(/〇/g, "零");
  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if ([...normalized].every((char) => char in digitMap)) {
    return Number([...normalized].map((char) => digitMap[char]).join(""));
  }

  let total = 0;
  let current = 0;
  let lastUnit = 1;
  for (const char of normalized) {
    if (char in digitMap) {
      current = digitMap[char];
      continue;
    }
    const unit = char === "十" ? 10 : char === "百" ? 100 : char === "千" ? 1000 : char === "万" ? 10000 : 0;
    if (!unit) return null;
    total += (current || 1) * unit;
    current = 0;
    lastUnit = unit;
  }
  if (current > 0) {
    total += lastUnit >= 100 ? current * (lastUnit / 10) : current;
  }
  return total > 0 ? total : null;
}

function isExclusionNear(message: string, valuePattern: RegExp) {
  const valueMatch = valuePattern.exec(message);
  if (valueMatch?.index === undefined) {
    return /不要|不看|别要|别看|排除|去掉|剔除|exclude|remove|without/i.test(
      message,
    );
  }
  const start = Math.max(0, valueMatch.index - 8);
  const end = Math.min(message.length, valueMatch.index + valueMatch[0].length + 8);
  return /不要|不看|别要|别看|排除|去掉|剔除|exclude|remove|without/i.test(
    message.slice(start, end),
  );
}
