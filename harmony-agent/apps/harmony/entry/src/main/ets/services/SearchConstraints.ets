export interface SearchConstraints {
  brandTokens: string[];
  minimumPrice?: number;
  maximumPrice?: number;
}

// Deliberately bounded syntax. Semantic similarity is never treated as a hard price filter.
export function parseSearchConstraints(query: string): SearchConstraints {
  const text: string = query.toLowerCase();
  const aliases: string[][] = [['耐克', 'nike'], ['阿迪达斯', 'adidas'], ['华为', 'huawei'],
    ['苹果', 'apple'], ['联想', 'lenovo']];
  const result: SearchConstraints = { brandTokens: [] };
  aliases.forEach((tokens: string[]) => {
    if (tokens.some((token: string) => text.indexOf(token) >= 0)) { result.brandTokens = tokens; }
  });
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:到|至|-)\s*(\d+(?:\.\d+)?)\s*元/);
  const upper = text.match(/(?:不超过|低于|最多|预算)\s*(\d+(?:\.\d+)?)/) ??
    text.match(/(\d+(?:\.\d+)?)\s*元?(?:以内|以下)/);
  const lower = text.match(/(?:不少于|高于|至少)\s*(\d+(?:\.\d+)?)/) ??
    text.match(/(\d+(?:\.\d+)?)\s*元?(?:以上)/);
  if (range !== null) { result.minimumPrice = Number(range[1]); result.maximumPrice = Number(range[2]); }
  if (upper !== null) { result.maximumPrice = Number(upper[1]); }
  if (lower !== null) { result.minimumPrice = Number(lower[1]); }
  return result;
}

export function matchesSearchConstraints(title: string, price: string, constraints: SearchConstraints): boolean {
  if (constraints.brandTokens.length > 0 &&
    !constraints.brandTokens.some((token: string) => title.toLowerCase().indexOf(token) >= 0)) { return false; }
  if (constraints.minimumPrice === undefined && constraints.maximumPrice === undefined) { return true; }
  // Unknown/range prices cannot satisfy a hard numeric constraint.
  const normalized: string = price.replace(/[,￥¥\s]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) { return false; }
  const value: number = Number(normalized);
  return Number.isFinite(value) && (constraints.minimumPrice === undefined || value >= constraints.minimumPrice) &&
    (constraints.maximumPrice === undefined || value <= constraints.maximumPrice);
}
